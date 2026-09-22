'use client';

/**
 * AiCreditsCard — lawyer's own AI credits screen (Settings → "AI credits")
 *
 * Shows:
 *  - Included and Recharged credit balances (two separate tiles, never merged)
 *  - Usage by feature for this month (or all time)
 *  - Activity list (latest 50 rows)
 *  - Recharge request history
 *  - Low-balance warning and zero-balance stop message
 *  - Full 3-step UPI recharge flow (C5)
 *
 * Rules:
 *  - Developer never shown this card (settings page renders the developer card).
 *  - Demo accounts never shown this card (settings page guards on role).
 *  - Credit percent and min recharge always read from API; never hardcoded.
 *  - UPI VPA comes from the server at runtime; never committed to source.
 */

import React, { useState, useEffect, useCallback } from 'react';
import QRCode from 'react-qr-code';

// ── Types ─────────────────────────────────────────────────────────────────────

interface WalletData {
  included_paise: number;
  included_expires_at: string | null;
  included_expired: boolean;
  purchased_paise: number;
  status: 'active' | 'paused';
  daily_cap_paise: number | null;
}

interface UsageFeature {
  feature: string;
  label: string;
  amount_paise: number;
  units: number;
  unit_label: string;
}

interface ActivityRow {
  id: string;
  kind: string;
  label: string;
  bucket: string;
  amount_paise: number;
  feature: string | null;
  created_at: string;
}

interface PaymentRequest {
  id: string;
  ref_code: string;
  status: string;
  amount_expected_paise: number;
  credited_paise: number | null;
  created_at: string;
  submitted_at: string | null;
  decided_at: string | null;
  decision_note: string | null;
}

interface RateCard {
  feature: string;
  unit: string;
  paise_per_unit: number;
  human_label: string;
}

interface WalletResponse {
  wallet: WalletData | null;
  low_balance: boolean;
  usage: { period: string; by_feature: UsageFeature[]; total_paise: number };
  activity: ActivityRow[];
  payment_requests: PaymentRequest[];
  config: { min_recharge_paise: number; recharge_credit_percent: number; low_balance_paise: number };
  rate_card: RateCard[];
}

