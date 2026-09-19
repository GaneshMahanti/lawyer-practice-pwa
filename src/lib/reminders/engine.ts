import type { Booking, Client, Reminder } from '@/lib/types/database';

export const REMINDER_OFFSET_OPTIONS = [
  { minutes: 60, label: '1 hour before' },
  { minutes: 120, label: '2 hours before' },
  { minutes: 1440, label: '1 day before' },
  { minutes: 2880, label: '2 days before' },
  { minutes: 7200, label: '5 days before' },
  { minutes: 10080, label: '1 week before' },
] as const;

export type ReminderPreferences = {
  offsets_minutes: number[];
  in_app_enabled: boolean;
};

// Smart default reminder schedule for court hearings:
//   1 week before → advance planning window
//   1 day before  → prep-day notice
//   1 hour before → final same-day nudge
export const DEFAULT_REMINDER_PREFERENCES: ReminderPreferences = {
  offsets_minutes: [10080, 1440, 60],
  in_app_enabled: true,
};

// ── Hearing time ─────────────────────────────────────────────────────────────

// Older hearings were saved from a date-only field, which produced exactly
// 00:00 UTC (= 05:30 IST). Reminders for those are scheduled against 10:00 IST
// (= 04:30 UTC) instead, so "1 hour before" is not 4:30 AM.
const LEGACY_DATE_ONLY_SHIFT_MS = (4 * 60 + 30) * 60 * 1000;

/** The moment a hearing really starts, for reminder purposes. NaN if the date is invalid. */
export function effectiveHearingStartMs(startAtIso: string): number {
  const t = new Date(startAtIso).getTime();
  if (!Number.isFinite(t)) return NaN;
  const d = new Date(t);
  const isLegacyDateOnly =
    d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0;
  return isLegacyDateOnly ? t + LEGACY_DATE_ONLY_SHIFT_MS : t;
}

// ── Due-time rules (used by the server sender) ───────────────────────────────

/** How late a reminder may still be sent (covers a delayed scheduler run). */
export function reminderGraceMs(offsetMinutes: number): number {
  return offsetMinutes >= 1440 ? 3 * 60 * 60 * 1000 : 45 * 60 * 1000;
}

/** True when this reminder should be sent now: its time has come, the grace window is open, and the hearing has not started. */
export function isReminderDue(startMs: number, offsetMinutes: number, nowMs: number): boolean {
  if (!Number.isFinite(startMs) || nowMs >= startMs) return false;
  const scheduledMs = startMs - offsetMinutes * 60 * 1000;
  return scheduledMs <= nowMs && nowMs - scheduledMs <= reminderGraceMs(offsetMinutes);
}

// ── Message wording (shared by push and in-app) ──────────────────────────────

export function reminderWhenPhrase(offsetMinutes: number): string {
  if (offsetMinutes <= 15) return 'in 15 minutes';
  if (offsetMinutes <= 30) return 'in 30 minutes';
  if (offsetMinutes <= 60) return 'in 1 hour';
  if (offsetMinutes <= 120) return 'in 2 hours';
  if (offsetMinutes <= 1440) return 'tomorrow';
  if (offsetMinutes <= 2880) return 'in 2 days';
  if (offsetMinutes <= 7200) return 'in 5 days';
  return 'in 1 week';
}

export function formatHearingIST(ms: number): string {
  const d = new Date(ms);
  const date = d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' });
  const time = d
    .toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true })
    .toUpperCase();
  return `${date}, ${time}`;
}

// ── In-app reminders (banner on the home screen) ─────────────────────────────

export function buildInAppReminders(
  ownerId: string,
  bookings: Booking[],
  preferences: ReminderPreferences,
): Reminder[] {
  if (!preferences.in_app_enabled) return [];
  const now = Date.now();
  const reminders: Reminder[] = [];

  for (const booking of bookings) {
    if (booking.status !== 'scheduled') continue;
    const start = effectiveHearingStartMs(booking.start_at);
    if (!Number.isFinite(start) || start <= now) continue;

    for (const offset of preferences.offsets_minutes) {
      const scheduledFor = new Date(start - offset * 60 * 1000).toISOString();
      const idempotency_key = `in_app:${booking.id}:${offset}`;
      reminders.push({
        id: idempotency_key,
        owner_id: ownerId,
        booking_id: booking.id,
        matter_id: booking.matter_id,
        channel: 'in_app',
        scheduled_for: scheduledFor,
        // Whether a reminder is "due" is decided at display time (getDueInAppReminders),
        // never frozen here - otherwise a reminder whose time passes while the app is
        // closed would be hidden forever.
        status: 'pending',
        sent_at: null,
        attempt_count: 0,
        last_error: null,
        provider_message_id: null,
        template_name: 'hearing_reminder',
        template_language: 'en',
        idempotency_key,
        created_at: new Date().toISOString(),
      });
    }
  }

  return reminders;
}

/**
 * Reminders to show right now: their time has come and the hearing has not started.
 * At most one per hearing (the most recent one), and nothing the user dismissed.
 */
export function getDueInAppReminders(
  reminders: Reminder[],
  bookings: Booking[],
  nowMs: number,
  dismissedIds: Set<string>,
): Reminder[] {
  const startByBooking = new Map<string, number>();
  for (const b of bookings) {
    if (b.status === 'scheduled') startByBooking.set(b.id, effectiveHearingStartMs(b.start_at));
  }

  const latestByBooking = new Map<string, Reminder>();
  for (const r of reminders) {
    if (r.channel !== 'in_app' || !r.booking_id) continue;
    const start = startByBooking.get(r.booking_id);
    if (start === undefined || !Number.isFinite(start) || nowMs >= start) continue;
    const at = new Date(r.scheduled_for).getTime();
    if (!Number.isFinite(at) || at > nowMs) continue;
    const current = latestByBooking.get(r.booking_id);
    if (!current || at > new Date(current.scheduled_for).getTime()) {
      latestByBooking.set(r.booking_id, r);
    }
  }

  return Array.from(latestByBooking.values())
    .filter((r) => !dismissedIds.has(r.id))
    .sort((a, b) => {
      const sa = startByBooking.get(a.booking_id || '') ?? 0;
      const sb = startByBooking.get(b.booking_id || '') ?? 0;
      return sa - sb;
    });
}

// ── Dismissed banner reminders survive reloads ───────────────────────────────

const DISMISSED_KEY = 'vakildesk_dismissed_reminders';

export function loadDismissedReminderIds(): Set<string> {
  try {
    if (typeof window === 'undefined') return new Set();
    const raw = window.localStorage.getItem(DISMISSED_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []);
  } catch {
    return new Set();
  }
}

export function saveDismissedReminderIds(ids: Set<string>): void {
  try {
    if (typeof window === 'undefined') return;
    // Keep the newest 500 so the list cannot grow forever
    window.localStorage.setItem(DISMISSED_KEY, JSON.stringify(Array.from(ids).slice(-500)));
  } catch {}
}

export function canDispatchWhatsApp(isDemo: boolean, client: Client | undefined): boolean {
  return !isDemo && !!client && client.whatsapp_opt_in === true;
}
