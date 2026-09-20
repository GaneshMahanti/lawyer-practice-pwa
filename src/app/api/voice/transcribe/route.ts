/**
 * POST /api/voice/transcribe
 *
 * Authenticated server route for Speech-to-Text using Sarvam AI (saaras:v2).
 * Accepts multipart/form-data with an audio file blob.
 *
 * SECURITY:
 *   - Real advocates use Sarvam; demo users receive a capped deterministic mock response.
 *   - SARVAM_API_KEY is server-only; never returned in response or logged.
 *   - Audio content is never stored or logged server-side.
 *
 * Request (multipart/form-data):
 *   file          - genuine 16-bit PCM WAV audio blob
 *   language_code - BCP-47 code: 'te-IN' | 'hi-IN' | 'en-IN' | 'unknown' (default: 'unknown')
 *   mode          - 'codemix' | 'transcribe' | 'translate' | 'verbatim' (default: 'codemix')
 *
 * Response (JSON):
 *   { transcript: string; language_code?: string; provider: 'sarvam' | 'demo' }
 *   or error: { error: string; code: string }
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getRequestUser } from '@/lib/auth/requestUser';
import { isAnonymousUser, isRealAppUser } from '@/lib/supabase/auth';
import { transcribeAudio, isSarvamConfigured } from '@/lib/sarvam';
import type { SarvamLanguageCode, SarvamSTTMode } from '@/lib/sarvam';
import { createServiceClient } from '@/lib/supabase/service';
import { logServerError } from '@/lib/log/serverLog';
import { resolveOwner, estimateStt, reserve, settle, release } from '@/lib/ai/metering';

const MSG_STT: Record<string, string> = {
  rate_limited:      'Too many requests. Please wait a moment and try again.',
  quota_exhausted:   'Transcription credits exhausted. Please contact support.',
  validation_error:  'The audio file could not be transcribed. Check the format and try again.',
  timeout:           'Transcription took too long. Please try a shorter clip.',
  auth_error:        'Transcription service authentication failed. Contact support.',
};

const ALLOWED_MODES: SarvamSTTMode[] = ['codemix', 'transcribe', 'translate', 'verbatim', 'translit'];
const ALLOWED_LANG_CODES = new Set([
  'te-IN', 'hi-IN', 'en-IN', 'kn-IN', 'ta-IN', 'ml-IN', 'mr-IN',
  'gu-IN', 'pa-IN', 'or-IN', 'bn-IN', 'ur-IN', 'unknown',
]);

export async function POST(request: NextRequest) {
  // ── Auth: allow approved advocates and deterministic demo users ────────────
  const user = await getRequestUser(request);
  if (!user || (!isAnonymousUser(user) && !isRealAppUser(user))) {
    return NextResponse.json(
      {
        error: 'Voice transcription is only available to approved advocates. Please sign in.',
        code: 'auth_error',
      },
      { status: 403 }
    );
  }

  // ── AI feature flag check (real lawyers only) ──────────────────────────────
  if (!isAnonymousUser(user) && user.app_metadata?.role === 'lawyer' && user.email) {
    try {
      const service = createServiceClient() as any;
      const { data: flags } = await service
        .from('approved_users')
        .select('ai_enabled')
        .eq('email', user.email.toLowerCase())
        .maybeSingle();
      if (flags && flags.ai_enabled === false) {
        return NextResponse.json(
          { error: 'AI features are not enabled for your account. Contact support.', code: 'feature_disabled' },
          { status: 403 }
        );
      }
    } catch { /* fail open */ }
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

  const isDemo = isAnonymousUser(user);

  // ── Demo path: fixed mock transcript, no Sarvam call, no metering ────────
  if (isDemo) {
    const demoResult = await transcribeAudio({
      audioBlob: fileEntry,
      languageCode,
      mode,
      isDemoMode: true,
      timeoutMs: 40_000,
    });
    if (!demoResult.ok) {
      return NextResponse.json({ error: 'Demo transcription unavailable.', code: demoResult.code }, { status: 503 });
    }
    return NextResponse.json({
      transcript: demoResult.data.transcript,
      language_code: demoResult.data.language_code ?? languageCode,
      provider: 'demo',
      request_id: demoResult.requestId,
    });
  }

  // ── Key check: real advocates get 503 if key is missing ───────────────────
  if (!isSarvamConfigured()) {
    return NextResponse.json(
      {
        error:
          'Voice transcription unavailable: SARVAM_API_KEY is not configured on this server. ' +
          'Add SARVAM_API_KEY to the server environment variables (Vercel Project Settings → Environment Variables).',
        code: 'not_configured',
      },
      { status: 503 }
    );
  }

  // ── Metering: reserve credits before calling Sarvam ─────────────────────
  const service = createServiceClient() as any;
  const ownerId = await resolveOwner(service, user.id);
  const est = await estimateStt(fileEntry);
  const meter = await reserve(service, ownerId, user.id, 'stt', est.paise);
  if (!meter.ok) {
    return NextResponse.json({ error: meter.message, code: meter.code }, { status: meter.httpStatus });
  }

  // ── Call Sarvam STT ───────────────────────────────────────────────────────
  const result = await transcribeAudio({
    audioBlob: fileEntry,
    languageCode,
    mode,
    isDemoMode: false,
    timeoutMs: 40_000,
  });

  if (!result.ok) {
    await release(service, meter.reserveId);

    const httpStatus =
      result.code === 'auth_error'       ? 401
      : result.code === 'quota_exhausted' ? 402
      : result.code === 'rate_limited'    ? 429
      : result.code === 'validation_error'? 422
      : result.code === 'timeout'         ? 504
      : 502;

    await logServerError('voice/transcribe', new Error(result.message), {
      code: result.code, userId: user.id,
    });

    return NextResponse.json(
      { error: MSG_STT[result.code] ?? 'Transcription failed. Please try again.', code: result.code },
      { status: httpStatus }
    );
  }

  await settle(service, meter.reserveId, est.paise, est.units);

  return NextResponse.json({
    transcript: result.data.transcript,
    language_code: result.data.language_code ?? languageCode,
    provider: 'sarvam',
    request_id: result.requestId,
  });
}
