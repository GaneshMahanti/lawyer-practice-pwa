'use client';

import React, { useCallback, useEffect, useState } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface FeatureUsage { spentPaise: number; units: number; calls: number; }

interface LawyerUsage {
  ownerId: string | null;
  name: string;
  email: string;
  signedIn: boolean;
  isActive: boolean;
  aiEnabled: boolean;
  feeGranted: boolean;
  hasWallet: boolean;
  walletStatus: string | null;
  dailyCapPaise: number | null;
  includedPaise: number;
  includedExpiresAt: string | null;
  includedExpired: boolean;
  purchasedPaise: number;
  spentPaise: number;
  calls: number;
  lastUsedAt: string | null;
  byFeature: Record<string, FeatureUsage>;
}

interface RecentRow {
  id: string; at: string; lawyer: string; kind: string; bucket: string;
  amountPaise: number; feature: string | null; units: number | null; note: string | null;
}

interface UsageResponse {
  period: 'month' | 'all';
  totals: { includedPaise: number; purchasedPaise: number; spentPaise: number; calls: number; walletCount: number; creditsOutstandingPaise: number; };
  internal: { spentPaise: number; byFeature: Record<string, FeatureUsage> };
  sarvam: null | { recordedPaise: number; recordedAt: string; note: string | null; spentSincePaise: number; estimatedRemainingPaise: number; };
  lawyers: LawyerUsage[];
  recent: RecentRow[];
}

interface InboxItem {
  id: string;
  owner: { name: string; email: string };
  refCode: string;
  amountExpectedPaise: number;
  utr: string | null;
  submittedAt: string;
  createdAt: string;
}

interface ReceivedItem {
  id: string;
  owner: { name: string; email: string };
  refCode: string;
  amountExpectedPaise: number;
  amountReceivedPaise: number;
  creditedPaise: number;
  sharePaise: number;
  utr: string | null;
  decidedAt: string;
}

interface PaymentsResponse {
  inbox: InboxItem[];
  received: ReceivedItem[];
  totals: { expectedPaise: number; receivedPaise: number; creditedPaise: number; sharePaise: number };
  toTopUpPaise: number;
}

interface ConfigResponse {
  config: Record<string, unknown>;
  rate_card: Array<{ feature: string; unit: string; paise_per_unit: number }>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const FEATURE_LABEL: Record<string, string> = {
  stt: 'Dictation', translate: 'Translation', transliterate: 'Script conversion', ocr: 'Document OCR',
};

function rupees(paise: number): string {
  return `\u20B9${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function rs(paise: number): string { return `Rs ${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }

function units(feature: string, value: number): string {
  if (feature === 'stt') return `${(value / 60).toFixed(1)} min`;
  if (feature === 'ocr') return `${Math.round(value)} page${Math.round(value) === 1 ? '' : 's'}`;
  return `${Math.round(value).toLocaleString('en-IN')} chars`;
}

function when(iso: string | null): string {
  if (!iso) return 'never';
  return new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });
}

function dateOnly(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' });
}

function describe(row: RecentRow): string {
  const feature = row.feature ? FEATURE_LABEL[row.feature] ?? row.feature : '';
  switch (row.kind) {
    case 'usage':          return `Used ${feature}`.trim();
    case 'refund':         return `Refund ${feature}`.trim();
    case 'adjustment':     return `Extra charge ${feature}`.trim();
    case 'grant_included': return 'Included credits granted';
    case 'recharge':       return 'Recharge credited';
    case 'admin_adjustment': return row.note ? `Adjusted by you: ${row.note}` : 'Adjusted by you';
    case 'internal_usage': return `Your own ${feature}`.trim();
    default:               return row.kind;
  }
}

const tile = (label: string, value: string, hint: string) => (
  <div key={label} style={{ padding: '8px 8px', borderRadius: 10, background: 'var(--bg-surface-elevated)', textAlign: 'center' }}>
    <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)', fontWeight: 600 }}>{label}</div>
    <div style={{ fontSize: '0.98rem', fontWeight: 800, color: 'var(--text-primary)' }}>{value}</div>
    <div style={{ fontSize: '0.64rem', color: 'var(--text-muted)' }}>{hint}</div>
  </div>
);

const smallBtn: React.CSSProperties = { fontSize: '0.74rem', padding: '5px 10px', minHeight: 0 };

const TABS = ['Usage', 'Payments', 'Config'] as const;
type Tab = typeof TABS[number];

// ── Main component ────────────────────────────────────────────────────────────

