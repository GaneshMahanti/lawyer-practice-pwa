import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { logServerError } from '@/lib/log/serverLog';

/**
 * GET /p/<code>  -  public short link for client onboarding.
 * Redirects to /portal/<token>. The portal page itself shows the proper
 * "expired / revoked / completed" screens, so this only needs to find the code.
 */

const NOT_FOUND_HTML =
  '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<body style="font-family:system-ui,sans-serif;padding:32px;text-align:center">' +
  '<h1 style="font-size:1.2rem">This link is not valid</h1>' +
  '<p>Please ask your advocate to send you a new link.</p></body>';

function notFound() {
  return new NextResponse(NOT_FOUND_HTML, {
    status: 404,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export async function GET(request: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  if (!/^[0-9A-Za-z]{8}$/.test(code)) return notFound();

  try {
    const db = createServiceClient() as any;
    const { data, error } = await db
      .from('short_links')
      .select('target_path')
      .eq('code', code)
      .maybeSingle();
    if (error) throw new Error(error.message);

    // Only ever redirect inside our own portal (no open redirect).
    if (!data?.target_path || !/^\/portal\/[a-f0-9]{64}$/.test(data.target_path)) return notFound();

    const response = NextResponse.redirect(new URL(data.target_path, request.url), 302);
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('Referrer-Policy', 'no-referrer');
    return response;
  } catch (err) {
    await logServerError('p/redirect', err);
    return notFound();
  }
}
