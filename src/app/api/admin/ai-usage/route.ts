import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireDeveloperUser } from '@/lib/auth/requestUser';
import { createServiceClient } from '@/lib/supabase/service';
import { logServerError } from '@/lib/log/serverLog';

/**
 * GET /api/admin/ai-usage?period=month|all   (DEVELOPER ONLY)
 *
 * Read-only AI credit overview for the developer's Settings screen: every lawyer's
 * Included / Recharged balance, what they spent (this month in IST, or all time), a
 * per-feature breakdown, the developer's own usage, the Sarvam balance estimate, and the
 * latest ledger activity.
 * Lawyers can never call this: it uses requireDeveloperUser and the service client.
 */

interface WalletRow {
  owner_id: string;
  included_paise: number | string;
  included_expires_at: string | null;
  purchased_paise: number | string;
  status: string;
  daily_cap_paise: number | string | null;
  spent_paise: number | string;
  calls: number | string;
  by_feature: Record<string, { spent_paise: number | string; units: number | string; calls: number | string }>;
  last_used_at: string | null;
}

type FeatureRaw = { spent_paise: number | string; units: number | string; calls: number | string };

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const mapFeatures = (raw: Record<string, FeatureRaw> | undefined) =>
  Object.fromEntries(
    Object.entries(raw ?? {}).map(([feature, v]) => [
      feature,
      { spentPaise: num(v.spent_paise), units: num(v.units), calls: num(v.calls) },
    ]),
  );

/** Start of the current calendar month in IST, as a UTC ISO string. */
function startOfMonthIstIso(): string {
  const IST_MS = 5.5 * 60 * 60 * 1000;
  const ist = new Date(Date.now() + IST_MS);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), 1) - IST_MS).toISOString();
}

