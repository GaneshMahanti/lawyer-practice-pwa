/**
 * GET /api/admin/payments   (DEVELOPER ONLY)
 *
 * Returns:
 *   inbox:    submitted payment_requests (pending approval)
 *   received: approved recharge requests with derived developer share
 *   topup:    net amount still to top up on Sarvam (credited recharges - recorded topups)
 *   monthFilter: ISO start of the filter period (optional ?month=YYYY-MM)
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireDeveloperUser } from '@/lib/auth/requestUser';
import { createServiceClient } from '@/lib/supabase/service';
import { logServerError } from '@/lib/log/serverLog';

export async function GET(request: NextRequest) {
  const dev = await requireDeveloperUser(request);
  if (!dev) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const db = createServiceClient() as any;
  const monthParam = request.nextUrl.searchParams.get('month'); // e.g. "2026-09"

  try {
    // ── Build a per-owner name map from approved_users ────────────────────────
    const { data: auRows } = await db
      .from('approved_users')
      .select('auth_user_id, name, email')
      .eq('role', 'lawyer');
    const nameMap: Record<string, { name: string; email: string }> = {};
    for (const r of auRows ?? []) {
      if (r.auth_user_id) nameMap[r.auth_user_id] = { name: r.name ?? r.email, email: r.email };
    }

    // ── Inbox: submitted requests ─────────────────────────────────────────────
    const { data: inboxRows, error: inboxErr } = await db
      .from('payment_requests')
      .select('id, owner_id, kind, ref_code, amount_expected_paise, utr, submitted_at, created_at')
      .eq('kind', 'recharge')
      .eq('status', 'submitted')
      .order('submitted_at', { ascending: true });
    if (inboxErr) throw inboxErr;

    // ── Received: approved recharge requests ──────────────────────────────────
    let receivedQuery = db
      .from('payment_requests')
      .select('id, owner_id, ref_code, amount_expected_paise, amount_received_paise, credited_paise, utr, decided_at')
      .eq('kind', 'recharge')
      .eq('status', 'approved')
      .order('decided_at', { ascending: false });

    if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
      const start = new Date(`${monthParam}-01T00:00:00.000Z`);
      const end   = new Date(start);
      end.setMonth(end.getMonth() + 1);
      receivedQuery = receivedQuery
        .gte('decided_at', start.toISOString())
        .lt('decided_at', end.toISOString());
    }

    const { data: receivedRows, error: receivedErr } = await receivedQuery;
    if (receivedErr) throw receivedErr;

    // ── Month totals for received list ────────────────────────────────────────
    let expectedTotal = 0, receivedTotal = 0, creditedTotal = 0;
    for (const r of receivedRows ?? []) {
      expectedTotal += Number(r.amount_expected_paise ?? 0);
      receivedTotal += Number(r.amount_received_paise ?? 0);
      creditedTotal += Number(r.credited_paise ?? 0);
    }

    // ── "To top up on Sarvam": sum(credited approved) - sum(sarvam_topups) ───
    const { data: allCredited } = await db
      .from('payment_requests')
      .select('credited_paise')
      .eq('kind', 'recharge')
      .eq('status', 'approved');
    const totalCreditedAllTime = (allCredited ?? []).reduce(
      (s: number, r: any) => s + Number(r.credited_paise ?? 0), 0
    );

    const { data: topupRows } = await db
      .from('sarvam_topups')
      .select('amount_paise');
    const totalTopupsAllTime = (topupRows ?? []).reduce(
      (s: number, r: any) => s + Number(r.amount_paise ?? 0), 0
    );

    const toTopUpPaise = Math.max(0, totalCreditedAllTime - totalTopupsAllTime);

    return NextResponse.json({
      inbox: (inboxRows ?? []).map((r: any) => ({
        id:                    r.id,
        owner:                 nameMap[r.owner_id] ?? { name: r.owner_id, email: '' },
        refCode:               r.ref_code,
        amountExpectedPaise:   Number(r.amount_expected_paise),
        utr:                   r.utr ?? null,
        submittedAt:           r.submitted_at,
        createdAt:             r.created_at,
      })),
      received: (receivedRows ?? []).map((r: any) => {
        const received  = Number(r.amount_received_paise ?? r.amount_expected_paise ?? 0);
        const credited  = Number(r.credited_paise ?? 0);
        return {
          id:                  r.id,
          owner:               nameMap[r.owner_id] ?? { name: r.owner_id, email: '' },
          refCode:             r.ref_code,
          amountExpectedPaise: Number(r.amount_expected_paise),
          amountReceivedPaise: received,
          creditedPaise:       credited,
          sharePaise:          received - credited,   // derived; never stored
          utr:                 r.utr ?? null,
          decidedAt:           r.decided_at,
        };
      }),
      totals: {
        expectedPaise:   expectedTotal,
        receivedPaise:   receivedTotal,
        creditedPaise:   creditedTotal,
        sharePaise:      receivedTotal - creditedTotal,
      },
      toTopUpPaise,
    });
  } catch (err) {
    await logServerError('api/admin/payments', err, { developerId: dev.id });
    return NextResponse.json({ error: 'Could not load payments. Please try again.' }, { status: 500 });
  }
}
