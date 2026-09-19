/**
 * Web Push sender (SERVER-ONLY).
 *
 * Needs four environment variables (see .env.example):
 *   NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, CRON_SECRET
 * Generate the VAPID pair once with:  npx web-push generate-vapid-keys
 */

if (typeof window !== 'undefined') {
  throw new Error('[push/server] This module is SERVER-ONLY.');
}

import webpush from 'web-push';

export interface PushPayload {
  title: string;
  body: string;
  /** Path to open when the notification is tapped, e.g. '/app'. */
  url: string;
  /** Same tag replaces an earlier notification instead of stacking. */
  tag?: string;
}

export interface PushSendResult {
  devices: number;
  reached: number;
  failed: number;
  removed: number;
  /** Short status codes only, e.g. ['503', 'ERR']. Safe to log. */
  errors: string[];
}

export function isPushConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY &&
      process.env.VAPID_PRIVATE_KEY &&
      process.env.VAPID_SUBJECT,
  );
}

let vapidReady = false;

function ensureVapid() {
  if (vapidReady) return;
  if (!isPushConfigured()) throw new Error('Push is not configured: VAPID environment variables are missing.');
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT as string,
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY as string,
    process.env.VAPID_PRIVATE_KEY as string,
  );
  vapidReady = true;
}

/** Send one notification to every device the lawyer has enabled. Dead subscriptions (404/410) are removed. */
export async function sendPushToOwner(
  db: any,
  ownerId: string,
  payload: PushPayload,
): Promise<PushSendResult> {
  ensureVapid();

  const { data: subs, error } = await db
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('owner_id', ownerId);
  if (error) throw new Error(`push_subscriptions query failed: ${error.message}`);

  const result: PushSendResult = { devices: (subs || []).length, reached: 0, failed: 0, removed: 0, errors: [] };
  const body = JSON.stringify(payload);
  const nowIso = new Date().toISOString();

  for (const sub of subs || []) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        body,
        { TTL: 3 * 60 * 60, urgency: 'high' },
      );
      result.reached += 1;
      await db.from('push_subscriptions').update({ last_success_at: nowIso }).eq('id', sub.id);
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        // The phone/browser unsubscribed or the subscription expired.
        await db.from('push_subscriptions').delete().eq('id', sub.id);
        result.removed += 1;
      } else {
        result.failed += 1;
        result.errors.push(status ? String(status) : 'ERR');
        await db.from('push_subscriptions').update({ last_error_at: nowIso }).eq('id', sub.id);
      }
    }
  }

  return result;
}
