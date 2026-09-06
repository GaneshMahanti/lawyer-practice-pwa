'use client';

import React from 'react';
import Link from 'next/link';
import { useLanguage } from '@/lib/i18n/context';
import { PWAInstaller } from '@/components/PWAInstaller';

export default function HomePage() {
  const { t } = useLanguage();

  return (
    <div>
      <PWAInstaller />

      {/* Quick Actions Bar */}
      <div className="section-label">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
        </svg>
        Quick Actions
      </div>

      <div className="quick-actions-grid">
        <Link href="/clients?action=new" className="action-btn action-btn-primary">
          <svg className="action-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <line x1="19" x2="19" y1="8" y2="14" />
            <line x1="22" x2="16" y1="11" y2="11" />
          </svg>
          <span>{t('addClient')}</span>
        </Link>

        <Link href="/matters?action=new_booking" className="action-btn">
          <svg className="action-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect width="18" height="18" x="3" y="4" rx="2" ry="2" />
            <line x1="16" x2="16" y1="2" y2="6" />
            <line x1="8" x2="8" y1="2" y2="6" />
            <line x1="3" x2="21" y1="10" y2="10" />
            <line x1="12" x2="12" y1="14" y2="18" />
            <line x1="10" x2="14" y1="16" y2="16" />
          </svg>
          <span>{t('addAppointment')}</span>
        </Link>

        <Link href="/diary?action=record" className="action-btn">
          <svg className="action-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" x2="12" y1="19" y2="22" />
          </svg>
          <span>{t('recordNote')}</span>
        </Link>

        <Link href="/billing?action=create_link" className="action-btn">
          <svg className="action-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect width="20" height="14" x="2" y="5" rx="2" />
            <line x1="2" x2="22" y1="10" y2="10" />
          </svg>
          <span>{t('createPaymentLink')}</span>
        </Link>
      </div>

      {/* Today's Schedule Card */}
      <div className="card">
        <div className="card-title">
          <span>{t('todaySchedule')}</span>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            Asia/Kolkata
          </span>
        </div>
        <div className="empty-state">
          <svg
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--border-strong)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ margin: '0 auto 8px', display: 'block' }}
          >
            <rect width="18" height="18" x="3" y="4" rx="2" ry="2" />
            <line x1="16" x2="16" y1="2" y2="6" />
            <line x1="8" x2="8" y1="2" y2="6" />
            <line x1="3" x2="21" y1="10" y2="10" />
          </svg>
          {t('noHearingsToday')}
        </div>
      </div>

      {/* Upcoming Hearings Card */}
      <div className="card">
        <div className="card-title">
          <span>{t('upcomingHearings')}</span>
          <span className="badge badge-synced">Next 7 Days</span>
        </div>
        <div className="empty-state">
          {t('noUpcomingHearings')}
        </div>
      </div>

      {/* Outstanding Fees / Invoices Card */}
      <div className="card">
        <div className="card-title">
          <span>{t('outstandingFees')}</span>
          <Link href="/billing" style={{ fontSize: '0.78rem', color: 'var(--accent-gold)', textDecoration: 'none' }}>
            View all →
          </Link>
        </div>
        <div className="empty-state">
          {t('noPendingFees')}
        </div>
      </div>

      {/* Recent Diary Notes Card */}
      <div className="card">
        <div className="card-title">
          <span>{t('recentNotes')}</span>
          <Link href="/diary" style={{ fontSize: '0.78rem', color: 'var(--accent-gold)', textDecoration: 'none' }}>
            Open Diary →
          </Link>
        </div>
        <div className="empty-state">
          {t('noRecentNotes')}
        </div>
      </div>

      {/* Mandatory Legal Disclaimer & Verification Boundary */}
      <div className="disclaimer-box" role="note">
        <div className="disclaimer-title">{t('disclaimerTitle')}</div>
        <div>{t('disclaimerText')}</div>
      </div>
    </div>
  );
}
