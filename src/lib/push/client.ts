/**
 * Browser-side helpers for hearing notifications (Web Push).
 * Users only ever see the short message "Error for notification"; the real reason
 * is sent to the server log through /api/push/log.
 */

export type PushState =
  | 'loading'
  | 'unsupported' // browser cannot do push
  | 'needs-install' // iPhone/iPad: only works from the Home Screen app
  | 'unconfigured' // server VAPID key missing
  | 'blocked' // user denied permission
  | 'off' // can be turned on
  | 'on'; // this device is subscribed

export const NOTIFICATION_ERROR_TEXT = 'Error for notification';

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '';

function isIos(): boolean {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (ua.includes('Mac') && navigator.maxTouchPoints > 1);
}

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

/** Fire-and-forget: put the real error in the server log. */
export function reportPushError(stage: string, err: unknown): void {
  try {
    const message = err instanceof Error ? err.message : String(err);
    void fetch('/api/push/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage, message }),
    }).catch(() => {});
  } catch {}
}

export async function getPushState(): Promise<PushState> {
  if (typeof window === 'undefined') return 'loading';
  if (isIos() && !isStandalone()) return 'needs-install';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return 'unsupported';
  }
  if (!VAPID_PUBLIC_KEY) return 'unconfigured';
  if (Notification.permission === 'denied') return 'blocked';
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    return sub && Notification.permission === 'granted' ? 'on' : 'off';
  } catch (err) {
    reportPushError('state', err);
    return 'off';
  }
}

/** Ask permission, subscribe this device, and save the subscription on the server. Returns the new state. */
export async function enablePush(): Promise<PushState> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'blocked' : 'off';

  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  }

  const res = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscription: sub.toJSON() }),
  });
  if (!res.ok) throw new Error(`subscribe request failed (HTTP ${res.status})`);
  return 'on';
}

export async function disablePush(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  if (!sub) return;
  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  const res = await fetch('/api/push/subscribe', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint }),
  });
  if (!res.ok) throw new Error(`unsubscribe request failed (HTTP ${res.status})`);
}

/** Sends a test notification to the signed-in lawyer's own devices. */
export async function sendTestPush(): Promise<boolean> {
  const res = await fetch('/api/push/test', { method: 'POST' });
  return res.ok;
}
