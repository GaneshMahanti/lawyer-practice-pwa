import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireDeveloperUser } from '@/lib/auth/requestUser';
import { createServiceClient } from '@/lib/supabase/service';
import { logServerError } from '@/lib/log/serverLog';

/**
 * POST /api/admin/sarvam-balance   (DEVELOPER ONLY)   body: { balanceRupees, note? }
 *
 * Records the credit balance the developer reads from the Sarvam dashboard (Billing page).
 * Sarvam has no documented balance API, so the app shows this number minus the AI usage it
 * has metered since. Record a fresh number after every top-up on Sarvam.
 */
export async function POST(request: NextRequest) {
  const dev = await requireDeveloperUser(request);
  if (!dev) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  const rupees = Number(body.balanceRupees);
  if (!Number.isFinite(rupees) || rupees < 0 || rupees > 1_000_000) {
    return NextResponse.json({ error: 'Enter the balance shown on the Sarvam dashboard.' }, { status: 400 });
  }
  const note = typeof body.note === 'string' && body.note.trim()
    ? body.note.trim().slice(0, 200)
    : 'Entered from the Sarvam dashboard';

  try {
    const db = createServiceClient() as any;
    const { error } = await db.from('sarvam_balance_snapshots').insert({
      balance_paise: Math.round(rupees * 100),
      note,
      recorded_by: dev.id,
    });
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (err) {
    await logServerError('api/admin/sarvam-balance', err, { developerId: dev.id });
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
  }
}
