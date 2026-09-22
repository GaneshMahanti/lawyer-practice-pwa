/**
 * POST /api/admin/payments/decision   (DEVELOPER ONLY)
 *
 * Approve or reject a submitted recharge request.
 *
 * Body (approve): { action: 'approve', requestId, amountReceivedRupees }
 * Body (reject):  { action: 'reject',  requestId, note }
 *
 * Approve calls approve_payment_request(id, received_paise, developer_id).
 * Reject  calls reject_payment_request(id, note, developer_id).
 * Both are SECURITY DEFINER — this route never touches wallet/ledger directly.
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireDeveloperUser } from '@/lib/auth/requestUser';
import { createServiceClient } from '@/lib/supabase/service';
import { logServerError } from '@/lib/log/serverLog';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PG_ERRORS: Array<[string, string]> = [
  ['request_not_found',       'Request not found.'],
  ['request_not_submitted',   'This request has already been decided or is not yet submitted.'],
  ['request_already_decided', 'This request has already been decided.'],
  ['invalid_amount',          'Enter the amount you actually received (must be greater than zero).'],
  ['amount_out_of_range',     'The amount entered is more than 10× what the lawyer expected. Please check and try again.'],
];

function friendlyPg(msg: string): string | null {
  const m = msg.toLowerCase();
  return PG_ERRORS.find(([k]) => m.includes(k))?.[1] ?? null;
}

export async function POST(request: NextRequest) {
  const dev = await requireDeveloperUser(request);
  if (!dev) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  let body: Record<string, unknown>;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid request.' }, { status: 400 }); }

  const action    = typeof body.action    === 'string' ? body.action    : '';
  const requestId = typeof body.requestId === 'string' ? body.requestId.trim() : '';
  if (!UUID_RE.test(requestId)) {
    return NextResponse.json({ error: 'Invalid request ID.' }, { status: 400 });
  }

  const db = createServiceClient() as any;

  try {
    if (action === 'approve') {
      const rupees = Number(body.amountReceivedRupees);
      if (!Number.isFinite(rupees) || rupees <= 0) {
        return NextResponse.json({ error: 'Enter the amount you received (must be greater than zero).' }, { status: 400 });
      }
      const receivedPaise = Math.round(rupees * 100);
      const { error } = await db.rpc('approve_payment_request', {
        p_request_id:     requestId,
        p_received_paise: receivedPaise,
        p_developer_id:   dev.id,
      });
      if (error) {
        const msg = friendlyPg(error.message);
        if (msg) return NextResponse.json({ error: msg }, { status: 400 });
        throw new Error(error.message);
      }
      return NextResponse.json({ ok: true });
    }

    if (action === 'reject') {
      const note = typeof body.note === 'string' ? body.note.trim() : '';
      if (!note) return NextResponse.json({ error: 'Please add a reason for rejecting.' }, { status: 400 });
      const { error } = await db.rpc('reject_payment_request', {
        p_request_id:   requestId,
        p_note:         note,
        p_developer_id: dev.id,
      });
      if (error) {
        const msg = friendlyPg(error.message);
        if (msg) return NextResponse.json({ error: msg }, { status: 400 });
        throw new Error(error.message);
      }
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  } catch (err) {
    await logServerError('api/admin/payments/decision', err, { action, developerId: dev.id, requestId });
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
  }
}
