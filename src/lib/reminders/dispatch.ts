/**
 * Hearing-reminder sender (SERVER-ONLY). Called every few minutes by the scheduler
 * through /api/cron/reminders.
 *
 * For every lawyer who has notifications enabled it finds hearings that are due for
 * a reminder, sends one push per (hearing, offset) exactly once, retries a failed
 * send up to 3 times, and records the outcome in `reminder_deliveries`.
 * Notification text carries the case number, court and time only - never party or
 * client names, because it can appear on a locked screen.
 */

if (typeof window !== 'undefined') {
  throw new Error('[reminders/dispatch] This module is SERVER-ONLY.');
}

import {
  DEFAULT_REMINDER_PREFERENCES,
  effectiveHearingStartMs,
  formatHearingIST,
  isReminderDue,
  reminderWhenPhrase,
} from '@/lib/reminders/engine';
import { sendPushToOwner } from '@/lib/push/server';
import { logServerError } from '@/lib/log/serverLog';

export interface DispatchSummary {
  subscribedOwners: number;
  checkedBookings: number;
  due: number;
  sent: number;
  failed: number;
  skipped: number;
}

const MAX_ATTEMPTS = 3;
const LOOKAHEAD_MS = 8 * 24 * 60 * 60 * 1000; // longest offset is 7 days
const LOOKBACK_MS = 6 * 60 * 60 * 1000; // legacy date-only hearings start 4.5h after their stored time

/** Take the right to send this reminder. False means someone already sent it (or gave up). */
async function claimDelivery(db: any, ownerId: string, bookingId: string, offset: number): Promise<boolean> {
  const nowIso = new Date().toISOString();
  const { error } = await db.from('reminder_deliveries').insert({
    owner_id: ownerId,
    booking_id: bookingId,
    offset_minutes: offset,
    channel: 'push',
    status: 'sending',
    attempt_count: 1,
    created_at: nowIso,
    updated_at: nowIso,
  });
  if (!error) return true;
  if (error.code !== '23505') throw new Error(`claim failed: ${error.message}`);

  // Already exists: only a previously FAILED delivery with attempts left may be retried.
  const { data: existing } = await db
    .from('reminder_deliveries')
    .select('id, status, attempt_count')
    .eq('booking_id', bookingId)
    .eq('offset_minutes', offset)
    .eq('channel', 'push')
    .maybeSingle();
  if (!existing || existing.status !== 'failed' || existing.attempt_count >= MAX_ATTEMPTS) return false;

  const { data: updated } = await db
    .from('reminder_deliveries')
    .update({ status: 'sending', attempt_count: existing.attempt_count + 1, updated_at: nowIso })
    .eq('id', existing.id)
    .eq('status', 'failed')
    .select('id');
  return Array.isArray(updated) && updated.length === 1;
}

async function finishDelivery(
  db: any,
  bookingId: string,
  offset: number,
  status: 'sent' | 'failed',
  devicesReached: number,
  errorSummary: string | null,
) {
  await db
    .from('reminder_deliveries')
    .update({
      status,
      devices_reached: devicesReached,
      error_summary: errorSummary ? errorSummary.slice(0, 200) : null,
      updated_at: new Date().toISOString(),
    })
    .eq('booking_id', bookingId)
    .eq('offset_minutes', offset)
    .eq('channel', 'push');
}

