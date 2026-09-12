'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/lib/i18n/context';
import { useTheme } from '@/lib/theme/context';
import { createClient } from '@/lib/supabase/client';
import { persistReminderPreferences, loadReminderPreferences } from '@/lib/data/repository';
import { REMINDER_OFFSET_OPTIONS } from '@/lib/reminders/engine';
import type { SupportedLanguage } from '@/lib/types/database';

function SunIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
    </svg>
  );
}

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
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

export default function SettingsPage() {
  const router = useRouter();
  const { language, setLanguage, t } = useLanguage();
  const { theme, toggleTheme } = useTheme();

  const [barCouncilNo, setBarCouncilNo] = useState('');
  const [advocateName, setAdvocateName] = useState('');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [userRole, setUserRole] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [reminderOffsets, setReminderOffsets] = useState<number[]>([1440, 120]);
  const [inAppReminders, setInAppReminders] = useState(true);

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

    // Check user auth state
    const checkUser = async () => {
      try {
        if (typeof document !== 'undefined') {
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
          const role = (user.app_metadata?.role as string) || null;
          setUserRole(role);
        }
      } catch {}
    };
    checkUser();
    const prefs = loadReminderPreferences();
    setReminderOffsets(prefs.offsets_minutes);
    setInAppReminders(prefs.in_app_enabled);
  }, []);

  const handleSave = (e?: React.FormEvent | React.MouseEvent) => {
    if (e && typeof e.preventDefault === 'function') {
      e.preventDefault();
    }
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

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      if (typeof document !== 'undefined') {
        document.cookie = 'vakildesk_dev_session=; path=/; max-age=0; SameSite=Lax';
      }
      const supabase = createClient();
      await supabase.auth.signOut();
      router.push('/login');
      router.refresh();
    } catch {
      router.push('/login');
    } finally {
      setSigningOut(false);
    }
  };

  const isLight = theme === 'light';

  return (
    <div>
      <div className="section-label">{t('settings')}</div>

      {/* ── Appearance ── */}
      <div className="card">
        <div className="card-title">Appearance</div>

        <div
          className="theme-toggle-row"
          onClick={toggleTheme}
          style={{ cursor: 'pointer', userSelect: 'none', WebkitTapHighlightColor: 'transparent' }}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              toggleTheme();
            }
          }}
          aria-label="Toggle dark and light theme"
        >
          <div>
            <div style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
              {isLight ? <SunIcon /> : <MoonIcon />}
              <span>{isLight ? 'Light mode' : 'Dark mode'}</span>
            </div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 2 }}>
              {isLight
                ? 'Navy header, crisp white background'
                : 'OLED dark background, light grey text'}
            </div>
          </div>
          <div className="toggle-switch" style={{ pointerEvents: 'none' }}>
            <input
              type="checkbox"
              checked={isLight}
              readOnly
              aria-hidden="true"
            />
            <span className="toggle-slider" />
          </div>
        </div>
      </div>

      {/* ── Hearing reminders ── */}
      <div className="card">
        <div className="card-title">Hearing reminders</div>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.84rem', marginBottom: 12 }}>
          In-app reminders are generated from court bookings. WhatsApp messages are never sent from Demo Mode and only go to real clients who have opted in.
        </p>
        <label className="toggle-switch" style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
          <input
            type="checkbox"
            checked={inAppReminders}
            onChange={(e) => {
              const enabled = e.target.checked;
              setInAppReminders(enabled);
              void persistReminderPreferences({ offsets_minutes: reminderOffsets, in_app_enabled: enabled });
            }}
          />
          <span className="toggle-slider" />
          <span style={{ fontSize: '0.88rem' }}>Enable in-app reminders</span>
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '8px 12px' }}>
          {REMINDER_OFFSET_OPTIONS.map((option) => {
            const checked = reminderOffsets.includes(option.minutes);
            return (
              <label key={option.minutes} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.86rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => {
                    const next = checked
                      ? reminderOffsets.filter((value) => value !== option.minutes)
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
            {saveStatus === 'saving' ? (
              'Saving…'
            ) : saveStatus === 'saved' ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <CheckIcon /> Profile saved
              </span>
            ) : (
              'Save profile'
            )}
          </button>
        </form>
      </div>

      {/* ── Developer & Security Section (if developer or debug) ── */}
      {userRole === 'developer' && (
        <div className="card" style={{ borderColor: 'var(--accent-gold, #c8a03c)' }}>
          <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--accent-gold, #c8a03c)' }}>
            <ShieldIcon />
            <span>Developer Controls</span>
          </div>
          <div style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', marginBottom: 12 }}>
            Authenticated as <strong>{userEmail}</strong> (Role: <code style={{ color: 'var(--accent-primary)' }}>developer</code>).
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: '0.82rem', padding: '8px 10px', background: 'var(--bg-surface-elevated)', borderRadius: 8 }}>
              • Service role operations active<br />
              • Route-level middleware RBAC enforced<br />
              • Client portal access restricted to isolated token routes
            </div>
          </div>
        </div>
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

      <div className="disclaimer-box" role="note">
        <div className="disclaimer-title">{t('disclaimerTitle')}</div>
        <div>{t('disclaimerText')}</div>
      </div>
    </div>
  );
}
