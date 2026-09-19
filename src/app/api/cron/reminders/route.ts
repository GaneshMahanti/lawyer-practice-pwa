import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { createServiceClient } from '@/lib/supabase/service';
import { isPushConfigured } from '@/lib/push/server';
import { runReminderDispatch } from '@/lib/reminders/dispatch';
import { logServerError } from '@/lib/log/serverLog';

/**
 * GET/POST /api/cron/reminders  -  sends due hearing reminders.
 *
 * Called every ~5 minutes by the scheduler (Supabase pg_cron or any HTTP pinger).
 * Protected by a shared secret: send the header  Authorization: Bearer <CRON_SECRET>.
 * Nobody without the secret can trigger it.
 */

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const provided = Buffer.from(request.headers.get('authorization') || '');
  const expected = Buffer.from(`Bearer ${secret}`);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

async function handle(request: NextRequest) {
  if (!process.env.CRON_SECRET) {
    await logServerError('cron/reminders', new Error('CRON_SECRET is not set'));
    return NextResponse.json({ error: 'Not configured' }, { status: 503 });
  }
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isPushConfigured()) {
    await logServerError('cron/reminders', new Error('VAPID environment variables are not configured'));
    return NextResponse.json({ error: 'Not configured' }, { status: 503 });
  }

  let db;
  try {
    db = createServiceClient() as any;
  } catch (err) {
    await logServerError('cron/reminders', err);
    return NextResponse.json({ error: 'Not configured' }, { status: 503 });
  }

  try {
    const summary = await runReminderDispatch(db);
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    await logServerError('cron/reminders', err);
    return NextResponse.json({ error: 'Dispatch failed' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
