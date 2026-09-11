'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { useLanguage } from '@/lib/i18n/context';
import { CalendarView } from '@/components/CalendarView';
import { PWAInstaller } from '@/components/PWAInstaller';
import { loadClientFees } from '@/lib/data/repository';

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function getFormattedDate(): string {
  return new Date().toLocaleDateString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

function formatCurrency(paise: number) {
  return '₹' + (paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

type PaymentPeriod = 'week' | 'month' | 'year';

function getDateRange(period: PaymentPeriod): { start: Date; end: Date } {
  const now = new Date();
  const end = new Date(now);
  const start = new Date(now);
  if (period === 'week') {
    const dow = now.getDay();
    start.setDate(now.getDate() - (dow === 0 ? 6 : dow - 1));
  } else if (period === 'month') {
    start.setDate(1);
  } else {
    start.setMonth(0, 1);
  }
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

function PaymentReports() {
  const [period, setPeriod] = useState<PaymentPeriod>('week');

  const fees = useMemo(() => {
    try { return loadClientFees(); } catch { return []; }
  }, []);

  const { start, end } = getDateRange(period);
  const periodFees = fees.filter((f) => {
    if (f.payment_status !== 'paid') return false;
    const d = new Date(f.created_at);
    return d >= start && d <= end;
  });

  const totalPaise = periodFees.reduce((sum, f) => sum + f.amount * 100, 0);
  const count = periodFees.length;
  const avg = count > 0 ? totalPaise / count : 0;

  // Weekly bar: split into 7 days buckets
  const weekBars = useMemo(() => {
    if (period !== 'week') return [];
    const days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    const buckets = new Array(7).fill(0);
    const { start: wStart } = getDateRange('week');
    fees.filter(f => f.payment_status === 'paid').forEach(f => {
      const d = new Date(f.created_at);
      const idx = Math.floor((d.getTime() - wStart.getTime()) / (1000 * 60 * 60 * 24));
      if (idx >= 0 && idx < 7) buckets[idx] += f.amount;
    });
    const max = Math.max(...buckets, 1);
    return days.map((label, i) => ({ label, value: buckets[i], pct: (buckets[i] / max) * 100 }));
  }, [period, fees]);

  const tabs: { key: PaymentPeriod; label: string }[] = [
    { key: 'week', label: 'This Week' },
    { key: 'month', label: 'This Month' },
    { key: 'year', label: 'This Year' },
  ];

  return (
    <div className="card">
      <div className="card-title">
        <span>Payment Reports</span>
        <Link href="/app/billing" className="card-link">Full Report →</Link>
      </div>

      {/* Period Tabs */}
      <div style={{ display: 'flex', gap: 4, backgroundColor: 'var(--bg-app)', padding: 3, borderRadius: 8, marginBottom: 16 }}>
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setPeriod(t.key)}
            style={{
              flex: 1,
              background: period === t.key ? 'var(--bg-surface-elevated)' : 'transparent',
              color: period === t.key ? 'var(--text-primary)' : 'var(--text-muted)',
              border: 'none', borderRadius: 6, padding: '5px 0',
              fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Metrics Row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 16 }}>
        {[
          { label: 'Collected', value: formatCurrency(totalPaise) },
          { label: 'Payments', value: String(count) },
          { label: 'Average', value: formatCurrency(avg) },
        ].map((m) => (
          <div key={m.label} style={{ textAlign: 'center', backgroundColor: 'var(--bg-app)', borderRadius: 8, padding: '10px 6px' }}>
            <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--accent-gold)' }}>{m.value}</div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 2 }}>{m.label}</div>
          </div>
        ))}
      </div>

      {/* Weekly Bar Chart (only on week view) */}
      {period === 'week' && weekBars.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 56 }}>
          {weekBars.map((b) => (
            <div key={b.label} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
              <div
                title={`₹${b.value.toLocaleString('en-IN')}`}
                style={{
                  width: '100%',
                  height: `${Math.max(b.pct, 4)}%`,
                  minHeight: 4,
                  maxHeight: 40,
                  backgroundColor: b.pct > 0 ? 'var(--accent-gold)' : 'var(--border-subtle)',
                  borderRadius: '3px 3px 0 0',
                  transition: 'height 0.3s',
                }}
              />
              <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>{b.label}</span>
            </div>
          ))}
        </div>
      )}

      {count === 0 && (
        <div className="empty-state" style={{ marginTop: 8 }}>
          No payments recorded for this period.
        </div>
      )}
    </div>
  );
}

export default function HomePage() {
  const { t } = useLanguage();
  const greeting = useMemo(getGreeting, []);
  const dateString = useMemo(getFormattedDate, []);

  return (
    <div>
      <PWAInstaller />

      {/* Greeting */}
      <div className="greeting-section">
        <div className="greeting-date">{dateString}</div>
        <div className="greeting-text">{greeting}</div>
      </div>

      {/* Calendar (Week default / Month toggle) */}
      <CalendarView />

      {/* Quick Actions */}
      <div className="section-label" style={{ marginTop: 4 }}>Quick Actions</div>
      <div className="quick-actions-grid">
        {/* 1. Add Client */}
        <Link href="/app/clients?action=new" className="action-btn action-btn-primary">
          <svg className="action-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <line x1="19" x2="19" y1="8" y2="14" /><line x1="22" x2="16" y1="11" y2="11" />
          </svg>
          <span>{t('addClient')}</span>
        </Link>

        {/* 2. New Case */}
        <Link href="/app/matters?action=new" className="action-btn">
          <svg className="action-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect width="20" height="14" x="2" y="7" rx="2" ry="2" />
            <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
          </svg>
          <span>New Case</span>
        </Link>

        {/* 3. Record Note */}
        <Link href="/app/diary?action=record" className="action-btn">
          <svg className="action-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" x2="12" y1="19" y2="22" />
          </svg>
          <span>{t('recordNote')}</span>
        </Link>

        {/* 4. Add Appointment */}
        <Link href="/app/matters?action=new_booking" className="action-btn">
          <svg className="action-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect width="18" height="18" x="3" y="4" rx="2" ry="2" />
            <line x1="16" x2="16" y1="2" y2="6" /><line x1="8" x2="8" y1="2" y2="6" />
            <line x1="3" x2="21" y1="10" y2="10" />
            <line x1="12" x2="12" y1="14" y2="18" /><line x1="10" x2="14" y1="16" y2="16" />
          </svg>
          <span>{t('addAppointment')}</span>
        </Link>
      </div>

      {/* Payment Reports */}
      <PaymentReports />

      {/* Recent Diary Notes */}
      <div className="card">
        <div className="card-title">
          <span>{t('recentNotes')}</span>
          <Link href="/app/diary" className="card-link">Open Diary →</Link>
        </div>
        <div className="empty-state">{t('noRecentNotes')}</div>
      </div>

      {/* Legal Disclaimer */}
      <div className="disclaimer-box" role="note">
        <div className="disclaimer-title">{t('disclaimerTitle')}</div>
        <div>{t('disclaimerText')}</div>
      </div>
    </div>
  );
}