/** Developer-only Settings card: see and control every lawyer's AI credits. */
export function AiUsageDeveloperCard() {
  const [tab, setTab] = useState<Tab>('Usage');
  const [period, setPeriod] = useState<'month' | 'all'>('month');

  // Usage tab
  const [data, setData] = useState<UsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);
  const [formFor, setFormFor] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [bucket, setBucket] = useState<'purchased' | 'included'>('purchased');
  const [note, setNote] = useState('');
  const [sarvamInput, setSarvamInput] = useState('');

  // Payments tab
  const [payments, setPayments] = useState<PaymentsResponse | null>(null);
  const [paymentsLoading, setPaymentsLoading] = useState(false);
  const [paymentsFailed, setPaymentsFailed] = useState(false);
  const [monthFilter, setMonthFilter] = useState('');  // "YYYY-MM"
  const [approving, setApproving] = useState<string | null>(null);
  const [approveAmounts, setApproveAmounts] = useState<Record<string, string>>({});
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [rejectNotes, setRejectNotes] = useState<Record<string, string>>({});
  const [topupInput, setTopupInput] = useState('');
  const [paymentsNotice, setPaymentsNotice] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);
  const [paymentsBusy, setPaymentsBusy] = useState<string | null>(null);

  // Config tab
  const [configData, setConfigData] = useState<ConfigResponse | null>(null);
  const [configLoading, setConfigLoading] = useState(false);
  const [configFailed, setConfigFailed] = useState(false);
  const [configEdits, setConfigEdits] = useState<Record<string, string>>({});
  const [rateEdits, setRateEdits] = useState<Record<string, string>>({});
  const [configBusy, setConfigBusy] = useState<string | null>(null);
  const [configNotice, setConfigNotice] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);
  const [killBusy, setKillBusy] = useState(false);

  // ── Data loaders ────────────────────────────────────────────────────────────

  const loadUsage = useCallback(async (p: 'month' | 'all') => {
    setLoading(true); setFailed(false);
    try {
      const res = await fetch(`/api/admin/ai-usage?period=${p}`, { cache: 'no-store' });
      if (!res.ok) throw new Error('request failed');
      setData(await res.json());
    } catch { setFailed(true); } finally { setLoading(false); }
  }, []);

  const loadPayments = useCallback(async (month?: string) => {
    setPaymentsLoading(true); setPaymentsFailed(false);
    try {
      const qs = month ? `?month=${month}` : '';
      const res = await fetch(`/api/admin/payments${qs}`, { cache: 'no-store' });
      if (!res.ok) throw new Error('request failed');
      setPayments(await res.json());
    } catch { setPaymentsFailed(true); } finally { setPaymentsLoading(false); }
  }, []);

  const loadConfig = useCallback(async () => {
    setConfigLoading(true); setConfigFailed(false);
    try {
      const res = await fetch('/api/admin/config', { cache: 'no-store' });
      if (!res.ok) throw new Error('request failed');
      const d: ConfigResponse = await res.json();
      setConfigData(d);
      const edits: Record<string, string> = {};
      for (const [k, v] of Object.entries(d.config)) edits[k] = String(v ?? '');
      setConfigEdits(edits);
      const rEdits: Record<string, string> = {};
      for (const r of d.rate_card) rEdits[r.feature] = String(r.paise_per_unit);
      setRateEdits(rEdits);
    } catch { setConfigFailed(true); } finally { setConfigLoading(false); }
  }, []);

  useEffect(() => { void loadUsage(period); }, [loadUsage, period]);
  useEffect(() => { if (tab === 'Payments') void loadPayments(monthFilter || undefined); }, [loadPayments, tab, monthFilter]);
  useEffect(() => { if (tab === 'Config') void loadConfig(); }, [loadConfig, tab]);

  // ── Shared API helper ───────────────────────────────────────────────────────

  const send = async (key: string, url: string, payload: Record<string, unknown>, okText: string, reload?: () => void): Promise<boolean> => {
    setBusy(key); setNotice(null);
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotice({ type: 'error', text: typeof body?.error === 'string' && body.error ? body.error : 'Something went wrong.' });
        return false;
      }
      setNotice({ type: 'ok', text: body?.already ? 'Already granted earlier.' : okText });
      if (reload) reload(); else await loadUsage(period);
      return true;
    } catch {
      setNotice({ type: 'error', text: 'Something went wrong.' });
      return false;
    } finally { setBusy(null); }
  };

  const act = (key: string, payload: Record<string, unknown>, okText: string) =>
    send(key, '/api/admin/ai-credits', payload, okText);

  // ── Usage tab actions ───────────────────────────────────────────────────────

  const grantIncluded = (l: LawyerUsage) => {
    if (!l.ownerId) return;
    if (!window.confirm(`Mark the app fee as received from ${l.name} and give them Rs 1,000 of included AI credits? This can only be done once.`)) return;
    void act(`grant:${l.ownerId}`, { action: 'grant_included', ownerId: l.ownerId }, 'Rs 1,000 included credits added.');
  };

  const submitAdjust = async (l: LawyerUsage) => {
    if (!l.ownerId) return;
    const value = Number(amount);
    if (!Number.isFinite(value) || value === 0) { setNotice({ type: 'error', text: 'Enter an amount in rupees (use a minus sign to remove credits).' }); return; }
    const verb = value > 0 ? 'Add' : 'Remove';
    if (!window.confirm(`${verb} Rs ${Math.abs(value).toLocaleString('en-IN')} ${bucket === 'purchased' ? 'recharged' : 'included'} credits for ${l.name}?`)) return;
    const ok = await act(`adjust:${l.ownerId}`, { action: 'adjust', ownerId: l.ownerId, bucket, amountRupees: value, note }, value > 0 ? 'Credits added.' : 'Credits removed.');
    if (ok) { setFormFor(null); setAmount(''); setNote(''); }
  };

  const toggleStatus = (l: LawyerUsage) => {
    if (!l.ownerId) return;
    const next = l.walletStatus === 'paused' ? 'active' : 'paused';
    void act(`status:${l.ownerId}`, { action: 'set_status', ownerId: l.ownerId, status: next }, next === 'paused' ? 'AI paused for this lawyer.' : 'AI resumed for this lawyer.');
  };

  const changeDailyCap = (l: LawyerUsage) => {
    if (!l.ownerId) return;
    const current = l.dailyCapPaise === null ? 'default (Rs 200)' : `Rs ${(l.dailyCapPaise / 100).toLocaleString('en-IN')}`;
    const input = window.prompt(`Daily AI limit for ${l.name} in rupees. Currently ${current}. Leave empty to use the default.`, '');
    if (input === null) return;
    void act(`cap:${l.ownerId}`, { action: 'set_daily_cap', ownerId: l.ownerId, capRupees: input.trim() === '' ? null : Number(input) }, 'Daily limit updated.');
  };

  const saveSarvamBalance = async () => {
    const ok = await send('sarvam', '/api/admin/sarvam-balance', { balanceRupees: Number(sarvamInput) }, 'Sarvam balance recorded.');
    if (ok) setSarvamInput('');
  };

  // ── Payments tab actions ────────────────────────────────────────────────────

  const pmSend = async (key: string, url: string, payload: Record<string, unknown>, okText: string): Promise<boolean> => {
    setPaymentsBusy(key); setPaymentsNotice(null);
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPaymentsNotice({ type: 'error', text: body?.error ?? 'Something went wrong.' });
        return false;
      }
      setPaymentsNotice({ type: 'ok', text: okText });
      void loadPayments(monthFilter || undefined);
      return true;
    } catch {
      setPaymentsNotice({ type: 'error', text: 'Something went wrong.' });
      return false;
    } finally { setPaymentsBusy(null); }
  };

  const handleApprove = async (item: InboxItem) => {
    const inputRs = approveAmounts[item.id] ?? String(item.amountExpectedPaise / 100);
    const rs = Number(inputRs);
    if (!Number.isFinite(rs) || rs <= 0) {
      setPaymentsNotice({ type: 'error', text: 'Enter the amount you received.' });
      return;
    }
    // Approval confirmation: "Approve only after you see this payment in your bank/UPI app."
    if (!window.confirm(
      `Approve only after you see this payment in your bank/UPI app.\n\nRef: ${item.refCode}\nUTR: ${item.utr ?? 'not provided'}\nAmount: Rs ${rs}\n\nCredit the lawyer now?`
    )) return;
    const ok = await pmSend(`approve:${item.id}`, '/api/admin/payments/decision',
      { action: 'approve', requestId: item.id, amountReceivedRupees: rs },
      `Approved — Rs ${rs} received, credits added to lawyer's wallet.`
    );
    if (ok) { setApproving(null); setApproveAmounts(prev => { const n = { ...prev }; delete n[item.id]; return n; }); }
  };

  const handleReject = async (item: InboxItem) => {
    const note = rejectNotes[item.id]?.trim() ?? '';
    if (!note) { setPaymentsNotice({ type: 'error', text: 'Add a reason before rejecting.' }); return; }
    if (!window.confirm(`Reject this payment from ${item.owner.name}?\n\nRef: ${item.refCode}\nReason: ${note}\n\nThe lawyer will see "Not received — contact support".`)) return;
    const ok = await pmSend(`reject:${item.id}`, '/api/admin/payments/decision',
      { action: 'reject', requestId: item.id, note },
      'Rejected. The lawyer has been notified.'
    );
    if (ok) { setRejecting(null); setRejectNotes(prev => { const n = { ...prev }; delete n[item.id]; return n; }); }
  };

  const handleTopup = async () => {
    const rs = Number(topupInput);
    if (!rs || rs <= 0) { setPaymentsNotice({ type: 'error', text: 'Enter the amount you added to Sarvam.' }); return; }
    if (!window.confirm(`Record that you added Rs ${rs} to Sarvam?\nYou should also update the Sarvam balance number after this.`)) return;
    const ok = await pmSend('topup', '/api/admin/payments/topup', { amountRupees: rs }, 'Sarvam top-up recorded. Remember to update the balance.');
    if (ok) setTopupInput('');
  };

  // ── Config tab actions ──────────────────────────────────────────────────────

  const cfgSend = async (key: string, payload: Record<string, unknown>, okText: string): Promise<boolean> => {
    setConfigBusy(key); setConfigNotice(null);
    try {
      const res = await fetch('/api/admin/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setConfigNotice({ type: 'error', text: body?.error ?? 'Something went wrong.' }); return false; }
      setConfigNotice({ type: 'ok', text: okText });
      return true;
    } catch { setConfigNotice({ type: 'error', text: 'Something went wrong.' }); return false; }
    finally { setConfigBusy(null); }
  };

  const saveConfigKey = (k: string) =>
    cfgSend(`cfg:${k}`, { type: 'config', key: k, value: configEdits[k] }, `${k} saved.`);

  const saveRateCard = (feature: string) =>
    cfgSend(`rate:${feature}`, { type: 'rate_card', feature, paise_per_unit: Number(rateEdits[feature]) }, `Rate for ${feature} saved.`);

  const handleKillswitch = async (action: 'pause_all' | 'resume_all') => {
    const label = action === 'pause_all' ? "PAUSE all lawyers' AI" : "RESUME all lawyers' AI";
    if (!window.confirm(`${label}? This affects every lawyer at once.`)) return;
    setKillBusy(true); setConfigNotice(null);
    try {
      const res = await fetch('/api/admin/payments/killswitch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setConfigNotice({ type: 'error', text: body?.error ?? 'Something went wrong.' }); }
      else { setConfigNotice({ type: 'ok', text: action === 'pause_all' ? 'All wallets paused.' : 'All wallets resumed.' }); void loadUsage(period); }
    } catch { setConfigNotice({ type: 'error', text: 'Something went wrong.' }); }
    finally { setKillBusy(false); }
  };

  // ── Derived ─────────────────────────────────────────────────────────────────

  const periodLabel   = period === 'month' ? 'this month' : 'all time';
  const purchasedOwed = data?.totals.purchasedPaise ?? 0;
  const sarvamLow     = data?.sarvam ? data.sarvam.estimatedRemainingPaise < purchasedOwed : false;

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="card">
      <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <span>AI credits and usage</span>
        <button
          type="button" className="action-btn" style={smallBtn}
          onClick={() => { if (tab === 'Usage') loadUsage(period); else if (tab === 'Payments') loadPayments(monthFilter || undefined); else loadConfig(); }}
          disabled={loading || paymentsLoading || configLoading || busy !== null}
        >
          {loading || paymentsLoading || configLoading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {/* ── Tab bar ── */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        {TABS.map(t => (
          <button
            key={t} type="button"
            onClick={() => { setTab(t); setNotice(null); setPaymentsNotice(null); setConfigNotice(null); }}
            style={{
              flex: 1, padding: '6px 0', borderRadius: 10, border: '1px solid var(--card-brd)',
              background: tab === t ? 'var(--accent-primary, var(--accent))' : 'var(--bg-card)',
              color: tab === t ? '#fff' : 'var(--text-primary)',
              fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer',
            }}
          >{t}</button>
        ))}
      </div>

      {/* ══════════════════ USAGE TAB ══════════════════ */}
      {tab === 'Usage' && (
        <>
          {notice && (
            <div role={notice.type === 'error' ? 'alert' : 'status'}
              style={{ padding: '8px 10px', borderRadius: 8, fontSize: '0.82rem', marginBottom: 10,
                background: notice.type === 'error' ? 'var(--status-danger-bg)' : 'var(--status-success-bg)',
                color: notice.type === 'error' ? 'var(--status-danger)' : 'var(--status-success)' }}>
              {notice.text}
            </div>
          )}
          {failed && <div style={{ padding: '8px 10px', borderRadius: 8, background: 'var(--status-danger-bg)', color: 'var(--status-danger)', fontSize: '0.82rem', marginBottom: 10 }}>Could not load AI usage.</div>}

          {data && (
            <>
              {/* Sarvam balance */}
              <div style={{ padding: '10px 12px', borderRadius: 12, background: 'var(--bg-surface-elevated)', border: '1px solid var(--border-subtle)', marginBottom: 12 }}>
                <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)' }}>Your Sarvam credits left (estimate)</div>
                {data.sarvam ? (
                  <>
                    <div style={{ fontSize: '1.3rem', fontWeight: 800, color: sarvamLow ? 'var(--status-danger)' : 'var(--text-primary)' }}>
                      {rupees(data.sarvam.estimatedRemainingPaise)}
                    </div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                      Recorded {rupees(data.sarvam.recordedPaise)} on {when(data.sarvam.recordedAt)}; app metered {rupees(data.sarvam.spentSincePaise)} since.
                    </div>
                    {sarvamLow && (
                      <div style={{ marginTop: 6, fontSize: '0.78rem', fontWeight: 700, color: 'var(--status-danger)' }}>
                        Top up Sarvam: lawyers hold {rupees(purchasedOwed)} recharged credits, more than your Sarvam balance.
                      </div>
                    )}
                  </>
                ) : (
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Not recorded yet. Enter the "Credits left" from the Sarvam dashboard Billing page.</div>
                )}
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  <input className="input-field" type="number" inputMode="decimal" min="0" step="0.01" placeholder="Sarvam credits left (Rs)" value={sarvamInput} onChange={e => setSarvamInput(e.target.value)} style={{ flex: 1, minWidth: 0 }} />
                  <button type="button" className="action-btn action-btn-primary" style={smallBtn} disabled={busy !== null || !sarvamInput.trim()} onClick={saveSarvamBalance}>
                    {busy === 'sarvam' ? 'Saving…' : 'Update'}
                  </button>
                </div>
                <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)', marginTop: 4 }}>Update after every Sarvam top-up. Estimates drift if you skip it.</div>
              </div>

              <div className="seg" style={{ marginBottom: 12 }}>
                <button type="button" className={period === 'month' ? 'on' : ''} onClick={() => setPeriod('month')}>This month</button>
                <button type="button" className={period === 'all' ? 'on' : ''} onClick={() => setPeriod('all')}>All time</button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 8 }}>
                {tile('Credits owed', rupees(data.totals.creditsOutstandingPaise), 'to lawyers')}
                {tile(`Lawyers used ${periodLabel}`, rupees(data.totals.spentPaise), `${data.totals.calls} calls`)}
                {tile('Lawyers funded', String(data.totals.walletCount), `of ${data.lawyers.length}`)}
              </div>
              <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', marginBottom: 14 }}>
                Your own AI {periodLabel}: <strong style={{ color: 'var(--text-primary)' }}>{rupees(data.internal.spentPaise)}</strong> (from your Sarvam balance, not charged to any lawyer).
              </div>

              {data.lawyers.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No lawyers yet.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {data.lawyers.map((l) => (
                    <div key={l.email} style={{ padding: '10px 12px', borderRadius: 12, background: 'var(--bg-surface-elevated)', border: '1px solid var(--border-subtle)' }}>
                      <div style={{ fontWeight: 700, fontSize: '0.88rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.name}</div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {l.email}{!l.hasWallet && ' · no AI credits yet'}{l.walletStatus === 'paused' && ' · AI PAUSED'}{!l.aiEnabled && ' · AI switched off'}{!l.isActive && ' · account paused'}
                      </div>
                      {l.hasWallet ? (
                        <>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
                            <div>
                              <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Included left</div>
                              <div style={{ fontWeight: 700, fontSize: '0.92rem', color: l.includedExpired ? 'var(--status-danger)' : 'var(--text-primary)' }}>{l.includedExpired ? 'Expired' : rupees(l.includedPaise)}</div>
                              {l.includedExpiresAt && <div style={{ fontSize: '0.64rem', color: 'var(--text-muted)' }}>{l.includedExpired ? 'ended' : 'until'} {dateOnly(l.includedExpiresAt)}</div>}
                            </div>
                            <div>
                              <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Recharged left</div>
                              <div style={{ fontWeight: 700, fontSize: '0.92rem' }}>{rupees(l.purchasedPaise)}</div>
                              <div style={{ fontSize: '0.64rem', color: 'var(--text-muted)' }}>never expire</div>
                            </div>
                          </div>
                          <div style={{ marginTop: 8, fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                            Used {periodLabel}: <strong>{rupees(l.spentPaise)}</strong> in {l.calls} call{l.calls === 1 ? '' : 's'}{' · '}last {when(l.lastUsedAt)}{' · '}cap {l.dailyCapPaise === null ? 'default' : rupees(l.dailyCapPaise)}
                          </div>
                          {Object.keys(l.byFeature).length > 0 && (
                            <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 2 }}>
                              {Object.entries(l.byFeature).map(([feature, u]) => (
                                <div key={feature} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
                                  <span>{FEATURE_LABEL[feature] ?? feature} · {units(feature, u.units)} · {u.calls} call{u.calls === 1 ? '' : 's'}</span>
                                  <span style={{ fontWeight: 600 }}>{rupees(u.spentPaise)}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </>
                      ) : (
                        <div style={{ marginTop: 6, fontSize: '0.76rem', color: 'var(--text-muted)' }}>
                          {l.signedIn ? 'No AI credits yet. Give the included Rs 1,000 once the app fee is received, or add credits below.' : 'Has not signed in yet.'}
                        </div>
                      )}
                      {l.signedIn && l.ownerId && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                          {!l.feeGranted && (
                            <button type="button" className="action-btn action-btn-primary" style={smallBtn} disabled={busy !== null} onClick={() => grantIncluded(l)}>
                              {busy === `grant:${l.ownerId}` ? 'Adding…' : 'App fee received: give Rs 1,000'}
                            </button>
                          )}
                          <button type="button" className="action-btn" style={smallBtn} disabled={busy !== null} onClick={() => { setFormFor(formFor === l.ownerId ? null : l.ownerId); setNotice(null); }}>
                            {formFor === l.ownerId ? 'Close' : 'Add / remove credits'}
                          </button>
                          {l.hasWallet && (
                            <>
                              <button type="button" className="action-btn" style={smallBtn} disabled={busy !== null} onClick={() => toggleStatus(l)}>
                                {l.walletStatus === 'paused' ? 'Resume AI' : 'Pause AI'}
                              </button>
                              <button type="button" className="action-btn" style={smallBtn} disabled={busy !== null} onClick={() => changeDailyCap(l)}>
                                Daily limit
                              </button>
                            </>
                          )}
                        </div>
                      )}
                      {formFor === l.ownerId && (
                        <div style={{ marginTop: 10, padding: 10, borderRadius: 10, background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <input className="input-field" type="number" inputMode="decimal" step="0.01" placeholder="Rs (minus to remove)" value={amount} onChange={e => setAmount(e.target.value)} style={{ flex: 1, minWidth: 0 }} />
                            <select className="input-field" value={bucket} onChange={e => setBucket(e.target.value === 'included' ? 'included' : 'purchased')} style={{ flex: 1, minWidth: 0 }}>
                              <option value="purchased">Recharged (never expires)</option>
                              <option value="included">Included (expires)</option>
                            </select>
                          </div>
                          <input className="input-field" type="text" placeholder="Note (required)" value={note} onChange={e => setNote(e.target.value)} maxLength={200} style={{ marginTop: 6 }} />
                          <button type="button" className="action-btn action-btn-primary" style={{ ...smallBtn, marginTop: 8, width: '100%', justifyContent: 'center' }}
                            disabled={busy !== null || note.trim().length < 3 || amount.trim() === ''} onClick={() => submitAdjust(l)}>
                            {busy === `adjust:${l.ownerId}` ? 'Saving…' : 'Save change'}
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--text-muted)', margin: '14px 0 6px' }}>Latest activity</div>
              {data.recent.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>No AI activity yet.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {data.recent.map(r => (
                    <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: '0.74rem', padding: '4px 8px', borderRadius: 6, background: 'var(--bg-surface-elevated)' }}>
                      <span style={{ minWidth: 0, color: 'var(--text-secondary)' }}>
                        <strong style={{ color: 'var(--text-primary)' }}>{r.lawyer}</strong> · {describe(r)}
                        {r.units !== null && r.feature ? ` · ${units(r.feature, r.units)}` : ''}
                        <span style={{ color: 'var(--text-muted)' }}> · {r.bucket} · {when(r.at)}</span>
                      </span>
                      <span style={{ fontWeight: 700, whiteSpace: 'nowrap', color: r.amountPaise < 0 ? 'var(--status-danger)' : 'var(--status-success)' }}>
                        {r.amountPaise < 0 ? '-' : '+'}{rupees(Math.abs(r.amountPaise))}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* ══════════════════ PAYMENTS TAB ══════════════════ */}
      {tab === 'Payments' && (
        <>
          {paymentsNotice && (
            <div role={paymentsNotice.type === 'error' ? 'alert' : 'status'}
              style={{ padding: '8px 10px', borderRadius: 8, fontSize: '0.82rem', marginBottom: 10,
                background: paymentsNotice.type === 'error' ? 'var(--status-danger-bg)' : 'var(--status-success-bg)',
                color: paymentsNotice.type === 'error' ? 'var(--status-danger)' : 'var(--status-success)' }}>
              {paymentsNotice.text}
            </div>
          )}
          {paymentsFailed && <div style={{ padding: '8px 10px', borderRadius: 8, background: 'var(--status-danger-bg)', color: 'var(--status-danger)', fontSize: '0.82rem', marginBottom: 10 }}>Could not load payments.</div>}

          {payments && (
            <>
              {/* ── Inbox ── */}
              <div style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Inbox — {payments.inbox.length} pending
              </div>

              {payments.inbox.length === 0 ? (
                <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: 16 }}>No payments waiting.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
                  {payments.inbox.map(item => (
                    <div key={item.id} style={{ padding: '10px 12px', borderRadius: 12, background: 'var(--bg-surface-elevated)', border: '1px solid var(--status-warning)', borderLeftWidth: 3 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: '0.88rem' }}>{item.owner.name}</div>
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{item.owner.email}</div>
                          <div style={{ fontSize: '0.8rem', marginTop: 4 }}>
                            Expects: <strong>{rs(item.amountExpectedPaise)}</strong>
                          </div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 2 }}>
                            Ref: <code style={{ fontFamily: 'monospace' }}>{item.refCode}</code>
                            {item.utr && <> · UTR: <code style={{ fontFamily: 'monospace' }}>{item.utr}</code></>}
                          </div>
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Submitted {when(item.submittedAt)}</div>
                        </div>
                      </div>

                      {/* Approve / Reject controls */}
                      <div style={{ marginTop: 10, padding: '8px 10px', borderRadius: 8, background: 'var(--status-warning-bg)', fontSize: '0.75rem', color: 'var(--status-warning)', fontWeight: 600, marginBottom: 8 }}>
                        Approve only after you see this payment (amount + ref code or UTR) in your bank/UPI app.
                      </div>

                      {approving === item.id ? (
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 180 }}>
                            <span style={{ fontSize: '0.78rem', whiteSpace: 'nowrap' }}>Rs received:</span>
                            <input
                              className="input-field" type="number" inputMode="decimal" min="0" step="0.01"
                              value={approveAmounts[item.id] ?? String(item.amountExpectedPaise / 100)}
                              onChange={e => setApproveAmounts(prev => ({ ...prev, [item.id]: e.target.value }))}
                              style={{ flex: 1, minWidth: 0 }}
                            />
                          </div>
                          <button type="button" className="action-btn action-btn-primary" style={smallBtn} disabled={paymentsBusy !== null} onClick={() => handleApprove(item)}>
                            {paymentsBusy === `approve:${item.id}` ? 'Approving…' : 'Confirm approve'}
                          </button>
                          <button type="button" className="action-btn" style={smallBtn} onClick={() => setApproving(null)}>Cancel</button>
                        </div>
                      ) : rejecting === item.id ? (
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <input className="input-field" type="text" placeholder="Reason for rejection (shown to lawyer)" value={rejectNotes[item.id] ?? ''}
                            onChange={e => setRejectNotes(prev => ({ ...prev, [item.id]: e.target.value }))} style={{ flex: 1, minWidth: 150 }} />
                          <button type="button" className="action-btn" style={{ ...smallBtn, background: 'var(--status-danger-bg)', color: 'var(--status-danger)', border: 'none' }} disabled={paymentsBusy !== null} onClick={() => handleReject(item)}>
                            {paymentsBusy === `reject:${item.id}` ? 'Rejecting…' : 'Confirm reject'}
                          </button>
                          <button type="button" className="action-btn" style={smallBtn} onClick={() => setRejecting(null)}>Cancel</button>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button type="button" className="action-btn action-btn-primary" style={smallBtn} onClick={() => { setApproving(item.id); setRejecting(null); }}>Approve</button>
                          <button type="button" className="action-btn" style={{ ...smallBtn, color: 'var(--status-danger)' }} onClick={() => { setRejecting(item.id); setApproving(null); }}>Reject</button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* ── To top up on Sarvam ── */}
              {payments.toTopUpPaise > 0 && (
                <div style={{ padding: '10px 12px', borderRadius: 12, background: 'var(--status-warning-bg)', border: '1px solid var(--status-warning)', marginBottom: 14 }}>
                  <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--status-warning)', marginBottom: 4 }}>
                    Add {rs(payments.toTopUpPaise)} to Sarvam
                  </div>
                  <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', marginBottom: 8 }}>
                    You've credited lawyers {rs(payments.toTopUpPaise)} more than you've recorded adding to Sarvam. Top up to cover it, then update your Sarvam balance.
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input className="input-field" type="number" inputMode="decimal" min="0" step="1" placeholder={`Rs (suggested: ${Math.ceil(payments.toTopUpPaise / 100)})`} value={topupInput} onChange={e => setTopupInput(e.target.value)} style={{ flex: 1, minWidth: 0 }} />
                    <button type="button" className="action-btn action-btn-primary" style={smallBtn} disabled={paymentsBusy !== null || !topupInput} onClick={handleTopup}>
                      {paymentsBusy === 'topup' ? 'Saving…' : 'I added this to Sarvam'}
                    </button>
                  </div>
                </div>
              )}

              {/* ── Received list ── */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Received</div>
                <input type="month" value={monthFilter} onChange={e => setMonthFilter(e.target.value)}
                  style={{ fontSize: '0.75rem', padding: '3px 6px', borderRadius: 6, border: '1px solid var(--card-brd)', background: 'var(--bg-card)', color: 'var(--text-primary)' }} />
              </div>

              {payments.received.length === 0 ? (
                <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: 12 }}>No approved payments{monthFilter ? ' in this period' : ' yet'}.</div>
              ) : (
                <>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
                    {payments.received.map(r => (
                      <div key={r.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 6, fontSize: '0.75rem', padding: '6px 8px', borderRadius: 8, background: 'var(--bg-surface-elevated)' }}>
                        <div>
                          <strong>{r.owner.name}</strong>
                          {' · '}Ref <code style={{ fontFamily: 'monospace' }}>{r.refCode}</code>
                          {r.utr && <> · UTR <code style={{ fontFamily: 'monospace' }}>{r.utr}</code></>}
                          <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>{dateOnly(r.decidedAt)}</div>
                        </div>
                        <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                          <div>Rcvd <strong>{rs(r.amountReceivedPaise)}</strong></div>
                          <div style={{ color: 'var(--status-success)' }}>Credited {rs(r.creditedPaise)}</div>
                          <div style={{ color: 'var(--text-secondary)' }}>Your share {rs(r.sharePaise)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                  {/* Month totals */}
                  <div style={{ padding: '8px 10px', borderRadius: 8, background: 'var(--bg-surface-elevated)', fontSize: '0.8rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Total received</span><strong>{rs(payments.totals.receivedPaise)}</strong></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Total credited to lawyers</span><span style={{ color: 'var(--status-success)' }}>{rs(payments.totals.creditedPaise)}</span></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Your share (service charge)</span><strong>{rs(payments.totals.sharePaise)}</strong></div>
                  </div>
                </>
              )}
            </>
          )}
        </>
      )}

      {/* ══════════════════ CONFIG TAB ══════════════════ */}
      {tab === 'Config' && (
        <>
          {configNotice && (
            <div role={configNotice.type === 'error' ? 'alert' : 'status'}
              style={{ padding: '8px 10px', borderRadius: 8, fontSize: '0.82rem', marginBottom: 10,
                background: configNotice.type === 'error' ? 'var(--status-danger-bg)' : 'var(--status-success-bg)',
                color: configNotice.type === 'error' ? 'var(--status-danger)' : 'var(--status-success)' }}>
              {configNotice.text}
            </div>
          )}
          {configFailed && <div style={{ padding: '8px 10px', borderRadius: 8, background: 'var(--status-danger-bg)', color: 'var(--status-danger)', fontSize: '0.82rem', marginBottom: 10 }}>Could not load config.</div>}

          {configData && (
            <>
              {/* ── Kill switch ── */}
              <div style={{ padding: '10px 12px', borderRadius: 12, background: 'var(--status-danger-bg)', border: '1px solid var(--status-danger)', marginBottom: 14 }}>
                <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--status-danger)', marginBottom: 6 }}>AI kill switch — affects every lawyer at once</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" className="action-btn" style={{ ...smallBtn, background: 'var(--status-danger)', color: '#fff', border: 'none' }} disabled={killBusy} onClick={() => handleKillswitch('pause_all')}>
                    {killBusy ? '…' : 'Pause ALL'}
                  </button>
                  <button type="button" className="action-btn action-btn-primary" style={smallBtn} disabled={killBusy} onClick={() => handleKillswitch('resume_all')}>
                    {killBusy ? '…' : 'Resume ALL'}
                  </button>
                </div>
              </div>

              {/* ── Editable config keys ── */}
              <div style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Config</div>

              {CONFIG_META.map(({ key, label, hint, isString }) => (
                <div key={key} style={{ marginBottom: 10 }}>
                  <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 3 }}>{label}</label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input
                      className="input-field"
                      type={isString ? 'text' : 'number'}
                      value={configEdits[key] ?? ''}
                      onChange={e => setConfigEdits(prev => ({ ...prev, [key]: e.target.value }))}
                      placeholder={hint}
                      style={{ flex: 1, minWidth: 0, fontSize: '0.82rem' }}
                    />
                    <button type="button" className="action-btn action-btn-primary" style={smallBtn} disabled={configBusy !== null} onClick={() => saveConfigKey(key)}>
                      {configBusy === `cfg:${key}` ? '…' : 'Save'}
                    </button>
                  </div>
                  <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: 2 }}>{hint}</div>
                </div>
              ))}

              {/* ── Rate card ── */}
              <div style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--text-muted)', margin: '14px 0 8px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>AI rate card (paise per unit)</div>
              {configData.rate_card.map(r => (
                <div key={r.feature} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                  <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', minWidth: 120 }}>{FEATURE_LABEL[r.feature] ?? r.feature} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>/{r.unit}</span></label>
                  <input
                    className="input-field"
                    type="number"
                    step="any"
                    min="0"
                    value={rateEdits[r.feature] ?? ''}
                    onChange={e => setRateEdits(prev => ({ ...prev, [r.feature]: e.target.value }))}
                    style={{ flex: 1, minWidth: 0, fontSize: '0.82rem' }}
                  />
                  <button type="button" className="action-btn action-btn-primary" style={smallBtn} disabled={configBusy !== null} onClick={() => saveRateCard(r.feature)}>
                    {configBusy === `rate:${r.feature}` ? '…' : 'Save'}
                  </button>
                </div>
              ))}
            </>
          )}
        </>
      )}
    </div>
  );
}

// ── Constants ─────────────────────────────────────────────────────────────────

const CONFIG_META: Array<{ key: string; label: string; hint: string; isString?: boolean }> = [
  { key: 'recharge_credit_percent', label: 'Credit percent (50–100)',   hint: 'Integer. E.g. 85 means lawyer gets 85% of amount received.' },
  { key: 'min_recharge_paise',      label: 'Min recharge (paise)',      hint: 'E.g. 10000 = Rs 100 minimum.' },
  { key: 'included_credit_paise',   label: 'Included credits (paise)',  hint: 'App-fee grant. E.g. 100000 = Rs 1,000.' },
  { key: 'low_balance_paise',       label: 'Low-balance warning (paise)', hint: 'Show warning when balance falls below this. E.g. 2000 = Rs 20.' },
  { key: 'daily_ai_cap_paise',      label: 'Default daily cap (paise)', hint: 'Default spend limit per wallet per day. E.g. 20000 = Rs 200.' },
  { key: 'upi_vpa',                 label: 'UPI VPA',                   hint: 'Your UPI ID. Not committed to source — live DB only.', isString: true },
  { key: 'upi_payee_name',          label: 'UPI payee name',            hint: 'Name shown in UPI payment screen.', isString: true },
];
