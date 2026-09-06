'use client';

import React from 'react';
import { useLanguage } from '../lib/i18n/context';
import { SupportedLanguage } from '../lib/types/database';
import { SyncBadge } from './SyncBadge';

export function Header() {
  const { language, setLanguage, t } = useLanguage();

  return (
    <header className="app-header">
      <div className="header-brand">
        {/* Scales of Justice Icon */}
        <svg
          className="header-logo"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--accent-gold)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z" />
          <path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z" />
          <path d="M7 21h10" />
          <path d="M12 3v18" />
          <path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2" />
        </svg>
        <span className="header-title">{t('appName')}</span>
      </div>

      <div className="header-actions">
        <SyncBadge />

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
  );
}
