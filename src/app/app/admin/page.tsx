'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { NotificationHealthCard } from '@/components/NotificationHealthCard';

interface ApprovedUser {
  id: string;
  email: string;
  name: string | null;
  role: 'developer' | 'lawyer';
  plan: 'basic' | 'standard' | 'premium';
  phone: string | null;
  is_active: boolean;
  ai_enabled: boolean;
  notes_enabled: boolean;
  session_nonce: string | null;
  session_started_at: string | null;
  subscription_end: string | null;
  created_at: string;
  updated_at: string;
}

interface AuditEntry {
  id: string;
  action: string;
  resource_type: string;
  resource_id: string;
  outcome: string;
  created_at: string;
}

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.floor((t - Date.now()) / (1000 * 60 * 60 * 24));
}

function isoFromDateInput(v: string): string {
  // Convert yyyy-mm-dd from <input type="date"> to a proper ISO timestamp
  // at 23:59:59 local time so the whole day counts as still active.
  const [y, m, d] = v.split('-').map((n) => Number.parseInt(n, 10));
  if (!y || !m || !d) return '';
  const dt = new Date(y, m - 1, d, 23, 59, 59);
  return dt.toISOString();
}

function dateInputFromIso(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function defaultOneYearFromToday(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 1);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export default function AdminPage() {
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);

  // Allowlist state
  const [users, setUsers] = useState<ApprovedUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  // Form state
  const [formEmail, setFormEmail] = useState('');
  const [formName, setFormName] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formRole, setFormRole] = useState<'lawyer' | 'developer'>('lawyer');
  const [formPlan, setFormPlan] = useState<'basic' | 'standard' | 'premium'>('standard');
  const [formSubEnd, setFormSubEnd] = useState<string>(defaultOneYearFromToday());
  const [submitting, setSubmitting] = useState(false);
  const [submitMsg, setSubmitMsg] = useState<string | null>(null);
  const [submitErr, setSubmitErr] = useState<string | null>(null);

  const [auditLogs, setAuditLogs] = useState<AuditEntry[]>([]);

  const loadUsers = useCallback(async () => {
    setLoadingUsers(true);
    setListError(null);
    try {
      const res = await fetch('/api/admin/users');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load users');
      setUsers(data.users || []);
    } catch (err) {
      setListError(err instanceof Error ? err.message : 'Could not load users');
    } finally {
      setLoadingUsers(false);
    }
  }, []);

  useEffect(() => {
    async function loadData() {
      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          setEmail(user.email || null);
          setRole((user.app_metadata?.role as string) || null);
        }

        const { data } = await (supabase as any)
          .from('audit_logs')
          .select('id, action, resource_type, resource_id, outcome, created_at')
          .order('created_at', { ascending: false })
          .limit(20);

        if (data) setAuditLogs(data);
      } catch (err) {
        console.error('Error fetching admin data:', err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
    loadUsers();
  }, [loadUsers]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setSubmitErr(null);
    setSubmitMsg(null);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: formEmail,
          name: formName,
          phone: formPhone || null,
          role: formRole,
          plan: formPlan,
          subscription_end: isoFromDateInput(formSubEnd),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed');
      setSubmitMsg(`Saved: ${data.user.email} (${data.user.role}, ${data.user.plan})`);
      setFormEmail('');
      setFormName('');
      setFormPhone('');
      setFormPlan('standard');
      setFormRole('lawyer');
      setFormSubEnd(defaultOneYearFromToday());
      loadUsers();
    } catch (err) {
      setSubmitErr(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSubmitting(false);
    }
  };

  const patchUser = async (id: string, patch: Partial<ApprovedUser>) => {
    try {
      const res = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...patch }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Update failed');
      setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, ...data.user } : u)));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Update failed');
    }
  };

  const deleteUser = async (id: string, emailOfUser: string) => {
    if (!confirm(`Permanently remove ${emailOfUser} from the allowlist? Their existing data in the app is not affected.`)) return;
    try {
      const res = await fetch(`/api/admin/users?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Delete failed');
      setUsers((prev) => prev.filter((u) => u.id !== id));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const forceLogout = async (u: ApprovedUser) => {
    if (!confirm(`Force logout ${u.name || u.email}? Their current session will be revoked immediately.`)) return;
    try {
      const res = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: u.id, force_logout: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Force logout failed');
      setUsers((prev) => prev.map((x) => x.id === u.id ? { ...x, ...data.user } : x));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Force logout failed');
    }
  };

  const extendOneYear = (u: ApprovedUser) => {
    const base = u.subscription_end ? new Date(u.subscription_end) : new Date();
    const next = new Date(base);
    next.setFullYear(next.getFullYear() + 1);
    patchUser(u.id, { subscription_end: next.toISOString() });
  };

  if (loading) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-secondary)' }}>
        Loading developer portal…
      </div>
    );
  }

  return (
    <div style={{ paddingBottom: 32 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: '1.3rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
            Developer Operations
          </h1>
          <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: 2 }}>
            {email} · Role: {role || 'none'}
          </div>
        </div>
        <Link href="/app" className="action-btn" style={{ fontSize: '0.82rem' }}>
          ← Back to App
        </Link>
      </div>

      {/* ── Add lawyer to allowlist ── */}
      <div className="card">
        <div className="card-title">Add / update lawyer allowlist</div>
        <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: 12 }}>
          Adds an email to the approved_users table so the lawyer can sign in with Google.
          Submitting an existing email updates that row instead of creating a duplicate.
        </p>

        <form onSubmit={handleAdd}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label className="input-label">Email (Gmail for Google login)</label>
              <input
                type="email"
                className="input-field"
                placeholder="advocate@gmail.com"
                value={formEmail}
                onChange={(e) => setFormEmail(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="input-label">Full name</label>
              <input
                type="text"
                className="input-field"
                placeholder="Advocate S. Rao"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="input-label">Phone (optional)</label>
              <input
                type="tel"
                className="input-field"
                placeholder="10 digit mobile"
                value={formPhone}
                onChange={(e) => setFormPhone(e.target.value)}
              />
            </div>
            <div>
              <label className="input-label">Role</label>
              <select
                className="input-field"
                value={formRole}
                onChange={(e) => setFormRole(e.target.value as 'lawyer' | 'developer')}
              >
                <option value="lawyer">Lawyer</option>
                <option value="developer">Developer (you)</option>
              </select>
            </div>
            <div>
              <label className="input-label">Plan tier</label>
              <select
                className="input-field"
                value={formPlan}
                onChange={(e) => setFormPlan(e.target.value as any)}
              >
                <option value="basic">Basic (12k + 2k/yr)</option>
                <option value="standard">Standard (15k + 3k/yr)</option>
                <option value="premium">Premium (20k + 5k/yr)</option>
              </select>
            </div>
            <div>
              <label className="input-label">Subscription end</label>
              <input
                type="date"
                className="input-field"
                value={formSubEnd}
                onChange={(e) => setFormSubEnd(e.target.value)}
                required
              />
            </div>
          </div>

          {submitMsg && (
            <div style={{ marginTop: 10, padding: '8px 10px', borderRadius: 8, background: 'var(--status-success-bg)', color: 'var(--status-success)', fontSize: '0.82rem' }}>
              {submitMsg}
            </div>
          )}
          {submitErr && (
            <div style={{ marginTop: 10, padding: '8px 10px', borderRadius: 8, background: 'var(--status-danger-bg)', color: 'var(--status-danger)', fontSize: '0.82rem' }}>
              {submitErr}
            </div>
          )}

          <button
            type="submit"
            className="action-btn action-btn-primary"
            style={{ width: '100%', justifyContent: 'center', marginTop: 12 }}
            disabled={submitting}
          >
            {submitting ? 'Saving…' : 'Save to allowlist'}
          </button>
        </form>
      </div>

      {/* ── Existing lawyers ── */}
      <div className="card">
        <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Allowlist ({users.length})</span>
          <button
            type="button"
            onClick={loadUsers}
            className="action-btn"
            style={{ fontSize: '0.75rem', padding: '4px 10px' }}
            disabled={loadingUsers}
          >
            {loadingUsers ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>

        {listError && (
          <div style={{ padding: '8px 10px', borderRadius: 8, background: 'var(--status-danger-bg)', color: 'var(--status-danger)', fontSize: '0.82rem', marginBottom: 10 }}>
            {listError}
          </div>
        )}

        {users.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', padding: '10px 0' }}>
            No approved users yet.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {users.map((u) => {
              const days = daysUntil(u.subscription_end);
              const expiring = days !== null && days <= 15 && days >= 0;
              const expired = days !== null && days < 0;
              return (
                <div
                  key={u.id}
                  style={{
                    padding: '10px 12px',
                    background: 'var(--bg-surface-elevated)',
                    borderRadius: 10,
                    border: '1px solid var(--border-subtle)',
                    fontSize: '0.85rem',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {u.name || u.email}
                      </div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {u.email} {u.phone ? `· ${u.phone}` : ''}
                      </div>
                    </div>
                    <span style={{
                      fontSize: '0.7rem',
                      fontWeight: 700,
                      padding: '2px 8px',
                      borderRadius: 999,
                      background: u.role === 'developer' ? 'var(--accent-primary-dim)' : 'var(--status-success-bg)',
                      color: u.role === 'developer' ? 'var(--accent-primary)' : 'var(--status-success)',
                      whiteSpace: 'nowrap',
                      height: 'fit-content',
                    }}>
                      {u.role}
                    </span>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                    <div>
                      <label style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Plan</label>
                      <select
                        className="input-field"
                        style={{ fontSize: '0.8rem', padding: '4px 6px', marginTop: 2 }}
                        value={u.plan}
                        onChange={(e) => patchUser(u.id, { plan: e.target.value as any })}
                      >
                        <option value="basic">Basic</option>
                        <option value="standard">Standard</option>
                        <option value="premium">Premium</option>
                      </select>
                    </div>
                    <div>
                      <label style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Subscription ends</label>
                      <input
                        type="date"
                        className="input-field"
                        style={{ fontSize: '0.8rem', padding: '4px 6px', marginTop: 2 }}
                        value={dateInputFromIso(u.subscription_end)}
                        onChange={(e) => {
                          const iso = isoFromDateInput(e.target.value);
                          if (iso) patchUser(u.id, { subscription_end: iso });
                        }}
                      />
                    </div>
                  </div>

                  {/* Feature access toggles (lawyers only) */}
                  {u.role === 'lawyer' && (
                    <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        onClick={() => patchUser(u.id, { ai_enabled: !u.ai_enabled })}
                        className="action-btn"
                        style={{
                          fontSize: '0.72rem',
                          padding: '3px 10px',
                          background: u.ai_enabled ? 'var(--status-success-bg)' : 'var(--bg-surface-elevated)',
                          color: u.ai_enabled ? 'var(--status-success)' : 'var(--text-muted)',
                          border: `1px solid ${u.ai_enabled ? 'var(--status-success)' : 'var(--border-subtle)'}`,
                        }}
                        title={u.ai_enabled ? 'Click to disable AI features' : 'Click to enable AI features'}
                      >
                        AI {u.ai_enabled ? 'ON' : 'OFF'}
                      </button>
                      <button
                        type="button"
                        onClick={() => patchUser(u.id, { notes_enabled: !u.notes_enabled })}
                        className="action-btn"
                        style={{
                          fontSize: '0.72rem',
                          padding: '3px 10px',
                          background: u.notes_enabled ? 'var(--status-success-bg)' : 'var(--bg-surface-elevated)',
                          color: u.notes_enabled ? 'var(--status-success)' : 'var(--text-muted)',
                          border: `1px solid ${u.notes_enabled ? 'var(--status-success)' : 'var(--border-subtle)'}`,
                        }}
                        title={u.notes_enabled ? 'Click to disable Notes/Diary' : 'Click to enable Notes/Diary'}
                      >
                        Notes {u.notes_enabled ? 'ON' : 'OFF'}
                      </button>
                      {u.session_nonce && (
                        <span style={{
                          fontSize: '0.72rem',
                          padding: '3px 10px',
                          borderRadius: 999,
                          background: 'var(--accent-primary-dim)',
                          color: 'var(--accent-primary)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                        }}>
                          <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--status-success)', display: 'inline-block' }} />
                          Active session
                        </span>
                      )}
                    </div>
                  )}

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, fontSize: '0.76rem' }}>
                    <span style={{
                      color: expired ? 'var(--status-danger)' : expiring ? 'var(--status-warning)' : 'var(--text-muted)',
                      fontWeight: expired || expiring ? 700 : 400,
                    }}>
                      {expired
                        ? `Expired ${Math.abs(days!)} days ago`
                        : days === null
                        ? 'No end date'
                        : `Renews in ${days} days`}
                    </span>

                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        onClick={() => extendOneYear(u)}
                        className="action-btn"
                        style={{ fontSize: '0.72rem', padding: '3px 8px' }}
                      >
                        + 1 year
                      </button>
                      <button
                        type="button"
                        onClick={() => patchUser(u.id, { is_active: !u.is_active })}
                        className="action-btn"
                        style={{
                          fontSize: '0.72rem',
                          padding: '3px 8px',
                          color: u.is_active ? 'var(--status-danger)' : 'var(--status-success)',
                        }}
                      >
                        {u.is_active ? 'Pause' : 'Activate'}
                      </button>
                      {u.role === 'lawyer' && u.session_nonce && (
                        <button
                          type="button"
                          onClick={() => forceLogout(u)}
                          className="action-btn"
                          style={{ fontSize: '0.72rem', padding: '3px 8px', color: 'var(--status-warning)' }}
                        >
                          Force Logout
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => deleteUser(u.id, u.email)}
                        className="action-btn"
                        style={{ fontSize: '0.72rem', padding: '3px 8px', color: 'var(--status-danger)' }}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Security summary ── */}
      <div className="card" style={{ borderColor: 'var(--accent-gold, #c8a03c)' }}>
        <div className="card-title" style={{ color: 'var(--accent-gold, #c8a03c)' }}>
          Security & Access Status
        </div>
        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          <div>RBAC middleware active (developer vs lawyer routes enforced).</div>
          <div>PostgreSQL RLS stamped via <code>auth.users.raw_app_meta_data</code>.</div>
          <div>Client KYC isolation via opaque hashes in <code>/portal/[token]</code>.</div>
          <div>Allowlist writes go through service_role (never exposed to browser).</div>
        </div>
      </div>

      {/* ── Audit trail ── */}
      <div className="card">
        <div className="card-title">Recent Audit Trail</div>
        {auditLogs.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', padding: '12px 0' }}>
            No audit log entries recorded yet in Supabase.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {auditLogs.map((log) => (
              <div
                key={log.id}
                style={{
                  padding: '8px 12px',
                  background: 'var(--bg-surface-elevated)',
                  borderRadius: 8,
                  fontSize: '0.82rem',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600 }}>
                  <span>{log.action} ({log.resource_type})</span>
                  <span style={{ color: log.outcome === 'success' ? 'var(--status-success)' : 'var(--status-danger)' }}>
                    {log.outcome}
                  </span>
                </div>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.76rem', marginTop: 2 }}>
                  {new Date(log.created_at).toLocaleString('en-IN')} · ID: {log.resource_id}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <NotificationHealthCard />
    </div>
  );
}
