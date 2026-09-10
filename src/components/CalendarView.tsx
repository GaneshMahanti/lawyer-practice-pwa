'use client';

import React, { useEffect, useState } from 'react';
import { loadBookings } from '@/lib/data/repository';
import type { Booking } from '@/lib/types/database';

type ViewMode = 'week' | 'month';

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

export function CalendarView() {
  const today = new Date();
  const [viewMode, setViewMode] = useState<ViewMode>('week');
  const [calMonth, setCalMonth] = useState(
    new Date(today.getFullYear(), today.getMonth(), 1),
  );
  const [bookings, setBookings] = useState<Booking[]>([]);

  useEffect(() => {
    const refresh = () => setBookings(loadBookings().filter((booking) => booking.status === 'scheduled'));
    refresh();
    window.addEventListener('vakildesk-bookings-update', refresh);
    window.addEventListener('vakildesk-matters-update', refresh);
    window.addEventListener('vakildesk-workspace-ready', refresh);
    return () => {
      window.removeEventListener('vakildesk-bookings-update', refresh);
      window.removeEventListener('vakildesk-matters-update', refresh);
      window.removeEventListener('vakildesk-workspace-ready', refresh);
    };
  }, []);

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
        </div>
      </div>

      {viewMode === 'week' ? (
        /* ── WEEK VIEW ── */
        <div className="week-strip">
          {weekDays.map((d, i) => {
            const isToday = isSameDay(d, today);
            return (
              <div key={i} className={`week-day-col ${isToday ? 'is-today' : ''}`}>
                <span className="week-day-name">{WEEK_LABELS[i]}</span>
                <span className="week-day-num">{d.getDate()}</span>
                <span className="week-day-dot">{hearingCount(d) ? '•' : '–'}</span>
              </div>
            );
          })}
        </div>
      ) : (
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
      )}
    </div>
  );
}
