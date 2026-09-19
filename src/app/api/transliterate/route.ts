/**
 * POST /api/transliterate
 *
 * Server route for script conversion (transliteration) using Sarvam AI.
 * Converts text between Indian scripts and Latin phonetic script.
 *
 * Examples:
 *   Telugu script  → Roman phonetic  (te-IN → en-IN)
 *   Roman phonetic → Telugu script   (en-IN → te-IN)
 *   Hindi Devanagari ↔ Roman         (hi-IN ↔ en-IN)
 *
 * This is distinct from /api/translate — transliteration changes the script
 * but preserves the original phonetics. Translation changes the language/meaning.
 *
 * ACCESS
 *   - Requires a signed-in session (every call spends Sarvam credits).
 *   - Demo sessions get a fixed sample and never reach Sarvam.
 *   - Approved advocates use Sarvam.
 *
 * ERRORS
 *   Users see one short message; the real error goes to the server log.
 *
 * Request (JSON):
 *   { text: string; source_lang: string; target_lang: string; numerals_format?: string }
 *
 * Response (JSON):
 *   { transliterated_text: string; provider: 'sarvam' | 'demo' }
 *   or error: { error: string; code?: string }
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireWorkspaceUser } from '@/lib/auth/requestUser';
import { isAnonymousUser } from '@/lib/supabase/auth';
import { transliterateText, isSarvamConfigured } from '@/lib/sarvam';
import { logServerError } from '@/lib/log/serverLog';

const MSG_SIGN_IN = 'Please sign in to use script conversion.';
const MSG_UNAVAILABLE = 'Script conversion is unavailable right now. Please try again later.';
const MSG_BUSY = 'Too many requests. Please wait a moment and try again.';
const MSG_INVALID = 'This text could not be converted. Please check its length and language, then try again.';
const MSG_FAILED = 'Script conversion failed. Please try again.';

export async function POST(request: NextRequest) {
  const user = await requireWorkspaceUser(request);
  if (!user) {
    return NextResponse.json({ error: MSG_SIGN_IN }, { status: 401 });
  }
  const isDemo = isAnonymousUser(user);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid request body. Expected JSON with text, source_lang, target_lang.' },
      { status: 400 }
    );
  }

  const text = typeof body.text === 'string' ? body.text.trim() : '';
  const sourceLang = typeof body.source_lang === 'string' ? body.source_lang : 'te-IN';
  const targetLang = typeof body.target_lang === 'string' ? body.target_lang : 'en-IN';
  const numeralsFormat = body.numerals_format === 'native' ? 'native' : 'international';

  if (!text) {
    return NextResponse.json(
      { error: 'Text is required for transliteration.' },
      { status: 400 }
    );
  }

  // ── Demo sessions: fixed sample output, no provider call ─────────────────
  if (isDemo) {
    const demoResult = await transliterateText({
      text,
      sourceLang,
      targetLang,
      numeralsFormat,
      isDemoMode: true,
    });
    if (demoResult.ok) {
      return NextResponse.json({
        transliterated_text: demoResult.data.transliterated_text,
        provider: 'demo',
        warning: 'Demo Mode: sample output only. Sign in with an approved advocate account for live conversion.',
      });
    }
    return NextResponse.json({ error: MSG_UNAVAILABLE, code: 'demo_mode' }, { status: 503 });
  }

  // ── Approved advocates: Sarvam ────────────────────────────────────────────
  if (!isSarvamConfigured()) {
    logServerError('api/transliterate', new Error('SARVAM_API_KEY is not configured on this server'), {
      userId: user.id,
    });
    return NextResponse.json({ error: MSG_UNAVAILABLE, code: 'not_configured' }, { status: 503 });
  }

  const result = await transliterateText({
    text,
    sourceLang,
    targetLang,
    numeralsFormat,
    isDemoMode: false,
  });

  if (result.ok) {
    return NextResponse.json({
      transliterated_text: result.data.transliterated_text,
      provider: 'sarvam',
      request_id: result.requestId,
    });
  }

  logServerError('api/transliterate', new Error(result.message), {
    code: result.code,
    httpStatus: result.httpStatus,
    userId: user.id,
    sourceLang,
    targetLang,
    chars: text.length,
  });

  if (result.code === 'rate_limited') {
    return NextResponse.json({ error: MSG_BUSY, code: result.code }, { status: 429 });
  }
  if (result.code === 'validation_error') {
    return NextResponse.json({ error: MSG_INVALID, code: result.code }, { status: 422 });
  }
  if (
    result.code === 'auth_error' ||
    result.code === 'quota_exhausted' ||
    result.code === 'not_configured'
  ) {
    return NextResponse.json({ error: MSG_UNAVAILABLE, code: result.code }, { status: 503 });
  }
  return NextResponse.json({ error: MSG_FAILED, code: result.code }, { status: 502 });
}
