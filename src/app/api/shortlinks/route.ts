import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createHash, randomBytes } from 'crypto';
import { requireRealAppUser } from '@/lib/auth/requestUser';
import { createServiceClient } from '@/lib/supabase/service';
import { logServerError } from '@/lib/log/serverLog';

/**
 * POST /api/shortlinks   body: { token: string }
 *
 * Turns a client-onboarding link  /portal/<64-hex token>  into a short code, so the
 * WhatsApp message carries  https://<your-domain>/p/<8 chars>  instead of ~110 characters.
 * The redirect itself lives in /p/[code]. Self-hosted on purpose: a third-party shortener
 * would see the onboarding token.
 *
 * Only the lawyer who owns a still-open invite can create a short link for it.
 * Asking twice for the same invite returns the same code.
 */

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const CODE_LENGTH = 8;

/** Random base62 code without modulo bias (248 = 62 * 4). */
function newCode(): string {
  let out = '';
  while (out.length < CODE_LENGTH) {
    for (const byte of randomBytes(CODE_LENGTH * 2)) {
      if (byte < 248 && out.length < CODE_LENGTH) out += ALPHABET[byte % 62];
    }
  }
  return out;
}

export async function POST(request: NextRequest) {
  const user = await requireRealAppUser(request);
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });

  let token = '';
  try {
    const body = await request.json();
    token = typeof body?.token === 'string' ? body.token : '';
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
  // Exact format the invite API issues; this also makes path injection impossible.
  if (!/^[a-f0-9]{64}$/.test(token)) {
    return NextResponse.json({ error: 'Invalid link' }, { status: 400 });
  }

  try {
    const db = createServiceClient() as any;

    // The caller must own an invite that is still open.
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const { data: invite, error: inviteError } = await db
      .from('portal_invites')
      .select('id, status, expires_at, revoked_at')
      .eq('token_hash', tokenHash)
      .eq('owner_id', user.id)
      .maybeSingle();
    if (inviteError) throw new Error(inviteError.message);
    if (!invite) return NextResponse.json({ error: 'Invite not found' }, { status: 404 });
    if (
      invite.revoked_at ||
      invite.status === 'revoked' ||
      invite.status === 'expired' ||
      invite.status === 'completed' ||
      new Date(invite.expires_at).getTime() < Date.now()
    ) {
      return NextResponse.json({ error: 'Invite is no longer active' }, { status: 410 });
    }

    const targetPath = `/portal/${token}`;

    const { data: existing } = await db
      .from('short_links')
      .select('code')
      .eq('target_path', targetPath)
      .maybeSingle();
    if (existing?.code) return NextResponse.json({ code: existing.code });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = newCode();
      const { error } = await db.from('short_links').insert({
        code,
        target_path: targetPath,
        owner_id: user.id,
        expires_at: invite.expires_at,
      });
      if (!error) return NextResponse.json({ code });
      if (error.code !== '23505') throw new Error(error.message);

      // Unique violation: either the code collided (retry) or another request just created this link.
      const { data: raced } = await db
        .from('short_links')
        .select('code')
        .eq('target_path', targetPath)
        .maybeSingle();
      if (raced?.code) return NextResponse.json({ code: raced.code });
    }
    throw new Error('Could not allocate a unique short code');
  } catch (err) {
    await logServerError('api/shortlinks', err, { userId: user.id });
    return NextResponse.json({ error: 'Could not create the short link' }, { status: 500 });
  }
}
