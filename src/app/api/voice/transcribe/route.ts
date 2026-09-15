/**
 * POST /api/voice/transcribe
 *
 * Authenticated server route for Speech-to-Text using Sarvam AI (saaras:v2).
 * Accepts multipart/form-data with an audio file blob.
 *
 * SECURITY:
 *   - requireRealAppUser enforces authenticated non-demo lawyers.
 *   - Demo mode returns a capped mock response (max DEMO_MODE_MAX_CALLS checks left to client).
 *   - SARVAM_API_KEY is server-only; never returned in response or logged.
 *   - Audio content is never stored or logged server-side.
 *
 * Request (multipart/form-data):
 *   file          - audio blob (WAV or WEBM)
 *   language_code - BCP-47 code: 'te-IN' | 'hi-IN' | 'en-IN' | 'unknown' (default: 'unknown')
 *   mode          - 'codemix' | 'transcribe' | 'translate' | 'verbatim' (default: 'codemix')
 *
 * Response (JSON):
 *   { transcript: string; language_code?: string; provider: 'sarvam' | 'demo' }
 *   or error: { error: string; code: string }
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireRealAppUser } from '@/lib/auth/requestUser';
import { transcribeAudio, isSarvamConfigured } from '@/lib/sarvam';
import type { SarvamLanguageCode, SarvamSTTMode } from '@/lib/sarvam';

const ALLOWED_MODES: SarvamSTTMode[] = ['codemix', 'transcribe', 'translate', 'verbatim', 'translit'];
const ALLOWED_LANG_CODES = new Set([
  'te-IN', 'hi-IN', 'en-IN', 'kn-IN', 'ta-IN', 'ml-IN', 'mr-IN',
  'gu-IN', 'pa-IN', 'or-IN', 'bn-IN', 'ur-IN', 'unknown',
]);

export async function POST(request: NextRequest) {
  // ── Auth: allow real lawyers; block demo/anonymous users ──────────────────
  const user = await requireRealAppUser(request);
  if (!user) {
    return NextResponse.json(
      {
        error: 'Voice transcription is only available to approved advocates. Please sign in.',
        code: 'auth_error',
      },
      { status: 403 }
    );
  }

  // ── Parse multipart form ──────────────────────────────────────────────────
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: 'Invalid form data. Expected multipart/form-data with an audio file.', code: 'validation_error' },
      { status: 400 }
    );
  }

  const fileEntry = formData.get('file');
  if (!fileEntry || !(fileEntry instanceof Blob)) {
    return NextResponse.json(
      { error: 'No audio file provided. Include an "file" field in the form data.', code: 'validation_error' },
      { status: 400 }
    );
  }

  const rawLang = (formData.get('language_code') as string | null) ?? 'unknown';
  const languageCode: SarvamLanguageCode = ALLOWED_LANG_CODES.has(rawLang)
    ? (rawLang as SarvamLanguageCode)
    : 'unknown';

  const rawMode = (formData.get('mode') as string | null) ?? 'codemix';
  const mode: SarvamSTTMode = (ALLOWED_MODES as string[]).includes(rawMode)
    ? (rawMode as SarvamSTTMode)
    : 'codemix';

  // ── Key check with Demo Mode fallback ─────────────────────────────────────
  if (!isSarvamConfigured()) {
    const demoResult = await transcribeAudio({
      audioBlob: fileEntry,
      languageCode,
      mode,
      isDemoMode: true,
    });
    if (demoResult.ok) {
      return NextResponse.json({
        transcript: demoResult.data.transcript,
        language_code: demoResult.data.language_code ?? languageCode,
        provider: 'demo',
        warning:
          'Demo Mode: No SARVAM_API_KEY configured on this server. Add SARVAM_API_KEY to environment variables for live AI transcription.',
      });
    }

    return NextResponse.json(
      {
        error: 'SARVAM_API_KEY is not configured on this server. Add it to environment variables.',
        code: 'not_configured',
      },
      { status: 503 }
    );
  }

  // ── Call Sarvam STT ───────────────────────────────────────────────────────
  const result = await transcribeAudio({
    audioBlob: fileEntry,
    languageCode,
    mode,
    isDemoMode: false,
    timeoutMs: 40_000, // generous timeout for longer recordings
  });

  if (!result.ok) {
    const httpStatus =
      result.code === 'auth_error' ? 401
      : result.code === 'quota_exhausted' ? 402
      : result.code === 'rate_limited' ? 429
      : result.code === 'validation_error' ? 422
      : result.code === 'timeout' ? 504
      : 502;

    return NextResponse.json(
      { error: result.message, code: result.code },
      { status: httpStatus }
    );
  }

  return NextResponse.json({
    transcript: result.data.transcript,
    language_code: result.data.language_code ?? languageCode,
    provider: 'sarvam',
    request_id: result.requestId,
  });
}