export async function GET(request: NextRequest) {
  const dev = await requireDeveloperUser(request);
  if (!dev) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const period = request.nextUrl.searchParams.get('period') === 'all' ? 'all' : 'month';
  const since = period === 'month' ? startOfMonthIstIso() : null;

  let db: any;
  try {
    db = createServiceClient();
  } catch {
    return NextResponse.json({ error: 'Service key not configured on server.' }, { status: 503 });
  }

  try {
    const [report, lawyerRows, ledgerRows, snapshotRows] = await Promise.all([
      db.rpc('admin_ai_usage_report', { p_since: since }),
      db
        .from('approved_users')
        .select('email, name, auth_user_id, is_active, ai_enabled, app_fee_paid_at, included_granted_at')
        .eq('role', 'lawyer'),
      db
        .from('ai_ledger')
        .select('id, owner_id, kind, bucket, amount_paise, feature, units, request_ref, created_at')
        .order('created_at', { ascending: false })
        .limit(30),
      db
        .from('sarvam_balance_snapshots')
        .select('balance_paise, note, created_at')
        .order('created_at', { ascending: false })
        .limit(1),
    ]);

    if (report.error) throw new Error(`report failed: ${report.error.message}`);
    if (lawyerRows.error) throw new Error(`lawyers query failed: ${lawyerRows.error.message}`);
    if (ledgerRows.error) throw new Error(`ledger query failed: ${ledgerRows.error.message}`);
    // A missing snapshot table or empty table just means "no balance recorded yet".
    const snapshot = snapshotRows.error ? null : (snapshotRows.data?.[0] ?? null);

    const wallets: WalletRow[] = (report.data?.wallets as WalletRow[]) ?? [];
    const walletByOwner = new Map<string, WalletRow>(wallets.map((w) => [w.owner_id, w]));
    const now = Date.now();

    const lawyers = (lawyerRows.data as any[]).map((l) => {
      const w = l.auth_user_id ? walletByOwner.get(l.auth_user_id) : undefined;
      const includedExpired = w?.included_expires_at ? new Date(w.included_expires_at).getTime() <= now : false;
      return {
        ownerId: (l.auth_user_id as string | null) ?? null,
        name: l.name || l.email,
        email: l.email,
        signedIn: Boolean(l.auth_user_id),
        isActive: l.is_active === true,
        aiEnabled: l.ai_enabled !== false,
        feeGranted: Boolean(l.included_granted_at),
        hasWallet: Boolean(w),
        walletStatus: w?.status ?? null,
        dailyCapPaise: w?.daily_cap_paise == null ? null : num(w.daily_cap_paise),
        includedPaise: w ? num(w.included_paise) : 0,
        includedExpiresAt: w?.included_expires_at ?? null,
        includedExpired,
        purchasedPaise: w ? num(w.purchased_paise) : 0,
        spentPaise: w ? num(w.spent_paise) : 0,
        calls: w ? num(w.calls) : 0,
        lastUsedAt: w?.last_used_at ?? null,
        byFeature: mapFeatures(w?.by_feature),
      };
    });

    const nameByOwner = new Map<string, string>();
    for (const l of lawyerRows.data as any[]) {
      if (l.auth_user_id) nameByOwner.set(l.auth_user_id, l.name || l.email);
    }

    const totals = lawyers.reduce(
      (acc, l) => {
        acc.includedPaise += l.includedExpired ? 0 : l.includedPaise;
        acc.purchasedPaise += l.purchasedPaise;
        acc.spentPaise += l.spentPaise;
        acc.calls += l.calls;
        if (l.hasWallet) acc.walletCount += 1;
        return acc;
      },
      { includedPaise: 0, purchasedPaise: 0, spentPaise: 0, calls: 0, walletCount: 0 },
    );

    // Developer's own (internal) usage in the selected period.
    const internalByFeature = mapFeatures(report.data?.internal as Record<string, FeatureRaw> | undefined);
    const internalSpentPaise = Object.values(internalByFeature).reduce((s, f) => s + f.spentPaise, 0);

    // Sarvam balance: the number the developer typed from the Sarvam dashboard, minus what the
    // app has metered since then (lawyers' net spend + the developer's own usage).
    let sarvam: null | {
      recordedPaise: number;
      recordedAt: string;
      note: string | null;
      spentSincePaise: number;
      estimatedRemainingPaise: number;
    } = null;
    if (snapshot) {
      const sinceRows = await db
        .from('ai_ledger')
        .select('amount_paise')
        .in('kind', ['usage', 'adjustment', 'refund', 'internal_usage'])
        .gte('created_at', snapshot.created_at)
        .limit(20000);
      if (sinceRows.error) throw new Error(`sarvam estimate failed: ${sinceRows.error.message}`);
      const spentSincePaise = (sinceRows.data as any[]).reduce((s, r) => s - num(r.amount_paise), 0);
      sarvam = {
        recordedPaise: num(snapshot.balance_paise),
        recordedAt: snapshot.created_at,
        note: snapshot.note ?? null,
        spentSincePaise,
        estimatedRemainingPaise: num(snapshot.balance_paise) - spentSincePaise,
      };
    }

    const recent = (ledgerRows.data as any[]).map((r) => ({
      id: r.id,
      at: r.created_at,
      lawyer: r.kind === 'internal_usage' ? 'You (developer)' : nameByOwner.get(r.owner_id) ?? 'Unknown',
      kind: r.kind,
      bucket: r.bucket,
      amountPaise: num(r.amount_paise),
      feature: r.feature,
      units: r.units === null ? null : num(r.units),
      note: r.kind === 'admin_adjustment' ? (r.request_ref as string | null) : null,
    }));

    return NextResponse.json({
      period,
      since,
      generatedAt: report.data?.generated_at ?? new Date().toISOString(),
      totals: {
        ...totals,
        /** Credits currently owed to lawyers (unexpired Included + Recharged). */
        creditsOutstandingPaise: totals.includedPaise + totals.purchasedPaise,
      },
      internal: { spentPaise: internalSpentPaise, byFeature: internalByFeature },
      sarvam,
      lawyers,
      recent,
    });
  } catch (err) {
    await logServerError('api/admin/ai-usage', err, { userId: dev.id });
    return NextResponse.json({ error: 'Could not load AI usage.' }, { status: 500 });
  }
}
