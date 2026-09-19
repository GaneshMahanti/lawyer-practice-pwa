import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireRealAppUser } from '@/lib/auth/requestUser';
import { logServerError } from '@/lib/log/serverLog';

/**
 * POST /api/push/log  -  lets the browser report a notification error so the real
 * detail lands in the server log while the user only sees a short message.
 * Body: { stage: string, message: string }. Both are truncated; never send personal data.
 */
export async function POST(request: NextRequest) {
  const user = await requireRealAppUser(request);
  if (!user) return NextResponse.json({ ok: false }, { status: 403 });

  try {
    const body = await request.json();
    const stage = typeof body?.stage === 'string' ? body.stage.slice(0, 40) : 'unknown';
    const message = typeof body?.message === 'string' ? body.message.slice(0, 300) : 'unknown error';
    await logServerError('push/client', new Error(message), {
      stage,
      userId: user.id,
      userAgent: (request.headers.get('user-agent') || '').slice(0, 200),
    });
  } catch {
    // Ignore malformed reports.
  }
  return NextResponse.json({ ok: true });
}
