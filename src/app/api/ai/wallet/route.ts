/**
 * GET /api/ai/wallet?period=month|all
 *
 * Lawyer's own wallet: balances, usage, activity, payment requests, config.
 *
 * Security:
 *   - requireRealAppUser (lawyers + developer, device-enforced). Developer is
 *     redirected (they use the developer card).
 *   - Service client is used ONLY to read app_config (RLS revoked for authenticated).
 *     All wallet / ledger / payment_request reads go through the anon client so RLS
 *     scopes them to owner_id = auth.uid() — same guarantee as a direct client call.
 *   - Never returns: internal_usage rows from other owners, decided_by, Sarvam balance,
 *     adjustment notes (shown as "Credits adjusted by support").
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireRealAppUser } from '@/lib/auth/requestUser';
import { createServiceClient } from '@/lib/supabase/service';
import { logServerError } from '@/lib/log/serverLog';

// ── Human-readable feature metadata ──────────────────────────────────────────

const FEATURE_META: Record<string, { label: string; unitLabel: string }> = {
  stt:           { label: 'Dictation',        unitLabel: 'minutes' },
  translate:     { label: 'Translation',      unitLabel: 'characters' },
  transliterate: { label: 'Script conversion', unitLabel: 'characters' },
  ocr:           { label: 'Document scanning', unitLabel: 'pages' },
};

function humanRate(feature: string, unit: string, paisePer: number): string {
  if (feature === 'stt') {
    const hourly = Math.round((paisePer * 3600) / 100);
    return `Rs ${hourly} per hour`;
  }
  if (feature === 'translate' || feature === 'transliterate') {
    const per10k = Math.round((paisePer * 10000) / 100);
    return `Rs ${per10k} per 10,000 characters`;
  }
  if (feature === 'ocr') {
    return `Rs ${(paisePer / 100).toFixed(2)} per page`;
  }
  return `Rs ${(paisePer / 100).toFixed(2)} per ${unit}`;
}

function activityLabel(kind: string, feature: string | null): string {
  if (kind === 'usage') {
    const label = feature ? FEATURE_META[feature]?.label : null;
    return label ? `Used ${label}` : 'AI usage';
  }
  if (kind === 'grant_included') return 'Included credits added';
  if (kind === 'recharge')       return 'Recharge credited';
  if (kind === 'adjustment')     return 'Credits adjusted by support';
  if (kind === 'refund')         return 'Refund';
  return 'Account activity';
}

// ── Route ─────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const user = await requireRealAppUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Sign in to view your AI credits.' }, { status: 401 });
  }

  // Developer uses the developer card; this endpoint is for lawyers only.
  if (user.app_metadata?.role === 'developer') {
    return NextResponse.json({ error: 'Use the developer AI usage screen.' }, { status: 403 });
  }

  const period = new URL(request.url).searchParams.get('period') === 'all' ? 'all' : 'month';
  const service = createServiceClient() as any;

  // ownerId = caller (Phase D will extend this for team members via workspace_owner_of)
  const ownerId = user.id;

  try {
    // ── Wallet ────────────────────────────────────────────────────────────────
    const { data: wallet, error: walletErr } = await service
      .from('ai_wallets')
      .select('included_paise, included_expires_at, purchased_paise, status, daily_cap_paise')
      .eq('owner_id', ownerId)
      .maybeSingle();
    if (walletErr) throw walletErr;

    // ── Config (service client bypasses the `REVOKE ALL FROM authenticated` on app_config) ──
    const { data: configRows, error: cfgErr } = await service
      .from('app_config')
      .select('key, value')
      .in('key', ['min_recharge_paise', 'recharge_credit_percent', 'low_balance_paise']);
    if (cfgErr) throw cfgErr;

    const cfg: Record<string, number> = {};
    for (const row of configRows ?? []) {
      cfg[row.key] = Number(row.value);
    }

    // ── Rate card (authenticated users can SELECT; service client works too) ─
    const { data: rates, error: rateErr } = await service
      .from('ai_rate_card')
      .select('feature, unit, paise_per_unit')
      .order('feature');
    if (rateErr) throw rateErr;

    // ── Usage by feature for the period ──────────────────────────────────────
    let usageQuery = service
      .from('ai_ledger')
      .select('feature, amount_paise, units')
      .eq('owner_id', ownerId)
      .eq('kind', 'usage')
      .lt('amount_paise', 0);   // debits are negative

    if (period === 'month') {
      const start = new Date();
      start.setDate(1);
      start.setHours(0, 0, 0, 0);
      usageQuery = usageQuery.gte('created_at', start.toISOString());
    }

    const { data: usageRows, error: usageErr } = await usageQuery;
    if (usageErr) throw usageErr;

    const byFeature: Record<string, { paise: number; units: number }> = {};
    let totalUsedPaise = 0;
    for (const row of usageRows ?? []) {
      const f = row.feature ?? 'other';
      if (!byFeature[f]) byFeature[f] = { paise: 0, units: 0 };
      const abs = Math.abs(Number(row.amount_paise));
      byFeature[f].paise += abs;
      byFeature[f].units += Number(row.units ?? 0);
      totalUsedPaise += abs;
    }

    // ── Activity (latest 50 rows; adjustment notes are stripped) ─────────────
    const { data: actRows, error: actErr } = await service
      .from('ai_ledger')
      .select('id, kind, bucket, amount_paise, feature, created_at')
      .eq('owner_id', ownerId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (actErr) throw actErr;

    // ── Payment requests (recharge kind only) ────────────────────────────────
    const { data: payRows, error: payErr } = await service
      .from('payment_requests')
      .select('id, ref_code, status, amount_expected_paise, credited_paise, created_at, submitted_at, decided_at, decision_note')
      .eq('owner_id', ownerId)
      .eq('kind', 'recharge')
      .order('created_at', { ascending: false })
      .limit(50);
    if (payErr) throw payErr;

    // ── Derived fields ────────────────────────────────────────────────────────
    const includedExpired = wallet?.included_expires_at
      ? new Date(wallet.included_expires_at) < new Date()
      : false;

    const lowBalPaise = cfg.low_balance_paise ?? 2000;
    const includedLeft  = wallet ? Number(wallet.included_paise) : 0;
    const purchasedLeft = wallet ? Number(wallet.purchased_paise) : 0;
    const effectiveBalance = includedExpired ? purchasedLeft : includedLeft + purchasedLeft;
    const lowBalance = wallet !== null && effectiveBalance > 0 && effectiveBalance <= lowBalPaise;

    return NextResponse.json({
      wallet: wallet
        ? {
            included_paise:      includedLeft,
            included_expires_at: wallet.included_expires_at ?? null,
            included_expired:    includedExpired,
            purchased_paise:     purchasedLeft,
            status:              wallet.status,
            daily_cap_paise:     wallet.daily_cap_paise !== null ? Number(wallet.daily_cap_paise) : null,
          }
        : null,
      low_balance: lowBalance,
      usage: {
        period,
        by_feature: Object.entries(byFeature).map(([feature, v]) => ({
          feature,
          label:      FEATURE_META[feature]?.label ?? feature,
          amount_paise: v.paise,
          units:      v.units,
          unit_label: FEATURE_META[feature]?.unitLabel ?? 'units',
        })),
        total_paise: totalUsedPaise,
      },
      activity: (actRows ?? []).map((row: any) => ({
        id:           row.id,
        kind:         row.kind,
        label:        activityLabel(row.kind, row.feature),
        bucket:       row.bucket,
        amount_paise: Number(row.amount_paise),
        feature:      row.feature ?? null,
        created_at:   row.created_at,
      })),
      payment_requests: (payRows ?? []).map((row: any) => ({
        id:                    row.id,
        ref_code:              row.ref_code,
        status:                row.status,
        amount_expected_paise: Number(row.amount_expected_paise),
        credited_paise:        row.credited_paise !== null ? Number(row.credited_paise) : null,
        created_at:            row.created_at,
        submitted_at:          row.submitted_at ?? null,
        decided_at:            row.decided_at ?? null,
        // Show the rejection reason to the lawyer; never show adjustment notes.
        decision_note: row.status === 'rejected' ? (row.decision_note ?? null) : null,
      })),
      config: {
        min_recharge_paise:       cfg.min_recharge_paise       ?? 10000,
        recharge_credit_percent:  cfg.recharge_credit_percent  ?? 85,
        low_balance_paise:        cfg.low_balance_paise        ?? 2000,
      },
      rate_card: (rates ?? []).map((r: any) => ({
        feature:        r.feature,
        unit:           r.unit,
        paise_per_unit: Number(r.paise_per_unit),
        human_label:    humanRate(r.feature, r.unit, Number(r.paise_per_unit)),
      })),
    });
  } catch (err) {
    await logServerError('api/ai/wallet', err, { userId: user.id });
    return NextResponse.json(
      { error: 'Could not load your AI credits. Please try again.' },
      { status: 500 }
    );
  }
}
