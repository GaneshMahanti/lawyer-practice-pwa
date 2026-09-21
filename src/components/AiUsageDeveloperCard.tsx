'use client';

import React, { useCallback, useEffect, useState } from 'react';

interface FeatureUsage {
  spentPaise: number;
  units: number;
  calls: number;
}

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
  id: string;
  at: string;
  lawyer: string;
  kind: string;
  bucket: string;
  amountPaise: number;
  feature: string | null;
  units: number | null;
  note: string | null;
}

interface UsageResponse {
  period: 'month' | 'all';
  totals: {
    includedPaise: number;
    purchasedPaise: number;
    spentPaise: number;
    calls: number;
    walletCount: number;
    creditsOutstandingPaise: number;
  };
  internal: { spentPaise: number; byFeature: Record<string, FeatureUsage> };
  sarvam: null | {
    recordedPaise: number;
    recordedAt: string;
    note: string | null;
    spentSincePaise: number;
    estimatedRemainingPaise: number;
  };
  lawyers: LawyerUsage[];
  recent: RecentRow[];
}

const FEATURE_LABEL: Record<string, string> = {
  stt: 'Dictation',
  translate: 'Translation',
  transliterate: 'Script conversion',
  ocr: 'Document OCR',
};

function rupees(paise: number): string {
  return `\u20B9${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function units(feature: string, value: number): string {
  if (feature === 'stt') return `${(value / 60).toFixed(1)} min`;
  if (feature === 'ocr') return `${Math.round(value)} page${Math.round(value) === 1 ? '' : 's'}`;
  return `${Math.round(value).toLocaleString('en-IN')} chars`;
}

function when(iso: string | null): string {
  if (!iso) return 'never';
  return new Date(iso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function dateOnly(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' });
}

function describe(row: RecentRow): string {
  const feature = row.feature ? FEATURE_LABEL[row.feature] ?? row.feature : '';
  switch (row.kind) {
    case 'usage':
      return `Used ${feature}`.trim();
    case 'refund':
      return `Refund ${feature}`.trim();
    case 'adjustment':
      return `Extra charge ${feature}`.trim();
    case 'grant_included':
      return 'Included credits granted';
    case 'recharge':
      return 'Recharge credited';
    case 'admin_adjustment':
      return row.note ? `Adjusted by you: ${row.note}` : 'Adjusted by you';
    case 'internal_usage':
      return `Your own ${feature}`.trim();
    default:
      return row.kind;
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

/** Developer-only Settings card: see and control every lawyer's AI credits. */
export function AiUsageDeveloperCard() {
  const [period, setPeriod] = useState<'month' | 'all'>('month');
  const [data, setData] = useState<UsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);

  // add / remove credits form (one lawyer at a time)
  const [formFor, setFormFor] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [bucket, setBucket] = useState<'purchased' | 'included'>('purchased');
  const [note, setNote] = useState('');

  // Sarvam balance form
  const [sarvamInput, setSarvamInput] = useState('');

  const load = useCallback(async (p: 'month' | 'all') => {
    setLoading(true);
    setFailed(false);
    try {
      const res = await fetch(`/api/admin/ai-usage?period=${p}`, { cache: 'no-store' });
      if (!res.ok) throw new Error('request failed');
      setData(await res.json());
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(period);
  }, [load, period]);

  const send = async (key: string, url: string, payload: Record<string, unknown>, okText: string): Promise<boolean> => {
    setBusy(key);
    setNotice(null);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotice({ type: 'error', text: typeof body?.error === 'string' && body.error ? body.error : 'Something went wrong. Please try again.' });
        return false;
      }
      setNotice({ type: 'ok', text: body?.already ? 'Already granted earlier.' : okText });
      await load(period);
      return true;
    } catch {
      setNotice({ type: 'error', text: 'Something went wrong. Please try again.' });
      return false;
    } finally {
      setBusy(null);
    }
  };

  const act = (key: string, payload: Record<string, unknown>, okText: string) =>
    send(key, '/api/admin/ai-credits', payload, okText);

  const grantIncluded = (l: LawyerUsage) => {
    if (!l.ownerId) return;
    if (!window.confirm(`Mark the app fee as received from ${l.name} and give them Rs 1,000 of included AI credits? This can only be done once.`)) return;
    void act(`grant:${l.ownerId}`, { action: 'grant_included', ownerId: l.ownerId }, 'Rs 1,000 included credits added.');
  };

  const submitAdjust = async (l: LawyerUsage) => {
    if (!l.ownerId) return;
    const value = Number(amount);
    if (!Number.isFinite(value) || value === 0) {
      setNotice({ type: 'error', text: 'Enter an amount in rupees (use a minus sign to remove credits).' });
      return;
    }
    const verb = value > 0 ? 'Add' : 'Remove';
    if (!window.confirm(`${verb} Rs ${Math.abs(value).toLocaleString('en-IN')} ${bucket === 'purchased' ? 'recharged' : 'included'} credits for ${l.name}?`)) return;
    const ok = await act(
      `adjust:${l.ownerId}`,
      { action: 'adjust', ownerId: l.ownerId, bucket, amountRupees: value, note },
      value > 0 ? 'Credits added.' : 'Credits removed.',
    );
    if (ok) {
      setFormFor(null);
      setAmount('');
      setNote('');
    }
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
    void act(
      `cap:${l.ownerId}`,
      { action: 'set_daily_cap', ownerId: l.ownerId, capRupees: input.trim() === '' ? null : Number(input) },
      'Daily limit updated.',
    );
  };

  const saveSarvamBalance = async () => {
    const ok = await send('sarvam', '/api/admin/sarvam-balance', { balanceRupees: Number(sarvamInput) }, 'Sarvam balance recorded.');
    if (ok) setSarvamInput('');
  };

  const periodLabel = period === 'month' ? 'this month' : 'all time';
  const purchasedOwed = data?.totals.purchasedPaise ?? 0;
  const sarvamLow = data?.sarvam ? data.sarvam.estimatedRemainingPaise < purchasedOwed : false;

  return (
    <div className="card">
      <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <span>AI credits and usage</span>
        <button type="button" className="action-btn" style={smallBtn} onClick={() => load(period)} disabled={loading || busy !== null}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {notice && (
        <div
          role={notice.type === 'error' ? 'alert' : 'status'}
          style={{
            padding: '8px 10px',
            borderRadius: 8,
            fontSize: '0.82rem',
            marginBottom: 10,
            background: notice.type === 'error' ? 'var(--status-danger-bg)' : 'var(--status-success-bg)',
            color: notice.type === 'error' ? 'var(--status-danger)' : 'var(--status-success)',
          }}
        >
          {notice.text}
        </div>
      )}

      {failed && (
        <div style={{ padding: '8px 10px', borderRadius: 8, background: 'var(--status-danger-bg)', color: 'var(--status-danger)', fontSize: '0.82rem', marginBottom: 10 }}>
          Could not load AI usage.
        </div>
      )}

      {data && (
        <>
          {/* ── Your Sarvam balance ── */}
          <div style={{ padding: '10px 12px', borderRadius: 12, background: 'var(--bg-surface-elevated)', border: '1px solid var(--border-subtle)', marginBottom: 12 }}>
            <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)' }}>Your Sarvam credits left (estimate)</div>
            {data.sarvam ? (
              <>
                <div style={{ fontSize: '1.3rem', fontWeight: 800, color: sarvamLow ? 'var(--status-danger)' : 'var(--text-primary)' }}>
                  {rupees(data.sarvam.estimatedRemainingPaise)}
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                  You recorded {rupees(data.sarvam.recordedPaise)} on {when(data.sarvam.recordedAt)}; the app has metered {rupees(data.sarvam.spentSincePaise)} of usage since.
                </div>
                {sarvamLow && (
                  <div style={{ marginTop: 6, fontSize: '0.78rem', fontWeight: 700, color: 'var(--status-danger)' }}>
                    Top up Sarvam: lawyers hold {rupees(purchasedOwed)} of recharged credits, more than your Sarvam balance.
                  </div>
                )}
              </>
            ) : (
              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                Not recorded yet. Enter the "Credits left" number from the Sarvam dashboard Billing page.
              </div>
            )}
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              <input
                className="input-field"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                placeholder="Sarvam credits left (Rs)"
                value={sarvamInput}
                onChange={(e) => setSarvamInput(e.target.value)}
                style={{ flex: 1, minWidth: 0 }}
              />
              <button type="button" className="action-btn action-btn-primary" style={smallBtn} disabled={busy !== null || sarvamInput.trim() === ''} onClick={saveSarvamBalance}>
                {busy === 'sarvam' ? 'Saving…' : 'Update'}
              </button>
            </div>
            <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)', marginTop: 4 }}>
              Sarvam has no balance feed, so update this after every top-up. Estimates drift if you skip it.
            </div>
          </div>

          <div className="seg" style={{ marginBottom: 12 }}>
            <button type="button" className={period === 'month' ? 'on' : ''} onClick={() => setPeriod('month')}>
              This month
            </button>
            <button type="button" className={period === 'all' ? 'on' : ''} onClick={() => setPeriod('all')}>
              All time
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 8 }}>
            {tile('Credits owed', rupees(data.totals.creditsOutstandingPaise), 'to lawyers')}
            {tile(`Lawyers used ${periodLabel}`, rupees(data.totals.spentPaise), `${data.totals.calls} calls`)}
            {tile('Lawyers funded', String(data.totals.walletCount), `of ${data.lawyers.length}`)}
          </div>
          <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', marginBottom: 14 }}>
            Your own AI use {periodLabel}: <strong style={{ color: 'var(--text-primary)' }}>{rupees(data.internal.spentPaise)}</strong> (paid from your Sarvam balance, not charged to any lawyer).
          </div>

          {data.lawyers.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No lawyers yet.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {data.lawyers.map((l) => (
                <div
                  key={l.email}
                  style={{ padding: '10px 12px', borderRadius: 12, background: 'var(--bg-surface-elevated)', border: '1px solid var(--border-subtle)' }}
                >
                  <div style={{ fontWeight: 700, fontSize: '0.88rem', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {l.name}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {l.email}
                    {!l.hasWallet && ' · no AI credits yet'}
                    {l.walletStatus === 'paused' && ' · AI PAUSED'}
                    {!l.aiEnabled && ' · AI switched off'}
                    {!l.isActive && ' · account paused'}
                  </div>

                  {l.hasWallet ? (
                    <>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
                        <div>
                          <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Included credits left</div>
                          <div style={{ fontWeight: 700, fontSize: '0.92rem', color: l.includedExpired ? 'var(--status-danger)' : 'var(--text-primary)' }}>
                            {l.includedExpired ? 'Expired' : rupees(l.includedPaise)}
                          </div>
                          {l.includedExpiresAt && (
                            <div style={{ fontSize: '0.64rem', color: 'var(--text-muted)' }}>
                              {l.includedExpired ? 'ended' : 'valid until'} {dateOnly(l.includedExpiresAt)}
                            </div>
                          )}
                        </div>
                        <div>
                          <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Recharged credits left</div>
                          <div style={{ fontWeight: 700, fontSize: '0.92rem', color: 'var(--text-primary)' }}>{rupees(l.purchasedPaise)}</div>
                          <div style={{ fontSize: '0.64rem', color: 'var(--text-muted)' }}>never expire</div>
                        </div>
                      </div>

                      <div style={{ marginTop: 8, fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                        Used {periodLabel}: <strong style={{ color: 'var(--text-primary)' }}>{rupees(l.spentPaise)}</strong> in {l.calls} call{l.calls === 1 ? '' : 's'}
                        {' · '}last used {when(l.lastUsedAt)}
                        {' · '}daily limit {l.dailyCapPaise === null ? 'default' : rupees(l.dailyCapPaise)}
                      </div>

                      {Object.keys(l.byFeature).length > 0 && (
                        <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 2 }}>
                          {Object.entries(l.byFeature).map(([feature, u]) => (
                            <div key={feature} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
                              <span>
                                {FEATURE_LABEL[feature] ?? feature} · {units(feature, u.units)} · {u.calls} call{u.calls === 1 ? '' : 's'}
                              </span>
                              <span style={{ fontWeight: 600 }}>{rupees(u.spentPaise)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  ) : (
                    <div style={{ marginTop: 6, fontSize: '0.76rem', color: 'var(--text-muted)' }}>
                      {l.signedIn
                        ? 'No AI credits yet. Give the included Rs 1,000 once the app fee is received, or add credits below.'
                        : 'Has not signed in yet. Credits can be added after their first sign-in.'}
                    </div>
                  )}

                  {/* ── Your controls for this lawyer ── */}
                  {l.signedIn && l.ownerId && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                      {!l.feeGranted && (
                        <button type="button" className="action-btn action-btn-primary" style={smallBtn} disabled={busy !== null} onClick={() => grantIncluded(l)}>
                          {busy === `grant:${l.ownerId}` ? 'Adding…' : 'App fee received: give Rs 1,000'}
                        </button>
                      )}
                      <button
                        type="button"
                        className="action-btn"
                        style={smallBtn}
                        disabled={busy !== null}
                        onClick={() => {
                          setFormFor(formFor === l.ownerId ? null : l.ownerId);
                          setNotice(null);
                        }}
                      >
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
                        <input
                          className="input-field"
                          type="number"
                          inputMode="decimal"
                          step="0.01"
                          placeholder="Rs (minus to remove)"
                          value={amount}
                          onChange={(e) => setAmount(e.target.value)}
                          style={{ flex: 1, minWidth: 0 }}
                        />
                        <select
                          className="input-field"
                          value={bucket}
                          onChange={(e) => setBucket(e.target.value === 'included' ? 'included' : 'purchased')}
                          style={{ flex: 1, minWidth: 0 }}
                        >
                          <option value="purchased">Recharged (never expires)</option>
                          <option value="included">Included (expires)</option>
                        </select>
                      </div>
                      <input
                        className="input-field"
                        type="text"
                        placeholder="Note (required), e.g. cash payment received"
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        maxLength={200}
                        style={{ marginTop: 6 }}
                      />
                      <button
                        type="button"
                        className="action-btn action-btn-primary"
                        style={{ ...smallBtn, marginTop: 8, width: '100%', justifyContent: 'center' }}
                        disabled={busy !== null || note.trim().length < 3 || amount.trim() === ''}
                        onClick={() => submitAdjust(l)}
                      >
                        {busy === `adjust:${l.ownerId}` ? 'Saving…' : 'Save change'}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          <div style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--text-muted)', margin: '14px 0 6px' }}>
            Latest activity
          </div>
          {data.recent.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>No AI activity yet.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {data.recent.map((r) => (
                <div
                  key={r.id}
                  style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: '0.74rem', padding: '4px 8px', borderRadius: 6, background: 'var(--bg-surface-elevated)' }}
                >
                  <span style={{ minWidth: 0, color: 'var(--text-secondary)' }}>
                    <strong style={{ color: 'var(--text-primary)' }}>{r.lawyer}</strong> · {describe(r)}
                    {r.units !== null && r.feature ? ` · ${units(r.feature, r.units)}` : ''}
                    <span style={{ color: 'var(--text-muted)' }}> · {r.bucket} · {when(r.at)}</span>
                  </span>
                  <span
                    style={{
                      fontWeight: 700,
                      whiteSpace: 'nowrap',
                      color: r.amountPaise < 0 ? 'var(--status-danger)' : 'var(--status-success)',
                    }}
                  >
                    {r.amountPaise < 0 ? '-' : '+'}
                    {rupees(Math.abs(r.amountPaise))}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
