'use client';

import React, { useState, useEffect } from 'react';
import { useLanguage } from '@/lib/i18n/context';
import { useTheme } from '@/lib/theme/context';
import type { SupportedLanguage } from '@/lib/types/database';

export default function SettingsPage() {
  const { language, setLanguage, t } = useLanguage();
  const { theme, toggleTheme } = useTheme();

  const [barCouncilNo, setBarCouncilNo] = useState('');
  const [advocateName, setAdvocateName] = useState('');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');

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

      // Notify header and any other component immediately
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('vakildesk-profile-update', { detail: { name: trimmedName } }));
      }

      setTimeout(() => setSaveStatus('saved'), 200);
      setTimeout(() => setSaveStatus('idle'), 2500);
    } catch {
      setSaveStatus('idle');
    }
  };

  const isLight = theme === 'light';

  return (
    <div>
      <div className="section-label">{t('settings')}</div>

      {/* ── Appearance ── */}
      <div className="card">
        <div className="card-title">Appearance</div>

        {/* Theme toggle row - Entire row is clickable for easy touch interaction */}
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
            <div style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--text-primary)' }}>
              {isLight ? '☀️ Light mode' : '🌙 Dark mode'}
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
            {saveStatus === 'saving'
              ? 'Saving…'
              : saveStatus === 'saved'
              ? '✓ Profile saved'
              : 'Save profile'}
          </button>
        </form>
      </div>

      <div className="disclaimer-box" role="note">
        <div className="disclaimer-title">{t('disclaimerTitle')}</div>
        <div>{t('disclaimerText')}</div>
      </div>
    </div>
  );
}
