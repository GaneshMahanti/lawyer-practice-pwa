'use client';

import React, { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useLanguage } from '../lib/i18n/context';
import { useTheme } from '../lib/theme/context';
import type { SupportedLanguage } from '../lib/types/database';

/**
 * Advocate gown collar logo — exact SVG traced from provided reference images.
 *
 * Light mode: white circle, thick black border, black gown shape inside.
 * Dark mode:  black circle, thick white/grey border, white gown shape inside.
 *
 * Shape: two peaked collar wings at top (with a downward V-notch between them)
 *        + two rectangular hanging strips at the bottom (with a gap between them).
 *        Inner gap cut with fill-rule="evenodd".
 */
function AdvocateLogo({ size = 32 }: { size?: number }) {
  const { theme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const isDark = mounted ? theme === 'dark' : true;

  return (
    <img
      src={isDark ? '/logo-dark.png' : '/logo-light.png'}
      alt="Advocate Collar Band Logo"
      width={size}
      height={size}
      style={{
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: '50%',
        objectFit: 'contain',
        flexShrink: 0,
        display: 'block',
      }}
    />
  );
}

export function Header() {
  const { language, setLanguage, t } = useLanguage();
  const { theme, toggleTheme } = useTheme();
  const [advocateName, setAdvocateName] = useState<string>('');
  const [mounted, setMounted] = useState(false);
  const [demoMode, setDemoMode] = useState(false);

  useEffect(() => {
    createClient().auth.getUser().then(({ data }) => {
      setDemoMode(data.user?.is_anonymous === true || data.user?.app_metadata?.provider === 'anonymous');
    });
  }, []);

  // Read advocate name from localStorage and cookies, and listen for updates
  useEffect(() => {
    setMounted(true);
    const readName = (overrideName?: string) => {
      if (typeof overrideName === 'string') {
        setAdvocateName(overrideName);
        return;
      }
      try {
        let name = '';
        try {
          name = localStorage.getItem('vakildesk_advocate_name') || '';
        } catch {}

        if (!name && typeof document !== 'undefined') {
          const match = document.cookie.match(/(?:^|;\s*)vakildesk_advocate_name=([^;]*)/);
          if (match) name = decodeURIComponent(match[1]);
        }
        setAdvocateName(name);
      } catch {}
    };
    readName();

    const handleProfileUpdate = (e: Event) => {
      const customEvent = e as CustomEvent<{ name?: string }>;
      if (customEvent.detail && typeof customEvent.detail.name === 'string') {
        readName(customEvent.detail.name);
      } else {
        readName();
      }
    };

    window.addEventListener('vakildesk-profile-update', handleProfileUpdate);
    window.addEventListener('storage', () => readName());
    return () => {
      window.removeEventListener('vakildesk-profile-update', handleProfileUpdate);
      window.removeEventListener('storage', () => readName());
    };
  }, []);

  const displayName = mounted && advocateName
    ? `Adv. ${advocateName}`
    : 'Advocate';

  return (
    <>
      {demoMode && <div style={{ background: '#8b5cf6', color: '#fff', textAlign: 'center', fontSize: '0.76rem', fontWeight: 700, padding: '6px 12px' }}>Demo Mode — Sample Data</div>}
    <header className="app-header">
      <div className="header-brand">
        <AdvocateLogo size={30} />
        <div className="header-title-group">
          <span className="header-title">{displayName}</span>
          <span className="header-subtitle">Practice Manager</span>
        </div>
      </div>

      <div className="header-actions">
        {/* Dark / Light toggle */}
        <button
          type="button"
          className="theme-toggle-btn"
          onClick={toggleTheme}
          aria-label={mounted && theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
          title={mounted && theme === 'light' ? 'Dark mode' : 'Light mode'}
        >
          {mounted && theme === 'light' ? '🌙' : '☀️'}
        </button>

        <select
          className="lang-selector"
          value={language}
          onChange={(e) => setLanguage(e.target.value as SupportedLanguage)}
          aria-label={t('language')}
        >
          <option value="en">EN</option>
          <option value="hi">हिन्दी</option>
          <option value="te">తెలుగు</option>
        </select>
      </div>
    </header>
    </>
  );
}
