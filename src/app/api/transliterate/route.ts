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
 * Request (JSON):
 *   { text: string; source_lang: string; target_lang: string; numerals_format?: string }
 *
 * Response (JSON):
 *   { transliterated_text: string; provider: 'sarvam' | 'demo' }
 *   or error: { error: string; code: string }
 */

import { NextResponse } from 'next/server';
import { transliterateText, isSarvamConfigured } from '@/lib/sarvam';

export async function POST(request: Request) {
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

  if (!isSarvamConfigured()) {
    return NextResponse.json(
      {
        error: 'SARVAM_API_KEY is not configured. Add it to .env.local to enable Transliteration.',
        code: 'not_configured',
      },
      { status: 503 }
    );
  }

  const result = await transliterateText({
    text,
    sourceLang,
    targetLang,
    numeralsFormat,
    isDemoMode: false,
  });

  if (!result.ok) {
    const httpStatus =
      result.code === 'auth_error' ? 401
      : result.code === 'rate_limited' ? 429
      : result.code === 'validation_error' ? 422
      : 502;

    return NextResponse.json(
      { error: result.message, code: result.code },
      { status: httpStatus }
    );
  }

  return NextResponse.json({
    transliterated_text: result.data.transliterated_text,
    provider: 'sarvam',
    request_id: result.requestId,
  });
}
