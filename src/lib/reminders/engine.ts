import type { Booking, Client, Reminder } from '@/lib/types/database';

export const REMINDER_OFFSET_OPTIONS = [
  { minutes: 15, label: '15 minutes before' },
  { minutes: 30, label: '30 minutes before' },
  { minutes: 60, label: '1 hour before' },
  { minutes: 120, label: '2 hours before' },
  { minutes: 1440, label: '1 day before' },
  { minutes: 2880, label: '2 days before' },
  { minutes: 10080, label: '1 week before' },
] as const;

export type ReminderPreferences = {
  offsets_minutes: number[];
  in_app_enabled: boolean;
};

export const DEFAULT_REMINDER_PREFERENCES: ReminderPreferences = {
  offsets_minutes: [1440, 120],
  in_app_enabled: true,
};

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
    const start = new Date(booking.start_at).getTime();
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
        status: new Date(scheduledFor).getTime() <= now ? 'sent' : 'pending',
        sent_at: new Date(scheduledFor).getTime() <= now ? scheduledFor : null,
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

export function canDispatchWhatsApp(isDemo: boolean, client: Client | undefined): boolean {
  return !isDemo && !!client && client.whatsapp_opt_in === true;
}
