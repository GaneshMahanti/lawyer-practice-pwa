'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useLanguage } from '@/lib/i18n/context';
import { CalendarView } from '@/components/CalendarView';
import { PWAInstaller } from '@/components/PWAInstaller';
import {
  getDueInAppReminders,
  effectiveHearingStartMs,
  loadDismissedReminderIds,
  saveDismissedReminderIds,
} from '@/lib/reminders/engine';
import {
  loadClientFees,
  loadBookings,
  loadMatters,
  loadClients,
  loadReminders,
  loadUnifiedNotes,
} from '@/lib/data/repository';
import type { Booking, Matter, Client, Reminder, DiaryEntry } from '@/lib/types/database';

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

function RemindersBanner() {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [matters, setMatters] = useState<Matter[]>([]);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => loadDismissedReminderIds());
  // Re-check the clock so a reminder appears the moment its time arrives, even if the app stays open.
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const tick = () => setNowMs(Date.now());
    const timer = window.setInterval(tick, 30_000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, []);

  const refresh = () => {
    try {
      setReminders(loadReminders());
      setBookings(loadBookings());
      setMatters(loadMatters());
    } catch {
      // fallback
    }
  };

  useEffect(() => {
    refresh();
    window.addEventListener('vakildesk-reminders-update', refresh);
    window.addEventListener('vakildesk-bookings-update', refresh);
    window.addEventListener('vakildesk-matters-update', refresh);
    window.addEventListener('vakildesk-workspace-ready', refresh);
    return () => {
      window.removeEventListener('vakildesk-reminders-update', refresh);
      window.removeEventListener('vakildesk-bookings-update', refresh);
      window.removeEventListener('vakildesk-matters-update', refresh);
      window.removeEventListener('vakildesk-workspace-ready', refresh);
    };
  }, []);

  const triggered = getDueInAppReminders(reminders, bookings, nowMs, dismissedIds);

  if (triggered.length === 0) return null;

  const dismiss = (ids: string[]) => {
    const next = new Set([...dismissedIds, ...ids]);
    setDismissedIds(next);
    saveDismissedReminderIds(next);
  };
  const dismissAll = () => dismiss(triggered.map((r) => r.id));

  return (
    <div
      className="card"
      style={{
        border: '1px solid rgba(245, 158, 11, 0.35)',
        backgroundColor: 'rgba(245, 158, 11, 0.08)',
        marginBottom: 16,
        padding: '12px 14px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 26,
              height: 26,
              borderRadius: '50%',
              backgroundColor: 'rgba(245, 158, 11, 0.2)',
              color: 'var(--status-warning, #f59e0b)',
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
          </span>
          <span style={{ fontSize: '13.5px', fontWeight: 700, color: 'var(--text-primary)' }}>
            Hearing Reminders ({triggered.length})
          </span>
        </div>
        <button
          type="button"
          onClick={dismissAll}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--text-muted)',
            fontSize: '11.5px',
            fontWeight: 600,
            cursor: 'pointer',
            padding: '4px 6px',
          }}
        >
          Dismiss All
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {triggered.map((r) => {
          const booking = bookings.find((b) => b.id === r.booking_id);
          const matter = matters.find((m) => m.id === (r.matter_id || booking?.matter_id));
          const hearingDate = booking ? new Date(effectiveHearingStartMs(booking.start_at)) : null;
          const formattedHearing = hearingDate
            ? `${hearingDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} at ${hearingDate.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}`
            : null;

          return (
            <div
              key={r.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '7px 10px',
                borderRadius: 8,
                backgroundColor: 'var(--bg-app)',
                border: '1px solid var(--card-brd)',
                fontSize: '12px',
              }}
            >
              <div>
                <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                  {matter?.title || booking?.purpose || 'Hearing scheduled'}
                </div>
                {formattedHearing && (
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: 2 }}>
                    Scheduled: {formattedHearing}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => dismiss([r.id])}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  fontSize: '11px',
                  padding: '2px 4px',
                }}
                title="Dismiss reminder"
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function UpcomingHearings() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [matters, setMatters] = useState<Matter[]>([]);
  const [clients, setClients] = useState<Client[]>([]);

  const refresh = () => {
    try {
      setBookings(loadBookings());
      setMatters(loadMatters());
      setClients(loadClients());
    } catch {
      // fallback
    }
  };

  useEffect(() => {
    refresh();
    window.addEventListener('vakildesk-bookings-update', refresh);
    window.addEventListener('vakildesk-matters-update', refresh);
    window.addEventListener('vakildesk-clients-update', refresh);
    window.addEventListener('vakildesk-workspace-ready', refresh);
    return () => {
      window.removeEventListener('vakildesk-bookings-update', refresh);
      window.removeEventListener('vakildesk-matters-update', refresh);
      window.removeEventListener('vakildesk-clients-update', refresh);
      window.removeEventListener('vakildesk-workspace-ready', refresh);
    };
  }, []);

  const nowStart = new Date();
  nowStart.setHours(0, 0, 0, 0);

  // Scheduled upcoming hearings read strictly from bookings using start_at
  const upcoming = bookings
    .filter((b) => b.status === 'scheduled' && new Date(b.start_at) >= nowStart)
    .sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime())
    .slice(0, 5);

  return (
    <div className="card" style={{ padding: '14px' }}>
      <div className="card-title">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ color: 'var(--accent)' }}>
            <rect width="18" height="18" x="3" y="4" rx="2" ry="2" />
            <line x1="16" x2="16" y1="2" y2="6" />
            <line x1="8" x2="8" y1="2" y2="6" />
            <line x1="3" x2="21" y1="10" y2="10" />
          </svg>
          <span>Upcoming Hearings</span>
        </div>
        <Link href="/app/matters" className="card-link">View All Matters →</Link>
      </div>

      {upcoming.length === 0 ? (
        <div className="empty-state" style={{ padding: '18px 8px' }}>
          No upcoming hearings scheduled.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          {upcoming.map((b) => {
            const matter = matters.find((m) => m.id === b.matter_id);
            const client = clients.find((c) => c.id === (b.client_id || matter?.client_id));
            const hearingDate = new Date(b.start_at);
            const dateStr = hearingDate.toLocaleDateString('en-IN', {
              day: 'numeric',
              month: 'short',
            });
            const timeStr = hearingDate.toLocaleTimeString('en-IN', {
              hour: '2-digit',
              minute: '2-digit',
              hour12: true,
            });

            return (
              <div
                key={b.id}
                style={{
                  backgroundColor: 'var(--bg-app)',
                  borderRadius: 10,
                  border: '1px solid var(--card-brd)',
                  padding: '10px 12px',
                }}
              >
                {/* Header row with date/time pill and matter badge */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        fontSize: '11px',
                        fontWeight: 700,
                        padding: '2px 8px',
                        borderRadius: 999,
                        backgroundColor: 'var(--accent-soft)',
                        color: 'var(--accent)',
                      }}
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <circle cx="12" cy="12" r="10" />
                        <polyline points="12 6 12 12 16 14" />
                      </svg>
                      {dateStr} • {timeStr}
                    </span>
                    {matter?.matter_number && (
                      <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--accent-gold)' }}>
                        {matter.matter_number}
                      </span>
                    )}
                  </div>
                  {matter?.case_type && (
                    <span style={{ fontSize: '10.5px', color: 'var(--text-muted)', fontWeight: 600 }}>
                      {matter.case_type}
                    </span>
                  )}
                </div>

                {/* Case Title / Purpose */}
                <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 3 }}>
                  {matter?.title || b.purpose || 'Scheduled Hearing'}
                </div>

                {/* Client and Court */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, fontSize: '11px', color: 'var(--text-secondary)', marginTop: 4 }}>
                  {client && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
                        <circle cx="12" cy="7" r="4" />
                      </svg>
                      <span>Client: <strong style={{ color: 'var(--text-primary)' }}>{client.name}</strong></span>
                    </span>
                  )}
                  {(matter?.court_complex || matter?.court_name) && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <rect width="16" height="10" x="4" y="10" rx="1" />
                        <path d="M12 2L2 7h20L12 2z" />
                        <line x1="6" y1="10" x2="6" y2="20" />
                        <line x1="10" y1="10" x2="10" y2="20" />
                        <line x1="14" y1="10" x2="14" y2="20" />
                        <line x1="18" y1="10" x2="18" y2="20" />
                      </svg>
                      <span>{matter.court_complex || matter.court_name}</span>
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function RecentDiaryNotes() {
  const { t } = useLanguage();
  const [notes, setNotes] = useState<DiaryEntry[]>([]);
  const [clients, setClients] = useState<Client[]>([]);

  const refresh = () => {
    try {
      setNotes(loadUnifiedNotes());
      setClients(loadClients());
    } catch {
      // fallback
    }
  };

  useEffect(() => {
    refresh();
    window.addEventListener('vakildesk-notes-update', refresh);
    window.addEventListener('vakildesk-clients-update', refresh);
    window.addEventListener('vakildesk-workspace-ready', refresh);
    return () => {
      window.removeEventListener('vakildesk-notes-update', refresh);
      window.removeEventListener('vakildesk-clients-update', refresh);
      window.removeEventListener('vakildesk-workspace-ready', refresh);
    };
  }, []);

  const recent = notes
    .slice()
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 3);

  return (
    <div className="card">
      <div className="card-title">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ color: 'var(--accent)' }}>
            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" x2="12" y1="19" y2="22" />
          </svg>
          <span>{t('recentNotes')}</span>
        </div>
        <Link href="/app/diary" className="card-link">Open Diary →</Link>
      </div>

      {recent.length === 0 ? (
        <div className="empty-state">{t('noRecentNotes')}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {recent.map((n) => {
            const client = clients.find((c) => c.id === n.client_id);
            const dateStr = new Date(n.created_at).toLocaleDateString('en-IN', {
              day: 'numeric',
              month: 'short',
            });
            const isVoice = n.entry_type === 'voice';

            return (
              <div
                key={n.id}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                  backgroundColor: 'var(--bg-app)',
                  borderRadius: 8,
                  padding: '9px 11px',
                  border: '1px solid var(--card-brd)',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 28,
                    height: 28,
                    borderRadius: '50%',
                    backgroundColor: isVoice ? 'rgba(59, 130, 246, 0.12)' : 'rgba(234, 179, 8, 0.12)',
                    color: isVoice ? 'var(--accent)' : 'var(--accent-gold)',
                    flexShrink: 0,
                    marginTop: 1,
                  }}
                >
                  {isVoice ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                      <line x1="12" x2="12" y1="19" y2="22" />
                    </svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                      <line x1="16" x2="8" y1="13" y2="13" />
                      <line x1="16" x2="8" y1="17" y2="17" />
                    </svg>
                  )}
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {n.title || (isVoice ? 'Voice Note' : 'Written Note')}
                    </div>
                    <span style={{ fontSize: '10.5px', color: 'var(--text-muted)', flexShrink: 0, marginLeft: 6 }}>
                      {dateStr}
                    </span>
                  </div>

                  {n.content && (
                    <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 4 }}>
                      {n.content}
                    </div>
                  )}

                  {client && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '10.5px', color: 'var(--text-muted)' }}>
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
                        <circle cx="12" cy="7" r="4" />
                      </svg>
                      <span>{client.name}</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
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

      {/* Reminders banner (when triggered) */}
      <RemindersBanner />

      {/* Greeting */}
      <div className="greeting-section">
        <div className="greeting-date">{dateString}</div>
        <div className="greeting-text">{greeting}</div>
      </div>

      {/* Calendar (Week default / Month toggle / Day agenda click-through) */}
      <CalendarView />

      {/* Upcoming Hearings (Source of truth: bookings.start_at) */}
      <UpcomingHearings />

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

      {/* Recent Diary Notes */}
      <RecentDiaryNotes />

      {/* Payment Reports */}
      <PaymentReports />
    </div>
  );
}