interface RechargeCreated {
  requestId: string;
  refCode: string;
  amountRupees: number;
  creditsRupees: number;
  upiUrl: string;
  vpa: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function rupees(paise: number): string {
  return (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function statusBadge(status: string): { label: string; color: string; bg: string } {
  switch (status) {
    case 'created':   return { label: 'Pending payment',      color: 'var(--text-secondary)', bg: 'transparent' };
    case 'submitted': return { label: 'Waiting for approval', color: 'var(--status-warning)',  bg: 'var(--status-warning-bg)' };
    case 'approved':  return { label: 'Credited',             color: 'var(--status-success)',  bg: 'var(--status-success-bg)' };
    case 'rejected':  return { label: 'Not received',         color: 'var(--status-danger)',   bg: 'var(--status-danger-bg)' };
    case 'expired':   return { label: 'Expired',              color: 'var(--text-muted)',      bg: 'transparent' };
    default:          return { label: status,                 color: 'var(--text-muted)',      bg: 'transparent' };
  }
}

async function copyText(text: string): Promise<void> {
  try { await navigator.clipboard.writeText(text); } catch { /* ignore */ }
}

// ── BalanceTile ───────────────────────────────────────────────────────────────

function BalanceTile({ title, paise, sub, highlight, expired }: {
  title: string; paise: number; sub?: string; highlight?: boolean; expired?: boolean;
}) {
  return (
    <div style={{
      flex: 1, minWidth: 0,
      background: highlight ? 'var(--accent-bg, rgba(100,160,255,0.1))' : 'var(--bg-surface-active, rgba(0,0,0,0.05))',
      borderRadius: 12, padding: '12px 14px',
      border: '1px solid var(--card-brd)',
      opacity: expired ? 0.5 : 1,
    }}>
      <div style={{ fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 4 }}>
        {title}{expired ? ' (expired)' : ''}
      </div>
      <div style={{ fontSize: '1.35rem', fontWeight: 700, color: expired ? 'var(--text-muted)' : 'var(--text-primary)', letterSpacing: '-0.01em' }}>
        Rs {rupees(paise)}
      </div>
      {sub && <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// ── RechargeFlow ─────────────────────────────────────────────────────────────

const QUICK_AMOUNTS = [100, 200, 500, 1000];

function RechargeFlow({
  config,
  onDone,
}: {
  config: WalletResponse['config'];
  onDone: () => void;
}) {
  const minRs       = Math.ceil(config.min_recharge_paise / 100);
  const creditPct   = config.recharge_credit_percent;

  const [step, setStep]             = useState<'amount' | 'payment' | 'utr' | 'done'>('amount');
  const [selectedRs, setSelectedRs] = useState<number | null>(null);
  const [customRs, setCustomRs]     = useState('');
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError]     = useState<string | null>(null);
  const [created, setCreated]       = useState<RechargeCreated | null>(null);

  const [utrInput, setUtrInput]         = useState('');
  const [submitLoading, setSubmitLoading] = useState(false);
  const [submitError, setSubmitError]     = useState<string | null>(null);

  const [copied, setCopied] = useState<string | null>(null);

  function effectiveRs(): number | null {
    if (selectedRs !== null) return selectedRs;
    const n = parseInt(customRs, 10);
    return Number.isInteger(n) && n > 0 ? n : null;
  }

  function creditsForRs(rs: number): number {
    return Math.floor(rs * creditPct / 100);
  }

  function validateAmount(): string | null {
    const rs = effectiveRs();
    if (rs === null) return 'Please enter an amount.';
    if (!Number.isInteger(rs) || rs <= 0) return 'Amount must be a whole number.';
    if (rs % 10 !== 0) return 'Amount must be a multiple of Rs 10.';
    if (rs < minRs) return `Minimum recharge is Rs ${minRs}.`;
    if (rs > 10000) return 'Maximum recharge is Rs 10,000.';
    return null;
  }

  async function handleCreate() {
    const err = validateAmount();
    if (err) { setCreateError(err); return; }
    setCreateLoading(true);
    setCreateError(null);
    try {
      const res = await fetch('/api/ai/recharge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amountRupees: effectiveRs() }),
      });
      const body = await res.json();
      if (!res.ok) { setCreateError(body.error ?? 'Could not create request.'); return; }
      setCreated(body as RechargeCreated);
      setStep('payment');
    } catch {
      setCreateError('Network error. Please try again.');
    } finally {
      setCreateLoading(false);
    }
  }

  async function handleSubmit() {
    if (!created) return;
    if (!/^\d{12}$/.test(utrInput)) {
      setSubmitError('UTR must be exactly 12 digits.');
      return;
    }
    setSubmitLoading(true);
    setSubmitError(null);
    try {
      const res = await fetch('/api/ai/recharge/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: created.requestId, utr: utrInput }),
      });
      const body = await res.json();
      if (!res.ok) { setSubmitError(body.error ?? 'Could not submit.'); return; }
      setStep('done');
    } catch {
      setSubmitError('Network error. Please try again.');
    } finally {
      setSubmitLoading(false);
    }
  }

  async function handleCopy(text: string, key: string) {
    await copyText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 1800);
  }

  const sectionStyle: React.CSSProperties = {
    background: 'var(--bg-surface-active, rgba(0,0,0,0.04))',
    borderRadius: 12,
    padding: '14px',
    marginBottom: 14,
    border: '1px solid var(--card-brd)',
  };

  const rowStyle: React.CSSProperties = {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    fontSize: '0.82rem', padding: '4px 0',
  };

  // ── Step: amount ─────────────────────────────────────────────────────────
  if (step === 'amount') {
    const rs = effectiveRs();
    return (
      <div style={sectionStyle}>
        <div style={{ fontSize: '0.82rem', fontWeight: 700, marginBottom: 10 }}>
          Recharge AI credits — Step 1 of 3
        </div>

        {/* Quick-select buttons */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          {QUICK_AMOUNTS.filter(a => a >= minRs).map(a => (
            <button
              key={a}
              type="button"
              onClick={() => { setSelectedRs(a); setCustomRs(''); setCreateError(null); }}
              className="action-btn"
              style={{
                padding: '6px 14px',
                fontSize: '0.82rem',
                background: selectedRs === a ? 'var(--accent-primary, var(--accent))' : undefined,
                color: selectedRs === a ? '#fff' : undefined,
                border: selectedRs === a ? 'none' : undefined,
              }}
            >
              Rs {a}
            </button>
          ))}
        </div>

        {/* Custom amount input */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
          <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>Custom (Rs)</span>
          <input
            type="number"
            min={minRs}
            max={10000}
            step={10}
            value={customRs}
            onChange={(e) => { setCustomRs(e.target.value); setSelectedRs(null); setCreateError(null); }}
            placeholder={`Min ${minRs}`}
            className="input-field"
            style={{ flex: 1, padding: '7px 10px', fontSize: '0.82rem' }}
          />
        </div>

        {/* You pay → you get */}
        {rs !== null && rs >= minRs && rs % 10 === 0 && rs <= 10000 && (
          <div style={{
            padding: '8px 12px', borderRadius: 8,
            background: 'var(--status-success-bg)',
            color: 'var(--status-success)',
            fontSize: '0.82rem', fontWeight: 600, marginBottom: 10,
          }}>
            You pay Rs {rs} — you get Rs {creditsForRs(rs)} AI credits ({creditPct}%)
          </div>
        )}

        {createError && (
          <div style={{ color: 'var(--status-danger)', fontSize: '0.82rem', marginBottom: 8 }}>{createError}</div>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={handleCreate}
            disabled={createLoading || validateAmount() !== null}
            className="action-btn action-btn-primary"
            style={{ flex: 1, justifyContent: 'center', fontSize: '0.82rem' }}
          >
            {createLoading ? 'Creating…' : 'Continue to payment →'}
          </button>
          <button type="button" onClick={onDone} className="action-btn" style={{ fontSize: '0.82rem' }}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // ── Step: payment ─────────────────────────────────────────────────────────
  if (step === 'payment' && created) {
    return (
      <div style={sectionStyle}>
        <div style={{ fontSize: '0.82rem', fontWeight: 700, marginBottom: 10 }}>
          Recharge — Step 2 of 3: Pay by UPI
        </div>

        {/* Summary */}
        <div style={{ ...rowStyle, marginBottom: 10, fontWeight: 600 }}>
          <span style={{ color: 'var(--text-secondary)' }}>Amount to pay</span>
          <span>Rs {created.amountRupees}</span>
        </div>
        <div style={{ ...rowStyle, marginBottom: 14, fontWeight: 600 }}>
          <span style={{ color: 'var(--text-secondary)' }}>Credits you will get</span>
          <span style={{ color: 'var(--status-success)' }}>Rs {created.creditsRupees}</span>
        </div>

        {/* QR code */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
          <div style={{ background: '#fff', padding: 12, borderRadius: 10, border: '1px solid var(--card-brd)', display: 'inline-block' }}>
            <QRCode value={created.upiUrl} size={180} />
          </div>
        </div>

        {/* UPI deep link */}
        <a
          href={created.upiUrl}
          className="action-btn action-btn-primary"
          style={{ display: 'flex', justifyContent: 'center', textDecoration: 'none', marginBottom: 10, fontSize: '0.82rem' }}
        >
          Open in UPI app (GPay / PhonePe / Paytm)
        </a>

        {/* Text fallback — always visible so it works when QR/deep-link is blocked */}
        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 6, fontWeight: 600 }}>
          Or pay manually — send exactly Rs {created.amountRupees} to:
        </div>

        {/* VPA */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <span style={{ fontSize: '0.82rem', color: 'var(--text-primary)', fontFamily: 'monospace', flex: 1, wordBreak: 'break-all' }}>
            {created.vpa}
          </span>
          <button
            type="button"
            onClick={() => handleCopy(created.vpa, 'vpa')}
            className="action-btn"
            style={{ padding: '4px 10px', fontSize: '0.75rem', whiteSpace: 'nowrap' }}
          >
            {copied === 'vpa' ? 'Copied!' : 'Copy UPI ID'}
          </button>
        </div>

        {/* Reference code */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Reference:</span>
          <span style={{ fontSize: '0.82rem', fontFamily: 'monospace', fontWeight: 700, flex: 1 }}>{created.refCode}</span>
          <button
            type="button"
            onClick={() => handleCopy(created.refCode, 'ref')}
            className="action-btn"
            style={{ padding: '4px 10px', fontSize: '0.75rem', whiteSpace: 'nowrap' }}
          >
            {copied === 'ref' ? 'Copied!' : 'Copy'}
          </button>
        </div>

        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 14, lineHeight: 1.5 }}>
          Some UPI apps may not pre-fill the amount for business IDs. If that happens, enter
          Rs {created.amountRupees} and reference code <strong>{created.refCode}</strong> manually.
          After paying, tap the button below.
        </p>

        <button
          type="button"
          onClick={() => setStep('utr')}
          className="action-btn action-btn-primary"
          style={{ width: '100%', justifyContent: 'center', fontSize: '0.82rem' }}
        >
          I have paid →
        </button>
      </div>
    );
  }

  // ── Step: UTR ─────────────────────────────────────────────────────────────
  if (step === 'utr' && created) {
    return (
      <div style={sectionStyle}>
        <div style={{ fontSize: '0.82rem', fontWeight: 700, marginBottom: 10 }}>
          Recharge — Step 3 of 3: Enter UTR
        </div>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 12, lineHeight: 1.5 }}>
          Enter the 12-digit UTR (UPI Transaction Reference) from your UPI app's payment confirmation.
          It is shown as "UTR", "Ref No", or "Transaction ID".
        </p>

        <input
          type="text"
          inputMode="numeric"
          maxLength={12}
          value={utrInput}
          onChange={(e) => { setUtrInput(e.target.value.replace(/\D/g, '').slice(0, 12)); setSubmitError(null); }}
          placeholder="12-digit UTR"
          className="input-field"
          style={{ fontSize: '1rem', letterSpacing: '0.1em', marginBottom: 8, textAlign: 'center' }}
        />

        {submitError && (
          <div style={{ color: 'var(--status-danger)', fontSize: '0.82rem', marginBottom: 8 }}>{submitError}</div>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitLoading || utrInput.length !== 12}
            className="action-btn action-btn-primary"
            style={{ flex: 1, justifyContent: 'center', fontSize: '0.82rem' }}
          >
            {submitLoading ? 'Submitting…' : 'Submit'}
          </button>
          <button
            type="button"
            onClick={() => setStep('payment')}
            className="action-btn"
            style={{ fontSize: '0.82rem' }}
          >
            ← Back
          </button>
        </div>
      </div>
    );
  }

  // ── Step: done ─────────────────────────────────────────────────────────────
  if (step === 'done') {
    return (
      <div style={{ ...sectionStyle, borderColor: 'var(--status-success)', background: 'var(--status-success-bg)' }}>
        <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--status-success)', marginBottom: 6 }}>
          Payment submitted
        </div>
        <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: 12, lineHeight: 1.5 }}>
          Your payment is waiting for confirmation. Credits will appear as soon as it is approved —
          usually within a few hours.
        </p>
        <button type="button" onClick={onDone} className="action-btn" style={{ fontSize: '0.82rem' }}>
          Close
        </button>
      </div>
    );
  }

  return null;
}

// ── AiCreditsCard (main) ──────────────────────────────────────────────────────

export function AiCreditsCard() {
  const [data, setData]       = useState<WalletResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [period, setPeriod]   = useState<'month' | 'all'>('month');
  const [showRecharge, setShowRecharge] = useState(false);
  const [showActivity, setShowActivity] = useState(false);
  const [showRates, setShowRates]       = useState(false);
  const [showPayments, setShowPayments] = useState(false);

  const load = useCallback(async (p: 'month' | 'all') => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/ai/wallet?period=${p}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? 'Could not load your AI credits.');
        return;
      }
      setData(await res.json());
    } catch {
      setError('Could not load your AI credits. Check your connection.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(period); }, [load, period]);

  if (loading && !data) {
    return (
      <div className="card">
        <div className="card-title">AI credits</div>
        <p style={{ fontSize: '0.83rem', color: 'var(--text-muted)' }}>Loading…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card">
        <div className="card-title">AI credits</div>
        <p style={{ fontSize: '0.83rem', color: 'var(--status-danger)' }}>{error}</p>
        <button className="action-btn" onClick={() => load(period)} style={{ fontSize: '0.78rem' }}>Retry</button>
      </div>
    );
  }

  if (!data) return null;

  const { wallet, low_balance, usage, activity, payment_requests, config, rate_card } = data;
  const noWallet     = wallet === null;
  const paused       = wallet?.status === 'paused';
  const zeroBalance  =
    wallet !== null &&
    (wallet.included_expired ? wallet.purchased_paise : wallet.included_paise + wallet.purchased_paise) === 0;
  const minRechargeRs  = Math.round(config.min_recharge_paise / 100);
  const creditPercent  = config.recharge_credit_percent;

  return (
    <div className="card">
      {/* ── Header ── */}
      <div className="card-title">
        <span>AI credits</span>
        <select
          value={period}
          onChange={(e) => setPeriod(e.target.value as 'month' | 'all')}
          style={{ fontSize: '0.75rem', padding: '4px 8px', borderRadius: 8, border: '1px solid var(--card-brd)', background: 'var(--bg-card)', color: 'var(--text-primary)', cursor: 'pointer' }}
        >
          <option value="month">This month</option>
          <option value="all">All time</option>
        </select>
      </div>

      {/* ── Paused banner ── */}
      {paused && (
        <div style={{ padding: '8px 12px', borderRadius: 10, background: 'var(--status-danger-bg)', color: 'var(--status-danger)', fontSize: '0.83rem', fontWeight: 600, marginBottom: 12 }}>
          Your account is paused. AI features are unavailable. Contact support.
        </div>
      )}

      {/* ── Zero-balance stop ── */}
      {!paused && zeroBalance && (
        <div style={{ padding: '8px 12px', borderRadius: 10, background: 'var(--status-danger-bg)', color: 'var(--status-danger)', fontSize: '0.83rem', fontWeight: 600, marginBottom: 12 }}>
          Your AI credits are used up. Recharge to continue using AI features.
        </div>
      )}

      {/* ── Low-balance warning ── */}
      {!paused && !zeroBalance && low_balance && (
        <div style={{ padding: '8px 12px', borderRadius: 10, background: 'var(--status-warning-bg)', color: 'var(--status-warning)', fontSize: '0.83rem', fontWeight: 600, marginBottom: 12 }}>
          Your AI credits are running low. Recharge soon.
        </div>
      )}

      {/* ── No wallet ── */}
      {noWallet && (
        <p style={{ fontSize: '0.83rem', color: 'var(--text-muted)', marginBottom: 12 }}>
          No AI credits have been added to your account yet. Contact support or wait for your app fee to be confirmed.
        </p>
      )}

      {/* ── Balance tiles ── */}
      {!noWallet && wallet && (
        <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
          <BalanceTile
            title="Included"
            paise={wallet.included_paise}
            sub={wallet.included_expires_at ? `Expires ${fmtDate(wallet.included_expires_at)}` : undefined}
            expired={wallet.included_expired}
          />
          <BalanceTile title="Recharged" paise={wallet.purchased_paise} highlight />
        </div>
      )}

      {/* ── Usage by feature ── */}
      {usage.by_feature.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6 }}>
            Usage — {period === 'month' ? 'this month' : 'all time'}
          </div>
          {usage.by_feature.map((f) => (
            <div key={f.feature} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.83rem', padding: '5px 0', borderBottom: '1px solid var(--border-subtle, rgba(0,0,0,0.06))' }}>
              <span style={{ color: 'var(--text-secondary)' }}>
                {f.label}
                {f.unit_label === 'minutes' && f.units > 0 ? ` — ${(f.units / 60).toFixed(1)} min`
                  : f.unit_label === 'pages'   && f.units > 0 ? ` — ${Math.round(f.units)} pages`
                  : f.units > 0 ? ` — ${Math.round(f.units / 1000)}k chars` : ''}
              </span>
              <span style={{ fontWeight: 600 }}>Rs {rupees(f.amount_paise)}</span>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.83rem', paddingTop: 6, fontWeight: 700 }}>
            <span>Total</span>
            <span>Rs {rupees(usage.total_paise)}</span>
          </div>
        </div>
      )}

      {usage.by_feature.length === 0 && !noWallet && (
        <p style={{ fontSize: '0.83rem', color: 'var(--text-muted)', marginBottom: 14 }}>
          No AI usage recorded {period === 'month' ? 'this month' : 'yet'}.
        </p>
      )}

      {/* ── Recharge flow ── */}
      {!noWallet && !paused && (
        <>
          {showRecharge ? (
            <RechargeFlow
              config={config}
              onDone={() => { setShowRecharge(false); load(period); }}
            />
          ) : (
            <div style={{ marginBottom: 14 }}>
              <button
                type="button"
                onClick={() => setShowRecharge(true)}
                className="action-btn action-btn-primary"
                style={{ width: '100%', justifyContent: 'center' }}
              >
                Recharge AI credits
              </button>
              <p style={{ fontSize: '0.73rem', color: 'var(--text-muted)', textAlign: 'center', marginTop: 6 }}>
                Min Rs {minRechargeRs} · You pay Rs {minRechargeRs} — you get Rs {Math.floor(minRechargeRs * creditPercent / 100)} credits ({creditPercent}%)
              </p>
            </div>
          )}
        </>
      )}

      {/* ── Pricing (collapsible) ── */}
      {rate_card.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <button type="button" onClick={() => setShowRates(v => !v)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600, color: 'var(--accent-ink, var(--accent))', padding: '4px 0', display: 'flex', alignItems: 'center', gap: 4 }}>
            {showRates ? '▲' : '▼'} Pricing
          </button>
          {showRates && (
            <div style={{ marginTop: 6 }}>
              {rate_card.map((r) => (
                <div key={r.feature} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--text-secondary)', padding: '3px 0' }}>
                  <span>{FEATURE_DISPLAY[r.feature] ?? r.feature}</span>
                  <span>{r.human_label}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Activity (collapsible) ── */}
      {activity.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <button type="button" onClick={() => setShowActivity(v => !v)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600, color: 'var(--accent-ink, var(--accent))', padding: '4px 0', display: 'flex', alignItems: 'center', gap: 4 }}>
            {showActivity ? '▲' : '▼'} Activity ({activity.length})
          </button>
          {showActivity && (
            <div style={{ marginTop: 8 }}>
              {activity.map((row) => {
                const isDebit = row.amount_paise < 0;
                return (
                  <div key={row.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', fontSize: '0.8rem', padding: '5px 0', borderBottom: '1px solid var(--border-subtle, rgba(0,0,0,0.06))', gap: 8 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{row.label}</div>
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.73rem' }}>{fmtDate(row.created_at)} · {BUCKET_LABEL[row.bucket] ?? row.bucket}</div>
                    </div>
                    <div style={{ fontWeight: 700, whiteSpace: 'nowrap', color: isDebit ? 'var(--status-danger)' : 'var(--status-success)' }}>
                      {isDebit ? '−' : '+'}Rs {rupees(Math.abs(row.amount_paise))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Recharge history (collapsible) ── */}
      {payment_requests.length > 0 && (
        <div>
          <button type="button" onClick={() => setShowPayments(v => !v)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600, color: 'var(--accent-ink, var(--accent))', padding: '4px 0', display: 'flex', alignItems: 'center', gap: 4 }}>
            {showPayments ? '▲' : '▼'} Recharge history ({payment_requests.length})
          </button>
          {showPayments && (
            <div style={{ marginTop: 8 }}>
              {payment_requests.map((pr) => {
                const badge = statusBadge(pr.status);
                return (
                  <div key={pr.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--border-subtle, rgba(0,0,0,0.06))' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                      <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>Rs {rupees(pr.amount_expected_paise)}</span>
                      <span style={{ fontSize: '0.72rem', fontWeight: 700, padding: '2px 8px', borderRadius: 6, background: badge.bg, color: badge.color }}>{badge.label}</span>
                    </div>
                    <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)' }}>Ref: {pr.ref_code} · {fmtDate(pr.created_at)}</div>
                    {pr.credited_paise !== null && pr.status === 'approved' && (
                      <div style={{ fontSize: '0.73rem', color: 'var(--status-success)' }}>Rs {rupees(pr.credited_paise)} credited</div>
                    )}
                    {pr.decision_note && pr.status === 'rejected' && (
                      <div style={{ fontSize: '0.73rem', color: 'var(--status-danger)', marginTop: 2 }}>{pr.decision_note}</div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Constants ─────────────────────────────────────────────────────────────────

const FEATURE_DISPLAY: Record<string, string> = {
  stt: 'Dictation', translate: 'Translation', transliterate: 'Script conversion', ocr: 'Document scanning',
};

const BUCKET_LABEL: Record<string, string> = {
  included: 'Included credits', purchased: 'Recharged credits',
};
