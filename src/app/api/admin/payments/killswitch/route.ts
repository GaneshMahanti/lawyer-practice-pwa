/**
 * POST /api/admin/payments/killswitch   (DEVELOPER ONLY)
 *
 * Pause or resume ALL ai_wallets at once.
 * Body: { action: 'pause_all' | 'resume_all' }
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireDeveloperUser } from '@/lib/auth/requestUser';
import { createServiceClient } from '@/lib/supabase/service';
import { logServerError } from '@/lib/log/serverLog';

export async function POST(request: NextRequest) {
  const dev = await requireDeveloperUser(request);
  if (!dev) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  let body: Record<string, unknown>;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid request.' }, { status: 400 }); }

  const action = body.action;
  if (action !== 'pause_all' && action !== 'resume_all') {
    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  }

  const targetStatus = action === 'pause_all' ? 'paused' : 'active';

  const db = createServiceClient() as any;
  try {
    const { error } = await db
      .from('ai_wallets')
      .update({ status: targetStatus });
    if (error) throw error;
    return NextResponse.json({ ok: true, status: targetStatus });
  } catch (err) {
    await logServerError('api/admin/payments/killswitch', err, { action, developerId: dev.id });
    return NextResponse.json({ error: 'Could not update wallet status. Please try again.' }, { status: 500 });
  }
}
