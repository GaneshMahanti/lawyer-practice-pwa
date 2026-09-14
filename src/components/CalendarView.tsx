'use client';

import React, { useEffect, useState } from 'react';
import { loadBookings, loadMatters, loadClients } from '@/lib/data/repository';
import type { Booking, Matter, Client } from '@/lib/types/database';

type ViewMode = 'week' | 'month' | 'day';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const DAY_HEADERS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEK_LABELS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

function isSameDay(a: Date, b: Date) {
  return (
    a.getDate() === b.getDate() &&
    a.getMonth() === b.getMonth() &&
    a.getFullYear() === b.getFullYear()
  );
}

function formatTime(isoStr: string): string {
  try {
    const d = new Date(isoStr);
    return d.toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return isoStr;
  }
}

export function CalendarView() {
  const today = new Date();
  const [viewMode, setViewMode] = useState<ViewMode>('week');
  const [previousView, setPreviousView] = useState<'week' | 'month'>('week');
  const [selectedDay, setSelectedDay] = useState<Date>(today);
  const [calMonth, setCalMonth] = useState(
    new Date(today.getFullYear(), today.getMonth(), 1),
  );
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [matters, setMatters] = useState<Matter[]>([]);
  const [clients, setClients] = useState<Client[]>([]);

  useEffect(() => {
    const refresh = () => {
      setBookings(loadBookings().filter((booking) => booking.status === 'scheduled'));
      setMatters(loadMatters());
      setClients(loadClients());
    };
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

  const openDayView = (d: Date) => {
    if (viewMode !== 'day') {
      setPreviousView(viewMode);
    }
    setSelectedDay(d);
    setViewMode('day');
  };

  const hearingCount = (date: Date) => bookings.filter((booking) => isSameDay(new Date(booking.start_at), date)).length;

  // ── Month Calendar ─────────────────────────────────────────
  const year = calMonth.getFullYear();
  const month = calMonth.getMonth();
  const firstDow = new Date(year, month, 1).getDay(); // 0 = Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrev = new Date(year, month, 0).getDate();

  const cells: { date: Date; current: boolean }[] = [];

  // Leading cells from previous month
  for (let i = firstDow - 1; i >= 0; i--) {
    cells.push({ date: new Date(year, month - 1, daysInPrev - i), current: false });
  }
  // Current month
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ date: new Date(year, month, d), current: true });
  }
  // Trailing cells to complete last row
  const rem = cells.length % 7;
  if (rem !== 0) {
    for (let d = 1; d <= 7 - rem; d++) {
      cells.push({ date: new Date(year, month + 1, d), current: false });
    }
  }

  // ── Week Strip ────────────────────────────────────────────
  // Get Monday of current week
  const dow = today.getDay(); // 0=Sun
  const monday = new Date(today);
  monday.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1));
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });

  // ── Day View Bookings ─────────────────────────────────────
  const dayBookings = bookings.filter((b) => isSameDay(new Date(b.start_at), selectedDay));

  return (
    <div className="card" style={{ padding: '14px' }}>
      {/* Toolbar */}
      <div className="cal-toolbar">
        <span className="cal-heading">Schedule</span>
        <div className="cal-toggle">
          <button
            className={`cal-toggle-btn ${viewMode === 'week' ? 'active' : ''}`}
            onClick={() => setViewMode('week')}
          >
            Week
          </button>
          <button
            className={`cal-toggle-btn ${viewMode === 'month' ? 'active' : ''}`}
            onClick={() => setViewMode('month')}
          >
            Month
          </button>
          {viewMode === 'day' && (
            <button className="cal-toggle-btn active">
              Day
            </button>
          )}
        </div>
      </div>

      {viewMode === 'week' ? (
        /* ── WEEK VIEW ── */
        <div className="week-strip">
          {weekDays.map((d, i) => {
            const isToday = isSameDay(d, today);
            return (
              <div
                key={i}
                className={`week-day-col ${isToday ? 'is-today' : ''}`}
                onClick={() => openDayView(d)}
                style={{ cursor: 'pointer' }}
                title={`View agenda for ${d.toDateString()}`}
              >
                <span className="week-day-name">{WEEK_LABELS[i]}</span>
                <span className="week-day-num">{d.getDate()}</span>
                <span className="week-day-dot">{hearingCount(d) ? '•' : '–'}</span>
              </div>
            );
          })}
        </div>
      ) : viewMode === 'month' ? (
        /* ── MONTH VIEW ── */
        <>
          {/* Month navigation */}
          <div className="month-nav">
            <button
              className="month-nav-btn"
              onClick={() => setCalMonth(new Date(year, month - 1, 1))}
              aria-label="Previous month"
            >
              ◀
            </button>
            <span className="month-title">
              {MONTH_NAMES[month]} {year}
            </span>
            <button
              className="month-nav-btn"
              onClick={() => setCalMonth(new Date(year, month + 1, 1))}
              aria-label="Next month"
            >
              ▶
            </button>
          </div>

          {/* Day headers row */}
          <div className="month-day-headers">
            {DAY_HEADERS.map((h) => (
              <div key={h} className="month-day-hdr">
                {h}
              </div>
            ))}
          </div>

          {/* Date grid */}
          <div className="month-grid">
            {cells.map((cell, i) => {
              const isToday = isSameDay(cell.date, today);
              return (
                <div
                  key={i}
                  className={[
                    'month-cell',
                    isToday ? 'is-today' : '',
                    !cell.current ? 'other-month' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onClick={() => openDayView(cell.date)}
                  title={`View agenda for ${cell.date.toDateString()}`}
                >
                  {cell.date.getDate()}{hearingCount(cell.date) ? ' •' : ''}
                </div>
              );
            })}
          </div>

          <p className="cal-note">
            Hearings from the last 90 days and the next 90 days are displayed in
            the calendar above.
          </p>
        </>
      ) : (
        /* ── DAY VIEW ── */
        <div>
          {/* Back breadcrumb and hearing count */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <button
              type="button"
              onClick={() => setViewMode(previousView)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                background: 'var(--seg-track)',
                border: '1px solid var(--card-brd)',
                color: 'var(--text-primary)',
                borderRadius: 8,
                padding: '5px 10px',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="15 18 9 12 15 6" />
              </svg>
              Back to {previousView === 'month' ? 'Month' : 'Week'}
            </button>
            <span style={{ fontSize: '11.5px', color: 'var(--text-muted)', fontWeight: 600 }}>
              {dayBookings.length} {dayBookings.length === 1 ? 'scheduled item' : 'scheduled items'}
            </span>
          </div>

          {/* Day Title */}
          <div style={{ marginBottom: 12, paddingBottom: 8, borderBottom: '1px solid var(--border-subtle)' }}>
            <div style={{ fontSize: '14.5px', fontWeight: 700, color: 'var(--text-primary)' }}>
              {selectedDay.toLocaleDateString('en-IN', {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
            </div>
          </div>

          {/* Bookings List */}
          {dayBookings.length === 0 ? (
            <div className="empty-state" style={{ padding: '20px 10px' }}>
              No hearings or appointments scheduled for this date.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              {dayBookings.map((b) => {
                const matter = matters.find((m) => m.id === b.matter_id);
                const client = clients.find((c) => c.id === (b.client_id || matter?.client_id));
                return (
                  <div
                    key={b.id}
                    style={{
                      backgroundColor: 'var(--bg-app)',
                      border: '1px solid var(--card-brd)',
                      borderRadius: 10,
                      padding: '10px 12px',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          fontSize: '11px',
                          fontWeight: 700,
                          color: 'var(--accent)',
                          background: 'var(--accent-soft)',
                          padding: '2px 8px',
                          borderRadius: 999,
                        }}
                      >
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <circle cx="12" cy="12" r="10" />
                          <polyline points="12 6 12 12 16 14" />
                        </svg>
                        {formatTime(b.start_at)}
                      </span>
                      <span
                        style={{
                          fontSize: '10.5px',
                          fontWeight: 600,
                          textTransform: 'capitalize',
                          color: b.status === 'scheduled' ? 'var(--ok)' : 'var(--text-muted)',
                        }}
                      >
                        {b.status}
                      </span>
                    </div>

                    <div style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 3 }}>
                      {matter?.title || b.purpose || 'Scheduled Hearing'}
                    </div>

                    {matter?.matter_number && (
                      <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--accent-gold)', marginBottom: 4 }}>
                        {matter.matter_number} {matter.case_type ? `• ${matter.case_type}` : ''}
                      </div>
                    )}

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: '11.5px', color: 'var(--text-secondary)', marginTop: 4 }}>
                      {client && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
                            <circle cx="12" cy="7" r="4" />
                          </svg>
                          <span>Client: <strong style={{ color: 'var(--text-primary)' }}>{client.name}</strong></span>
                        </div>
                      )}
                      {(matter?.court_complex || matter?.court_name) && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <rect width="16" height="10" x="4" y="10" rx="1" />
                            <path d="M12 2L2 7h20L12 2z" />
                            <line x1="6" y1="10" x2="6" y2="20" />
                            <line x1="10" y1="10" x2="10" y2="20" />
                            <line x1="14" y1="10" x2="14" y2="20" />
                            <line x1="18" y1="10" x2="18" y2="20" />
                          </svg>
                          <span>{matter.court_complex || matter.court_name}</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
