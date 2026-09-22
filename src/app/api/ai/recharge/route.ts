/**
 * POST /api/ai/recharge
 *
 * Creates a payment_requests row for a UPI recharge.
 * Body: { amountRupees: number }
 *
 * Security:
 *   - requireRealAppUser, lawyer role only (developer never pays).
 *   - All writes use the service client (lawyers have no INSERT on payment_requests).
 *   - UPI VPA and payee name come from app_config in the live DB only —
 *     they are NEVER committed to this file or any migration.
 *
 * Returns: { requestId, refCode, amountRupees, creditsRupees, upiUrl, vpa }
 *   upiUrl = upi://pay?pa=<VPA>&pn=<PAYEE>&am=<amount>&cu=INR&tn=<refCode>
 *   vpa    = bare VPA for the "copy VPA" fallback (already inside upiUrl, returned
 *            separately so the UI doesn't have to parse the URL)
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireRealAppUser } from '@/lib/auth/requestUser';
import { createServiceClient } from '@/lib/supabase/service';
import { logServerError } from '@/lib/log/serverLog';

const MAX_RECHARGE_RUPEES = 10_000;
const OPEN_REQUEST_LIMIT  = 5;

function randomRefCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let s = '';
  // crypto.getRandomValues is available in the Node.js 19+ / Edge runtime
  const buf = new Uint8Array(6);
  crypto.getRandomValues(buf);
  for (const b of buf) s += chars[b % chars.length];
  return 'VD-' + s;
}

export async function POST(request: NextRequest) {
  const user = await requireRealAppUser(request);
  if (!user) return NextResponse.json({ error: 'Sign in to recharge.' }, { status: 401 });
  if (user.app_metadata?.role !== 'lawyer') {
    return NextResponse.json({ error: 'Only lawyer accounts can recharge.' }, { status: 403 });
  }

  let body: { amountRupees?: unknown };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid request.' }, { status: 400 }); }

  const amountRupees = Number(body.amountRupees);
  if (!Number.isInteger(amountRupees) || amountRupees <= 0) {
    return NextResponse.json({ error: 'Amount must be a whole number of rupees.' }, { status: 400 });
  }
  if (amountRupees % 10 !== 0) {
    return NextResponse.json({ error: 'Amount must be in multiples of Rs 10.' }, { status: 400 });
  }
  if (amountRupees > MAX_RECHARGE_RUPEES) {
    return NextResponse.json({ error: `Maximum recharge is Rs ${MAX_RECHARGE_RUPEES.toLocaleString('en-IN')}.` }, { status: 400 });
  }

  const service = createServiceClient() as any;
  const ownerId = user.id;

  try {
    // ── Read config ───────────────────────────────────────────────────────────
    const { data: cfgRows, error: cfgErr } = await service
      .from('app_config')
      .select('key, value')
      .in('key', ['min_recharge_paise', 'recharge_credit_percent', 'upi_vpa', 'upi_payee_name']);
    if (cfgErr) throw cfgErr;

    const cfg: Record<string, string | number> = {};
    for (const r of cfgRows ?? []) cfg[r.key] = r.value;

    const minRechargeRupees = Math.ceil(Number(cfg.min_recharge_paise ?? 10000) / 100);
    if (amountRupees < minRechargeRupees) {
      return NextResponse.json(
        { error: `Minimum recharge is Rs ${minRechargeRupees}.` },
        { status: 400 }
      );
    }

    const creditPercent = Number(cfg.recharge_credit_percent ?? 85);
    const vpa = String(cfg.upi_vpa ?? '').trim();
    const payeeName = String(cfg.upi_payee_name ?? '').trim();

    if (!vpa) {
      // UPI not configured yet in app_config — tell the lawyer to contact support.
      return NextResponse.json(
        { error: 'UPI payments are not yet configured. Please contact support.' },
        { status: 503 }
      );
    }

    // ── Rate-limit: max 5 open requests ──────────────────────────────────────
    const { count, error: countErr } = await service
      .from('payment_requests')
      .select('id', { count: 'exact', head: true })
      .eq('owner_id', ownerId)
      .eq('kind', 'recharge')
      .in('status', ['created', 'submitted']);
    if (countErr) throw countErr;

    if ((count ?? 0) >= OPEN_REQUEST_LIMIT) {
      return NextResponse.json(
        { error: 'You already have 5 pending recharge requests. Please wait for them to be confirmed or contact support.' },
        { status: 429 }
      );
    }

    // ── Create the payment_requests row (retry ref_code on collision) ─────────
    let requestId: string | null = null;
    let refCode = '';
    for (let attempt = 0; attempt < 5; attempt++) {
      refCode = randomRefCode();
      const { data: inserted, error: insertErr } = await service
        .from('payment_requests')
        .insert({
          owner_id:              ownerId,
          requested_by:          ownerId,
          kind:                  'recharge',
          amount_expected_paise: amountRupees * 100,
          ref_code:              refCode,
          status:                'created',
        })
        .select('id')
        .single();

      if (!insertErr) {
        requestId = inserted.id;
        break;
      }
      // unique violation on ref_code — retry
      if (!insertErr.message?.includes('unique') && !insertErr.code?.includes('23505')) {
        throw insertErr;
      }
    }
    if (!requestId) throw new Error('Could not generate a unique reference code. Please try again.');

    // ── Build UPI URL ─────────────────────────────────────────────────────────
    const upiUrl =
      `upi://pay?pa=${encodeURIComponent(vpa)}` +
      `&pn=${encodeURIComponent(payeeName)}` +
      `&am=${amountRupees}` +
      `&cu=INR` +
      `&tn=${encodeURIComponent(refCode)}`;

    const creditsRupees = Math.floor(amountRupees * creditPercent / 100);

    return NextResponse.json({
      requestId,
      refCode,
      amountRupees,
      creditsRupees,
      upiUrl,
      vpa,
    });
  } catch (err) {
    await logServerError('api/ai/recharge', err, { userId: user.id });
    return NextResponse.json({ error: 'Could not create recharge request. Please try again.' }, { status: 500 });
  }
}
