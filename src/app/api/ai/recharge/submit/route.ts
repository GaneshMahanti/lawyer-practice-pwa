/**
 * POST /api/ai/recharge/submit
 *
 * Lawyer submits the UTR after paying. Moves the request from 'created' →
 * 'submitted' and sends a push notification to the developer.
 *
 * Body: { requestId: string, utr: string }
 *
 * Security:
 *   - requireRealAppUser, lawyer role only.
 *   - Only the request owner can submit it.
 *   - Requests older than 48 hours are marked expired on read.
 *   - UTR must be exactly 12 digits. DB enforces uniqueness.
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireRealAppUser } from '@/lib/auth/requestUser';
import { createServiceClient } from '@/lib/supabase/service';
import { logServerError } from '@/lib/log/serverLog';
import { sendPushToOwner, isPushConfigured } from '@/lib/push/server';

const UTR_RE = /^\d{12}$/;
const EXPIRY_HOURS = 48;

/** Find the developer's auth user ID via approved_users + auth.admin. */
async function findDeveloperUserId(service: any): Promise<string | null> {
  try {
    const { data: row } = await service
      .from('approved_users')
      .select('email')
      .eq('role', 'developer')
      .maybeSingle();
    if (!row?.email) return null;

    const { data: list } = await service.auth.admin.listUsers({ perPage: 1000 });
    const devUser = list?.users?.find(
      (u: any) => u.email?.toLowerCase() === row.email.toLowerCase()
    );
    return devUser?.id ?? null;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  const user = await requireRealAppUser(request);
  if (!user) return NextResponse.json({ error: 'Sign in to submit payment.' }, { status: 401 });
  if (user.app_metadata?.role !== 'lawyer') {
    return NextResponse.json({ error: 'Only lawyer accounts can submit payments.' }, { status: 403 });
  }

  let body: { requestId?: unknown; utr?: unknown };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid request.' }, { status: 400 }); }

  const requestId = typeof body.requestId === 'string' ? body.requestId.trim() : '';
  const utr       = typeof body.utr       === 'string' ? body.utr.trim()       : '';

  if (!requestId) {
    return NextResponse.json({ error: 'Request ID is required.' }, { status: 400 });
  }
  if (!UTR_RE.test(utr)) {
    return NextResponse.json({ error: 'UTR must be exactly 12 digits.' }, { status: 400 });
  }

  const service = createServiceClient() as any;
  const ownerId = user.id;

  try {
    // ── Fetch the request ─────────────────────────────────────────────────────
    const { data: req, error: fetchErr } = await service
      .from('payment_requests')
      .select('id, owner_id, kind, status, ref_code, amount_expected_paise, created_at')
      .eq('id', requestId)
      .maybeSingle();
    if (fetchErr) throw fetchErr;

    if (!req) {
      return NextResponse.json({ error: 'Recharge request not found.' }, { status: 404 });
    }
    if (req.owner_id !== ownerId) {
      return NextResponse.json({ error: 'Recharge request not found.' }, { status: 404 });
    }
    if (req.kind !== 'recharge') {
      return NextResponse.json({ error: 'Invalid request type.' }, { status: 400 });
    }

    // ── Expire stale 'created' requests on read ───────────────────────────────
    if (req.status === 'created') {
      const ageHours = (Date.now() - new Date(req.created_at).getTime()) / 3_600_000;
      if (ageHours > EXPIRY_HOURS) {
        await service
          .from('payment_requests')
          .update({ status: 'expired' })
          .eq('id', requestId)
          .eq('status', 'created');
        return NextResponse.json(
          { error: 'This recharge request has expired (more than 48 hours old). Please create a new one.' },
          { status: 410 }
        );
      }
    }

    if (req.status !== 'created') {
      const msg =
        req.status === 'submitted' ? 'This request has already been submitted.' :
        req.status === 'approved'  ? 'This request has already been approved.' :
        req.status === 'rejected'  ? 'This request was rejected. Please create a new one.' :
        req.status === 'expired'   ? 'This request has expired. Please create a new one.' :
        'This request cannot be submitted.';
      return NextResponse.json({ error: msg }, { status: 409 });
    }

    // ── Submit: set status + UTR ──────────────────────────────────────────────
    const now = new Date().toISOString();
    const { error: updateErr } = await service
      .from('payment_requests')
      .update({ status: 'submitted', utr, submitted_at: now })
      .eq('id', requestId)
      .eq('status', 'created');   // guard against a race

    if (updateErr) {
      // Unique violation on UTR column
      if (updateErr.code === '23505' || updateErr.message?.includes('unique') || updateErr.message?.includes('utr')) {
        return NextResponse.json(
          { error: 'This UTR reference was already used for another request. Please check and try again.' },
          { status: 409 }
        );
      }
      throw updateErr;
    }

    // ── Push notification to developer (best-effort) ──────────────────────────
    if (isPushConfigured()) {
      const devId = await findDeveloperUserId(service);
      if (devId) {
        const amountRs = Math.round(Number(req.amount_expected_paise) / 100);
        sendPushToOwner(service, devId, {
          title: 'New recharge to confirm',
          body:  `Rs ${amountRs} — ref ${req.ref_code}. Check your UPI app.`,
          url:   '/app/settings',
          tag:   'recharge-inbox',
        }).catch((err) => logServerError('recharge/submit/push', err, { requestId }));
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    await logServerError('api/ai/recharge/submit', err, { userId: user.id, requestId });
    return NextResponse.json({ error: 'Could not submit payment. Please try again.' }, { status: 500 });
  }
}
