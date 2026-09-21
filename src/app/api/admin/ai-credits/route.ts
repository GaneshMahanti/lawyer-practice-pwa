import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireDeveloperUser } from '@/lib/auth/requestUser';
import { createServiceClient } from '@/lib/supabase/service';
import { logServerError } from '@/lib/log/serverLog';

/**
 * POST /api/admin/ai-credits   (DEVELOPER ONLY)
 *
 * The developer's controls over a lawyer's AI wallet. Body: { action, ownerId, ... }
 *
 *   grant_included  - the one-time Rs 1,000: "app fee received" (once per lawyer)
 *   adjust          - add or remove credits: { bucket: 'included'|'purchased',
 *                     amountRupees (negative removes), note (required) }
 *   set_status      - { status: 'active' | 'paused' }  pause / resume AI for this lawyer
 *   set_daily_cap   - { capRupees: number | null }  null = use the default daily cap
 *
 * ownerId is the lawyer's auth user id (approved_users.auth_user_id).
 * Every money change is written to the ledger by a database function; this route never
 * edits balances directly. Users only ever see a short message; details go to the log.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PG_MESSAGES: Array<[string, string]> = [
  ['owner_not_found', 'This lawyer has not signed in yet, so they cannot hold credits.'],
  ['not_a_lawyer', 'Credits can only be added to lawyer accounts.'],
  ['insufficient_balance', 'You cannot remove more than the current balance.'],
  ['note_required', 'Please add a short note explaining the change.'],
  ['amount_out_of_range', 'The amount must be Rs 10,000 or less in one action.'],
  ['invalid_amount', 'Enter an amount that is not zero.'],
  ['invalid_bucket', 'Choose Included or Recharged credits.'],
];

function friendly(pgMessage: string): string | null {
  const m = pgMessage.toLowerCase();
  const hit = PG_MESSAGES.find(([key]) => m.includes(key));
  return hit ? hit[1] : null;
}

export async function POST(request: NextRequest) {
  const dev = await requireDeveloperUser(request);
  if (!dev) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  const action = typeof body.action === 'string' ? body.action : '';
  const ownerId = typeof body.ownerId === 'string' ? body.ownerId : '';
  if (!UUID_RE.test(ownerId)) {
    return NextResponse.json({ error: 'Invalid lawyer.' }, { status: 400 });
  }

  let db: any;
  try {
    db = createServiceClient();
  } catch {
    return NextResponse.json({ error: 'Service key not configured on server.' }, { status: 503 });
  }

  try {
    // ── One-time Rs 1,000 ────────────────────────────────────────────────────
    if (action === 'grant_included') {
      const { data: row, error: readError } = await db
        .from('approved_users')
        .select('included_granted_at')
        .eq('auth_user_id', ownerId)
        .maybeSingle();
      if (readError) throw new Error(readError.message);
      if (row?.included_granted_at) {
        return NextResponse.json({ ok: true, already: true });
      }
      const { error } = await db.rpc('grant_included_credits', { p_owner_id: ownerId });
      if (error) return failure(error.message, dev.id, action);
      return NextResponse.json({ ok: true });
    }

    // ── Add / remove credits ─────────────────────────────────────────────────
    if (action === 'adjust') {
      const bucket = body.bucket === 'included' || body.bucket === 'purchased' ? body.bucket : null;
      const rupees = Number(body.amountRupees);
      const note = typeof body.note === 'string' ? body.note.trim() : '';
      if (!bucket) return NextResponse.json({ error: 'Choose Included or Recharged credits.' }, { status: 400 });
      if (!Number.isFinite(rupees) || rupees === 0) {
        return NextResponse.json({ error: 'Enter an amount that is not zero.' }, { status: 400 });
      }
      const { error } = await db.rpc('admin_adjust_credits', {
        p_owner_id: ownerId,
        p_bucket: bucket,
        p_amount_paise: Math.round(rupees * 100),
        p_note: note,
        p_developer_id: dev.id,
      });
      if (error) return failure(error.message, dev.id, action);
      return NextResponse.json({ ok: true });
    }

    // ── Pause / resume this lawyer's AI ──────────────────────────────────────
    if (action === 'set_status') {
      const status = body.status === 'paused' ? 'paused' : body.status === 'active' ? 'active' : null;
      if (!status) return NextResponse.json({ error: 'Invalid status.' }, { status: 400 });
      const { data, error } = await db
        .from('ai_wallets')
        .update({ status })
        .eq('owner_id', ownerId)
        .select('owner_id');
      if (error) throw new Error(error.message);
      if (!data || data.length === 0) {
        return NextResponse.json({ error: 'This lawyer has no AI wallet yet.' }, { status: 404 });
      }
      return NextResponse.json({ ok: true });
    }

    // ── Daily spending cap ───────────────────────────────────────────────────
    if (action === 'set_daily_cap') {
      let capPaise: number | null = null;
      if (body.capRupees !== null && body.capRupees !== undefined && body.capRupees !== '') {
        const rupees = Number(body.capRupees);
        if (!Number.isFinite(rupees) || rupees <= 0 || rupees > 10000) {
          return NextResponse.json({ error: 'Daily limit must be between Rs 1 and Rs 10,000.' }, { status: 400 });
        }
        capPaise = Math.round(rupees * 100);
      }
      const { data, error } = await db
        .from('ai_wallets')
        .update({ daily_cap_paise: capPaise })
        .eq('owner_id', ownerId)
        .select('owner_id');
      if (error) throw new Error(error.message);
      if (!data || data.length === 0) {
        return NextResponse.json({ error: 'This lawyer has no AI wallet yet.' }, { status: 404 });
      }
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  } catch (err) {
    await logServerError('api/admin/ai-credits', err, { action, developerId: dev.id });
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
  }
}

/** Database rule violations become a short message; anything else is logged and hidden. */
async function failure(pgMessage: string, developerId: string, action: string) {
  const message = friendly(pgMessage);
  if (message) return NextResponse.json({ error: message }, { status: 400 });
  await logServerError('api/admin/ai-credits', new Error(pgMessage), { action, developerId });
  return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
}
