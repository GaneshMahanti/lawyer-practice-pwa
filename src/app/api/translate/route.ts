import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireWorkspaceUser } from '@/lib/auth/requestUser';
import { isAnonymousUser } from '@/lib/supabase/auth';
import { translateText, isSarvamConfigured } from '@/lib/sarvam';
import { createServiceClient } from '@/lib/supabase/service';
import { logServerError } from '@/lib/log/serverLog';

/**
 * POST /api/translate  -  Telugu / Hindi / English translation (Sarvam AI).
 *
 * ACCESS
 *   - Requires a signed-in session. Anonymous internet traffic is rejected (401):
 *     every call spends Sarvam credits.
 *   - Demo sessions get a fixed sample translation and NEVER reach a paid provider.
 *   - Approved advocates use Sarvam (sarvam-translate:v1, formal register).
 *   - There is no OpenAI fallback: all AI spend goes through Sarvam so it can be
 *     metered per lawyer.
 *
 * ERRORS
 *   Users see one short, plain message. The real error (code, HTTP status, sizes)
 *   is written to the server log via logServerError. Document text is never logged.
 *
 * Response contract (unchanged so all callers keep working):
 *   { success: true; translatedText: string; translated_text: string; provider: string }
 *   or { error: string; provider?: string }
 */

const MSG_SIGN_IN = 'Please sign in to use translation.';
const MSG_UNAVAILABLE = 'Translation is unavailable right now. Please try again later.';
const MSG_BUSY = 'Too many requests. Please wait a moment and try again.';
const MSG_INVALID = 'This text could not be translated. Please check its length and language, then try again.';
const MSG_FAILED = 'Translation failed. Please try again.';

export async function POST(request: NextRequest) {
  const user = await requireWorkspaceUser(request);
  if (!user) {
    return NextResponse.json({ error: MSG_SIGN_IN }, { status: 401 });
  }
  const isDemo = isAnonymousUser(user);

  // AI feature flag check (real lawyers only)
  if (!isDemo && user.app_metadata?.role === 'lawyer' && user.email) {
    try {
      const service = createServiceClient() as any;
      const { data: flags } = await service
        .from('approved_users')
        .select('ai_enabled')
        .eq('email', user.email.toLowerCase())
        .maybeSingle();
      if (flags && flags.ai_enabled === false) {
        return NextResponse.json({ error: 'AI features are not enabled for your account.' }, { status: 403 });
      }
    } catch { /* fail open */ }
  }

  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const sourceText =
    typeof body.text === 'string' ? body.text
    : typeof body.teluguText === 'string' ? body.teluguText
    : '';
  const sourceLang = typeof body.source_lang === 'string' ? body.source_lang : 'te';
  const targetLang = typeof body.target_lang === 'string' ? body.target_lang : 'en';

  if (!sourceText.trim()) {
    return NextResponse.json({ error: 'Text is required for translation.' }, { status: 400 });
  }

  const trimmed = sourceText.trim();

  // ── Demo sessions: fixed sample output, no provider call ─────────────────
  if (isDemo) {
    const demoResult = await translateText({
      text: trimmed,
      sourceLang,
      targetLang,
      mode: 'formal',
      isDemoMode: true,
    });
    if (demoResult.ok) {
      const translation = demoResult.data.translated_text;
      return NextResponse.json({
        success: true,
        translatedText: translation,
        translated_text: translation,
        provider: 'demo',
        warning: 'Demo Mode: sample translation only. Sign in with an approved advocate account for live AI translation.',
      });
    }
    return NextResponse.json({ error: MSG_UNAVAILABLE, provider: 'demo' }, { status: 503 });
  }

  // ── Approved advocates: Sarvam ────────────────────────────────────────────
  if (!isSarvamConfigured()) {
    await logServerError('api/translate', new Error('SARVAM_API_KEY is not configured on this server'), {
      userId: user.id,
    });
    return NextResponse.json({ error: MSG_UNAVAILABLE, provider: 'none' }, { status: 503 });
  }

  const result = await translateText({
    text: trimmed,
    sourceLang,
    targetLang,
    mode: 'formal', // Legal text always uses formal register
    isDemoMode: false,
  });

  if (result.ok) {
    const translation = result.data.translated_text;
    return NextResponse.json({
      success: true,
      translatedText: translation,
      translated_text: translation,
      provider: 'sarvam',
    });
  }

  // Failure: full detail to the server log, one simple message to the user.
  await logServerError('api/translate', new Error(result.message), {
    code: result.code,
    httpStatus: result.httpStatus,
    userId: user.id,
    sourceLang,
    targetLang,
    chars: trimmed.length,
  });

  if (result.code === 'rate_limited') {
    return NextResponse.json({ error: MSG_BUSY, provider: 'sarvam' }, { status: 429 });
  }
  if (result.code === 'validation_error') {
    return NextResponse.json({ error: MSG_INVALID, provider: 'sarvam' }, { status: 422 });
  }
  if (
    result.code === 'auth_error' ||
    result.code === 'quota_exhausted' ||
    result.code === 'not_configured'
  ) {
    return NextResponse.json({ error: MSG_UNAVAILABLE, provider: 'sarvam' }, { status: 503 });
  }
  return NextResponse.json({ error: MSG_FAILED, provider: 'sarvam' }, { status: 502 });
}
