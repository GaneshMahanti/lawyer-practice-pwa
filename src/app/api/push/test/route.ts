import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireRealAppUser } from '@/lib/auth/requestUser';
import { createServiceClient } from '@/lib/supabase/service';
import { isPushConfigured, sendPushToOwner } from '@/lib/push/server';
import { logServerError } from '@/lib/log/serverLog';

/**
 * POST /api/push/test  -  send a test notification to the signed-in lawyer's own devices.
 * Users see one short message on failure; the real error goes to the server log.
 */

const NOTIF_ERROR = 'Error for notification';

export async function POST(request: NextRequest) {
  const user = await requireRealAppUser(request);
  if (!user) return NextResponse.json({ error: NOTIF_ERROR }, { status: 403 });

  if (!isPushConfigured()) {
    await logServerError('api/push/test', new Error('VAPID environment variables are not configured'), {
      userId: user.id,
    });
    return NextResponse.json({ error: NOTIF_ERROR }, { status: 503 });
  }

  try {
    const db = createServiceClient() as any;
    const result = await sendPushToOwner(db, user.id, {
      title: 'VakilDesk test',
      body: 'Hearing notifications are working on this device.',
      url: '/app/settings',
      tag: 'vakildesk-test',
    });

    if (result.reached === 0) {
      await logServerError('api/push/test', new Error('Test push reached no device'), {
        userId: user.id,
        devices: result.devices,
        failed: result.failed,
        removed: result.removed,
        errors: result.errors,
      });
      return NextResponse.json({ error: NOTIF_ERROR }, { status: 502 });
    }

    return NextResponse.json({ ok: true, devices: result.reached });
  } catch (err) {
    await logServerError('api/push/test', err, { userId: user.id });
    return NextResponse.json({ error: NOTIF_ERROR }, { status: 500 });
  }
}
