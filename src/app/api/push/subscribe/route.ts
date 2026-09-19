import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireRealAppUser } from '@/lib/auth/requestUser';
import { createServiceClient } from '@/lib/supabase/service';
import { logServerError } from '@/lib/log/serverLog';

/**
 * POST   /api/push/subscribe   save this device's push subscription
 * DELETE /api/push/subscribe   remove it (turn notifications off)
 *
 * Approved advocates only (demo sessions are rejected). Users see one short
 * message on failure; the real error goes to the server log.
 */

const NOTIF_ERROR = 'Error for notification';

function isValidSubscription(sub: any): sub is { endpoint: string; keys: { p256dh: string; auth: string } } {
  return (
    sub &&
    typeof sub.endpoint === 'string' &&
    sub.endpoint.startsWith('https://') &&
    sub.endpoint.length <= 2000 &&
    sub.keys &&
    typeof sub.keys.p256dh === 'string' &&
    sub.keys.p256dh.length > 0 &&
    sub.keys.p256dh.length <= 200 &&
    typeof sub.keys.auth === 'string' &&
    sub.keys.auth.length > 0 &&
    sub.keys.auth.length <= 100
  );
}

export async function POST(request: NextRequest) {
  const user = await requireRealAppUser(request);
  if (!user) return NextResponse.json({ error: NOTIF_ERROR }, { status: 403 });

  let body: { subscription?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: NOTIF_ERROR }, { status: 400 });
  }
  if (!isValidSubscription(body.subscription)) {
    return NextResponse.json({ error: NOTIF_ERROR }, { status: 400 });
  }
  const sub = body.subscription;

  try {
    const db = createServiceClient() as any;
    // One row per device (endpoint). If this device was used by another login before, it moves to this one.
    const { error } = await db.from('push_subscriptions').upsert(
      {
        owner_id: user.id,
        endpoint: sub.endpoint,
        p256dh: sub.keys.p256dh,
        auth: sub.keys.auth,
        user_agent: (request.headers.get('user-agent') || '').slice(0, 300),
        last_error_at: null,
      },
      { onConflict: 'endpoint' },
    );
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (err) {
    await logServerError('api/push/subscribe', err, { userId: user.id });
    return NextResponse.json({ error: NOTIF_ERROR }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const user = await requireRealAppUser(request);
  if (!user) return NextResponse.json({ error: NOTIF_ERROR }, { status: 403 });

  let endpoint = '';
  try {
    const body = await request.json();
    endpoint = typeof body?.endpoint === 'string' ? body.endpoint : '';
  } catch {
    return NextResponse.json({ error: NOTIF_ERROR }, { status: 400 });
  }
  if (!endpoint) return NextResponse.json({ error: NOTIF_ERROR }, { status: 400 });

  try {
    const db = createServiceClient() as any;
    const { error } = await db
      .from('push_subscriptions')
      .delete()
      .eq('owner_id', user.id)
      .eq('endpoint', endpoint);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (err) {
    await logServerError('api/push/subscribe', err, { userId: user.id, action: 'delete' });
    return NextResponse.json({ error: NOTIF_ERROR }, { status: 500 });
  }
}