export async function runReminderDispatch(db: any, nowMs: number = Date.now()): Promise<DispatchSummary> {
  const summary: DispatchSummary = {
    subscribedOwners: 0,
    checkedBookings: 0,
    due: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
  };

  const { data: subRows, error: subError } = await db.from('push_subscriptions').select('owner_id');
  if (subError) throw new Error(`push_subscriptions query failed: ${subError.message}`);
  const owners: string[] = Array.from(new Set<string>((subRows || []).map((r: any) => r.owner_id as string)));
  summary.subscribedOwners = owners.length;

  if (owners.length > 0) {
    const { data: prefRows } = await db
      .from('reminder_preferences')
      .select('owner_id, offsets_minutes, in_app_enabled')
      .in('owner_id', owners);
    const prefsByOwner = new Map<string, { offsets: number[]; enabled: boolean }>();
    for (const p of prefRows || []) {
      const offsets = Array.isArray(p.offsets_minutes)
        ? p.offsets_minutes.filter((n: unknown) => typeof n === 'number' && Number.isFinite(n) && n > 0)
        : [];
      prefsByOwner.set(p.owner_id, {
        offsets: offsets.length > 0 ? offsets : DEFAULT_REMINDER_PREFERENCES.offsets_minutes,
        enabled: p.in_app_enabled !== false,
      });
    }

    const { data: bookings, error: bookingError } = await db
      .from('bookings')
      .select('id, owner_id, matter_id, start_at, status')
      .in('owner_id', owners)
      .eq('status', 'scheduled')
      .gte('start_at', new Date(nowMs - LOOKBACK_MS).toISOString())
      .lte('start_at', new Date(nowMs + LOOKAHEAD_MS).toISOString());
    if (bookingError) throw new Error(`bookings query failed: ${bookingError.message}`);

    const matterIds: string[] = Array.from(
      new Set<string>((bookings || []).map((b: any) => b.matter_id as string | null).filter((v: unknown): v is string => !!v)),
    );
    const matterById = new Map<string, { matter_number?: string; court_complex?: string; court_name?: string }>();
    if (matterIds.length > 0) {
      const { data: matters } = await db
        .from('matters')
        .select('id, matter_number, court_complex, court_name')
        .in('id', matterIds);
      for (const m of matters || []) matterById.set(m.id, m);
    }

    for (const booking of bookings || []) {
      summary.checkedBookings += 1;
      const prefs = prefsByOwner.get(booking.owner_id) ?? {
        offsets: DEFAULT_REMINDER_PREFERENCES.offsets_minutes,
        enabled: true,
      };
      if (!prefs.enabled) continue;

      const startMs = effectiveHearingStartMs(booking.start_at);

      for (const offset of prefs.offsets) {
        if (!isReminderDue(startMs, offset, nowMs)) continue;
        summary.due += 1;

        try {
          const claimed = await claimDelivery(db, booking.owner_id, booking.id, offset);
          if (!claimed) {
            summary.skipped += 1;
            continue;
          }

          const matter = booking.matter_id ? matterById.get(booking.matter_id) : undefined;
          const body = [
            matter?.matter_number || 'Court hearing',
            matter?.court_complex || matter?.court_name || '',
            formatHearingIST(startMs),
          ]
            .filter(Boolean)
            .join(' \u00b7 ');

          const result = await sendPushToOwner(db, booking.owner_id, {
            title: `Hearing ${reminderWhenPhrase(offset)}`,
            body,
            url: '/app',
            tag: `hearing-${booking.id}-${offset}`,
          });

          if (result.reached > 0) {
            summary.sent += 1;
            await finishDelivery(db, booking.id, offset, 'sent', result.reached, null);
          } else {
            summary.failed += 1;
            const reason = result.devices === 0 ? 'no devices' : `unreachable: ${result.errors.join(',') || 'removed'}`;
            await finishDelivery(db, booking.id, offset, 'failed', 0, reason);
          }
        } catch (err) {
          summary.failed += 1;
          await logServerError('reminders/dispatch', err, { bookingId: booking.id, offset });
          try {
            await finishDelivery(db, booking.id, offset, 'failed', 0, 'exception');
          } catch {}
        }
      }
    }
  }

  // Heartbeat: lets the developer dashboard notice if the scheduler ever stops.
  try {
    await db
      .from('app_heartbeats')
      .upsert({ name: 'reminder_dispatch', last_run_at: new Date(nowMs).toISOString(), detail: summary }, { onConflict: 'name' });
  } catch {}

  // Housekeeping: short invite links expire with their invite; drop them a week later.
  try {
    await db.from('short_links').delete().lt('expires_at', new Date(nowMs - 7 * 24 * 60 * 60 * 1000).toISOString());
  } catch {}

  return summary;
}
