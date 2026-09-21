'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/lib/i18n/context';
import { ThemeSwitch } from '@/components/ThemeSwitch';
import { PushNotificationsCard } from '@/components/PushNotificationsCard';
import { AiUsageDeveloperCard } from '@/components/AiUsageDeveloperCard';
import { createClient } from '@/lib/supabase/client';
import { persistReminderPreferences, loadReminderPreferences } from '@/lib/data/repository';
import { REMINDER_OFFSET_OPTIONS } from '@/lib/reminders/engine';
import type { SupportedLanguage } from '@/lib/types/database';

// ── Lawyer management (developer-only) ───────────────────────────────────────

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

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.floor((t - Date.now()) / (1000 * 60 * 60 * 24));
}

function isoFromDateInput(v: string): string {
  const [y, m, d] = v.split('-').map((n) => Number.parseInt(n, 10));
  if (!y || !m || !d) return '';
  return new Date(y, m - 1, d, 23, 59, 59).toISOString();
}

function dateInputFromIso(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 10-digit Indian mobile, with or without +91 / 0 in front. Mirrors normalizeIndianMobile on the server. */
function isValidIndianMobile(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  return (
    digits.length === 10 ||
    (digits.length === 12 && digits.startsWith('91')) ||
    (digits.length === 11 && digits.startsWith('0'))
  );
}

function defaultOneYearFromToday(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ── Icon components ───────────────────────────────────────────────────────────

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function LogOutIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" x2="9" y1="12" y2="12" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

// ── Main settings page ────────────────────────────────────────────────────────

export default function SettingsPage() {
  const router = useRouter();
  const { language, setLanguage, t } = useLanguage();

  const [barCouncilNo, setBarCouncilNo] = useState('');
  const [advocateName, setAdvocateName] = useState('');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [userRole, setUserRole] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [reminderOffsets, setReminderOffsets] = useState<number[]>([1440, 120]);
  const [inAppReminders, setInAppReminders] = useState(true);

  // ── Lawyer management state (developer only) ────────────────────────────────
  const [users, setUsers] = useState<ApprovedUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const [formEmail, setFormEmail] = useState('');
  const [formName, setFormName] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formRole, setFormRole] = useState<'lawyer' | 'developer'>('lawyer');
  const [formPlan, setFormPlan] = useState<'basic' | 'standard' | 'premium'>('standard');
  const [formSubEnd, setFormSubEnd] = useState<string>(defaultOneYearFromToday());
  const [submitting, setSubmitting] = useState(false);
  const [submitMsg, setSubmitMsg] = useState<string | null>(null);
  const [submitErr, setSubmitErr] = useState<string | null>(null);

  // ── Load profile + auth state ───────────────────────────────────────────────
  useEffect(() => {
    try {
      let savedBar = '';
      let savedName = '';
      try {
        savedBar = localStorage.getItem('vakildesk_bar_no') || '';
        savedName = localStorage.getItem('vakildesk_advocate_name') || '';
      } catch {}

      if (!savedName && typeof document !== 'undefined') {
        const match = document.cookie.match(/(?:^|;\s*)vakildesk_advocate_name=([^;]*)/);
        if (match) savedName = decodeURIComponent(match[1]);
      }
      if (!savedBar && typeof document !== 'undefined') {
        const match = document.cookie.match(/(?:^|;\s*)vakildesk_bar_no=([^;]*)/);
        if (match) savedBar = decodeURIComponent(match[1]);
      }

      setBarCouncilNo(savedBar);
      setAdvocateName(savedName);
    } catch {}

    const checkUser = async () => {
      try {
        if (process.env.NODE_ENV !== 'production' && typeof document !== 'undefined') {
          const match = document.cookie.match(/(?:^|;\s*)vakildesk_dev_session=([^;]*)/);
          if (match) {
            const parsed = JSON.parse(decodeURIComponent(match[1]));
            setUserEmail(parsed.email || null);
            setUserRole(parsed.role || null);
            return;
          }
        }

        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          setUserEmail(user.email || null);
          setUserRole((user.app_metadata?.role as string) || null);
        }
      } catch {}
    };
    checkUser();

    const prefs = loadReminderPreferences();
    setReminderOffsets(prefs.offsets_minutes);
    setInAppReminders(prefs.in_app_enabled);
  }, []);

  // ── Lawyer list loader ──────────────────────────────────────────────────────
  const loadUsers = useCallback(async () => {
    setLoadingUsers(true);
    setListError(null);
    try {
      const res = await fetch('/api/admin/users');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load lawyers');
      setUsers(data.users || []);
    } catch (err) {
      setListError(err instanceof Error ? err.message : 'Could not load lawyers');
    } finally {
      setLoadingUsers(false);
    }
  }, []);

  // Load lawyers list once we know the user is a developer
  useEffect(() => {
    if (userRole === 'developer') loadUsers();
  }, [userRole, loadUsers]);

  // ── Profile save ────────────────────────────────────────────────────────────
  const handleSave = (e?: React.FormEvent | React.MouseEvent) => {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    setSaveStatus('saving');
    const trimmedName = advocateName.trim();
    const trimmedBar = barCouncilNo.trim();
    try {
      try {
        localStorage.setItem('vakildesk_bar_no', trimmedBar);
        localStorage.setItem('vakildesk_advocate_name', trimmedName);
      } catch {}
      if (typeof document !== 'undefined') {
        document.cookie = `vakildesk_advocate_name=${encodeURIComponent(trimmedName)}; path=/; max-age=31536000; SameSite=Lax`;
        document.cookie = `vakildesk_bar_no=${encodeURIComponent(trimmedBar)}; path=/; max-age=31536000; SameSite=Lax`;
      }
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('vakildesk-profile-update', { detail: { name: trimmedName } }));
      }
      setTimeout(() => setSaveStatus('saved'), 200);
      setTimeout(() => setSaveStatus('idle'), 2500);
    } catch {
      setSaveStatus('idle');
    }
  };

  // ── Sign out ────────────────────────────────────────────────────────────────
  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      if (typeof document !== 'undefined') {
        document.cookie = 'vakildesk_dev_session=; path=/; max-age=0; SameSite=Lax';
      }
      await fetch('/api/auth/logout', { method: 'POST' }).catch(() => null);
      router.push('/login');
      router.refresh();
    } catch {
      router.push('/login');
    } finally {
      setSigningOut(false);
    }
  };

  // ── Lawyer management handlers ──────────────────────────────────────────────
  const handleAddLawyer = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((formRole === 'lawyer' || formPhone.trim()) && !isValidIndianMobile(formPhone)) {
      setSubmitMsg(null);
      setSubmitErr('Enter a valid 10-digit mobile number. The lawyer must type this same number when they onboard.');
      return;
    }
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
      setSubmitMsg(`Added: ${data.user.email} (${data.user.role}, ${data.user.plan})`);
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

  const patchUser = async (id: string, patch: Partial<ApprovedUser & { force_logout?: boolean }>) => {
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
    if (!confirm(`Remove ${emailOfUser} from the allowlist? Their existing data in the app is not affected.`)) return;
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
    if (!confirm(`Force logout ${u.name || u.email}? Their device will be signed out within a minute, and they can sign in again straight away.`)) return;
    await patchUser(u.id, { force_logout: true } as any);
  };

  const extendOneYear = (u: ApprovedUser) => {
    const base = u.subscription_end ? new Date(u.subscription_end) : new Date();
    const next = new Date(base);
    next.setFullYear(next.getFullYear() + 1);
    patchUser(u.id, { subscription_end: next.toISOString() });
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div>
      <div className="section-label">{t('settings')}</div>

      {/* ── Appearance ── */}
      <div className="card">
        <div className="card-title">Appearance</div>
        <ThemeSwitch showLabel />
      </div>

      {/* ── Hearing reminders ── */}
      <div className="card">
        <div className="card-title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>Hearing reminders</span>
          <label className="toggle-switch" style={{ display: 'flex', alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={inAppReminders}
              onChange={(e) => {
                const enabled = e.target.checked;
                setInAppReminders(enabled);
                void persistReminderPreferences({ offsets_minutes: reminderOffsets, in_app_enabled: enabled });
              }}
              aria-label="Enable hearing reminders"
            />
            <span className="toggle-slider" />
          </label>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '8px 12px', marginTop: 12 }}>
          {REMINDER_OFFSET_OPTIONS.map((option) => {
            const checked = reminderOffsets.includes(option.minutes);
            return (
              <label key={option.minutes} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.86rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => {
                    const next = checked
                      ? reminderOffsets.filter((v) => v !== option.minutes)
                      : [...reminderOffsets, option.minutes].sort((a, b) => a - b);
                    const offsets = next.length ? next : [1440];
                    setReminderOffsets(offsets);
                    void persistReminderPreferences({ offsets_minutes: offsets, in_app_enabled: inAppReminders });
                  }}
                />
                {option.label}
              </label>
            );
          })}
        </div>
      </div>

      <PushNotificationsCard />

      {/* ── Language ── */}
      <div className="card">
        <div className="card-title">{t('language')}</div>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.84rem', marginBottom: 12 }}>
          Choose your preferred interface language.
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          {(['en', 'hi', 'te'] as SupportedLanguage[]).map((lang) => (
            <button
              key={lang}
              type="button"
              className={`action-btn ${language === lang ? 'action-btn-primary' : ''}`}
              style={{ flex: 1, justifyContent: 'center' }}
              onClick={() => setLanguage(lang)}
            >
              {lang === 'en' ? 'English' : lang === 'hi' ? 'हिन्दी' : 'తెలుగు'}
            </button>
          ))}
        </div>
      </div>

      {/* ── Advocate Profile ── */}
      <div className="card">
        <div className="card-title">{t('lawyerProfile')}</div>
        <form onSubmit={handleSave} action="#" method="get">
          <label className="input-label">Advocate Name</label>
          <input
            type="text"
            className="input-field"
            placeholder="e.g. R. K. Sharma"
            value={advocateName}
            onChange={(e) => setAdvocateName(e.target.value)}
          />
          <label className="input-label">{t('barCouncilNumber')}</label>
          <input
            type="text"
            className="input-field"
            placeholder="e.g. D/1234/2015"
            value={barCouncilNo}
            onChange={(e) => setBarCouncilNo(e.target.value)}
          />
          <label className="input-label">{t('courtTimezone')}</label>
          <input
            type="text"
            className="input-field"
            value="Asia/Kolkata (IST, UTC+05:30)"
            disabled
            style={{ opacity: 0.6, cursor: 'not-allowed' }}
          />
          <button
            type="button"
            onClick={handleSave}
            className="action-btn action-btn-primary"
            style={{ width: '100%', justifyContent: 'center', marginTop: 8 }}
            disabled={saveStatus === 'saving'}
          >
            {saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <CheckIcon /> Profile saved
              </span>
            ) : 'Save profile'}
          </button>
        </form>
      </div>

      {/* ════════════════════════════════════════════════════════════════════
          DEVELOPER-ONLY SECTION — Lawyer Management
          Only visible when signed in as the developer account
      ════════════════════════════════════════════════════════════════════ */}
      {userRole === 'developer' && (
        <>
          {/* ── Section header ── */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            margin: '24px 0 8px',
            paddingBottom: 8,
            borderBottom: '1px solid var(--border-subtle)',
          }}>
            <ShieldIcon />
            <span style={{ fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.08em', color: 'var(--accent-gold, #c8a03c)', textTransform: 'uppercase' }}>
              Developer — Lawyer Management
            </span>
          </div>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: '0 0 12px' }}>
            Only you can see this section. Add lawyers so they can sign in with Google, control which features they can access, and manage their subscription.
          </p>

          {/* ── Add lawyer form ── */}
          <div className="card">
            <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <UsersIcon />
              <span>Add / update a lawyer</span>
            </div>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: 12 }}>
              Enter the lawyer's Gmail address and mobile number. During onboarding the lawyer must type this same email and number; anything else is rejected and they are told to contact you. Submitting an existing email updates that record instead of creating a duplicate.
            </p>

            <form onSubmit={handleAddLawyer}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label className="input-label">Gmail address</label>
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
                  <label className="input-label">
                    {formRole === 'lawyer' ? 'Mobile number *' : 'Mobile number (optional)'}
                  </label>
                  <input
                    type="tel"
                    className="input-field"
                    placeholder="10 digit mobile"
                    value={formPhone}
                    onChange={(e) => setFormPhone(e.target.value)}
                    required={formRole === 'lawyer'}
                  />
                </div>
                <div>
                  <label className="input-label">Account type</label>
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
                  <label className="input-label">Subscription end date</label>
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
                {submitting ? 'Saving…' : 'Save lawyer'}
              </button>
            </form>
          </div>

          {/* ── Lawyer list ── */}
          {/* Developer-only: every lawyer's AI credits and usage */}
          <AiUsageDeveloperCard />

          <div className="card">
            <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Lawyers ({users.filter((u) => u.role === 'lawyer').length})</span>
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

            {users.filter((u) => u.role === 'lawyer').length === 0 && !loadingUsers ? (
              <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', padding: '10px 0' }}>
                No lawyers added yet. Use the form above to add one.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {users.filter((u) => u.role === 'lawyer').map((u) => {
                  const days = daysUntil(u.subscription_end);
                  const expiring = days !== null && days <= 15 && days >= 0;
                  const expired = days !== null && days < 0;
                  return (
                    <div
                      key={u.id}
                      style={{
                        padding: '12px 14px',
                        background: 'var(--bg-surface-elevated)',
                        borderRadius: 12,
                        border: `1px solid ${!u.is_active ? 'var(--status-danger)' : expired ? 'var(--status-danger)' : expiring ? 'var(--status-warning)' : 'var(--border-subtle)'}`,
                      }}
                    >
                      {/* Name + status badge */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.9rem' }}>
                            {u.name || u.email}
                          </div>
                          <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {u.email}{u.phone ? ` · ${u.phone}` : ''}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 5, flexShrink: 0, alignItems: 'center' }}>
                          {u.session_nonce && (
                            <span style={{
                              fontSize: '0.68rem',
                              fontWeight: 700,
                              padding: '2px 7px',
                              borderRadius: 999,
                              background: 'var(--accent-primary-dim)',
                              color: 'var(--accent-primary)',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 4,
                            }}>
                              <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--status-success)', display: 'inline-block' }} />
                              Online
                            </span>
                          )}
                          <span style={{
                            fontSize: '0.68rem',
                            fontWeight: 700,
                            padding: '2px 7px',
                            borderRadius: 999,
                            background: u.is_active ? 'var(--status-success-bg)' : 'var(--status-danger-bg)',
                            color: u.is_active ? 'var(--status-success)' : 'var(--status-danger)',
                          }}>
                            {u.is_active ? 'Active' : 'Paused'}
                          </span>
                        </div>
                      </div>

                      {/* Plan + subscription date */}
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
                        <div>
                          <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', marginBottom: 2 }}>Plan</label>
                          <select
                            className="input-field"
                            style={{ fontSize: '0.8rem', padding: '4px 6px' }}
                            value={u.plan}
                            onChange={(e) => patchUser(u.id, { plan: e.target.value as any })}
                          >
                            <option value="basic">Basic</option>
                            <option value="standard">Standard</option>
                            <option value="premium">Premium</option>
                          </select>
                        </div>
                        <div>
                          <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', marginBottom: 2 }}>Subscription ends</label>
                          <input
                            type="date"
                            className="input-field"
                            style={{ fontSize: '0.8rem', padding: '4px 6px' }}
                            value={dateInputFromIso(u.subscription_end)}
                            onChange={(e) => {
                              const iso = isoFromDateInput(e.target.value);
                              if (iso) patchUser(u.id, { subscription_end: iso });
                            }}
                          />
                        </div>
                      </div>

                      {/* Feature access toggles */}
                      <div style={{ marginBottom: 10 }}>
                        <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>Feature access</label>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          <button
                            type="button"
                            onClick={() => patchUser(u.id, { ai_enabled: !u.ai_enabled })}
                            className="action-btn"
                            style={{
                              fontSize: '0.78rem',
                              padding: '5px 12px',
                              background: u.ai_enabled ? 'var(--status-success-bg)' : 'var(--bg-surface-elevated)',
                              color: u.ai_enabled ? 'var(--status-success)' : 'var(--text-muted)',
                              border: `1px solid ${u.ai_enabled ? 'var(--status-success)' : 'var(--border-subtle)'}`,
                              fontWeight: 600,
                            }}
                          >
                            AI features {u.ai_enabled ? 'ON' : 'OFF'}
                          </button>
                          <button
                            type="button"
                            onClick={() => patchUser(u.id, { notes_enabled: !u.notes_enabled })}
                            className="action-btn"
                            style={{
                              fontSize: '0.78rem',
                              padding: '5px 12px',
                              background: u.notes_enabled ? 'var(--status-success-bg)' : 'var(--bg-surface-elevated)',
                              color: u.notes_enabled ? 'var(--status-success)' : 'var(--text-muted)',
                              border: `1px solid ${u.notes_enabled ? 'var(--status-success)' : 'var(--border-subtle)'}`,
                              fontWeight: 600,
                            }}
                          >
                            Notes & Diary {u.notes_enabled ? 'ON' : 'OFF'}
                          </button>
                        </div>
                      </div>

                      {/* Subscription status + action buttons */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, fontSize: '0.76rem', flexWrap: 'wrap' }}>
                        <span style={{
                          color: expired ? 'var(--status-danger)' : expiring ? 'var(--status-warning)' : 'var(--text-muted)',
                          fontWeight: expired || expiring ? 700 : 400,
                        }}>
                          {expired
                            ? `Expired ${Math.abs(days!)} days ago`
                            : days === null ? 'No end date'
                            : `Renews in ${days} days`}
                        </span>

                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <button
                            type="button"
                            onClick={() => extendOneYear(u)}
                            className="action-btn"
                            style={{ fontSize: '0.72rem', padding: '3px 8px' }}
                          >
                            +1 year
                          </button>
                          <button
                            type="button"
                            onClick={() => patchUser(u.id, { is_active: !u.is_active })}
                            className="action-btn"
                            style={{
                              fontSize: '0.72rem',
                              padding: '3px 8px',
                              color: u.is_active ? 'var(--status-warning)' : 'var(--status-success)',
                            }}
                          >
                            {u.is_active ? 'Pause' : 'Activate'}
                          </button>
                          {u.session_nonce && (
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
        </>
      )}

      {/* ── Account / Session ── */}
      <div className="card">
        <div className="card-title">Account & Session</div>
        {userEmail ? (
          <div style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', marginBottom: 14 }}>
            Signed in as <strong>{userEmail}</strong>
            {userRole && <span> ({userRole})</span>}
          </div>
        ) : (
          <div style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', marginBottom: 14 }}>
            Active session
          </div>
        )}
        <button
          type="button"
          onClick={handleSignOut}
          className="action-btn"
          style={{
            width: '100%',
            justifyContent: 'center',
            borderColor: 'rgba(220,50,50,0.3)',
            color: 'var(--status-danger)',
          }}
          disabled={signingOut}
        >
          <LogOutIcon />
          <span>{signingOut ? 'Signing out…' : 'Sign Out'}</span>
        </button>
      </div>
    </div>
  );
}
