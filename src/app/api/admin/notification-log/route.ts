import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireDeveloperUser } from '@/lib/auth/requestUser';
import { createServiceClient } from '@/lib/supabase/service';

/**
 * GET /api/admin/notification-log  -  developer only.
 * Scheduler heartbeat, recent reminder deliveries and recent server errors.
 */
export async function GET(request: NextRequest) {
  const dev = await requireDeveloperUser(request);
  if (!dev) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  let db;
  try {
    db = createServiceClient() as any;
  } catch {
    return NextResponse.json({ error: 'Service key not configured on server.' }, { status: 503 });
  }

  const [heartbeat, deliveries, errors, subs] = await Promise.all([
    db.from('app_heartbeats').select('last_run_at, detail').eq('name', 'reminder_dispatch').maybeSingle(),
    db
      .from('reminder_deliveries')
      .select('id, owner_id, booking_id, offset_minutes, status, attempt_count, devices_reached, error_summary, updated_at')
      .order('updated_at', { ascending: false })
      .limit(30),
    db.from('error_logs').select('id, created_at, scope, message').order('created_at', { ascending: false }).limit(30),
    db.from('push_subscriptions').select('id', { count: 'exact', head: true }),
  ]);

  // Tables missing (migration not run yet) show up as errors here.
  const setupMissing = Boolean(heartbeat.error || deliveries.error || errors.error || subs.error);

  return NextResponse.json({
    setupMissing,
    heartbeat: heartbeat.data || null,
    deliveries: deliveries.data || [],
    errors: errors.data || [],
    deviceCount: subs.count ?? 0,
  });
}
