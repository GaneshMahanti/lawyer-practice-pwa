/**
 * POST /api/admin/payments/topup   (DEVELOPER ONLY)
 *
 * Records that the developer added money to Sarvam.
 * Body: { amountRupees: number }
 * Writes to sarvam_topups. Developer should then update the Sarvam balance snapshot.
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

  const rupees = Number(body.amountRupees);
  if (!Number.isFinite(rupees) || rupees <= 0) {
    return NextResponse.json({ error: 'Enter the amount you added to Sarvam (must be greater than zero).' }, { status: 400 });
  }

  const db = createServiceClient() as any;
  try {
    const { error } = await db
      .from('sarvam_topups')
      .insert({ amount_paise: Math.round(rupees * 100), note: `Recorded by developer on ${new Date().toISOString()}` });
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err) {
    await logServerError('api/admin/payments/topup', err, { developerId: dev.id });
    return NextResponse.json({ error: 'Could not record top-up. Please try again.' }, { status: 500 });
  }
}
