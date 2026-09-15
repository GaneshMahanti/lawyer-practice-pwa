/**
 * Sarvam AI — Speech-to-Text (STT) Helper
 *
 * SERVER-ONLY. Do not import from client components.
 *
 * Wraps the Sarvam /speech-to-text endpoint using the saaras:v2 model
 * (configurable via SARVAM_STT_MODEL env var).
 *
 * Supports:
 *   - Telugu, Hindi, English, and code-mixed speech (te-IN, hi-IN, en-IN, unknown)
 *   - Mode: codemix (recommended for lawyer speech with English legal terms)
 *   - Audio: WAV or WEBM; validated for size before upload
 *
 * Demo Mode:
 *   Pass isDemoMode=true to receive a realistic mock transcript without
 *   consuming Sarvam credits. Limited to DEMO_MODE_MAX_CALLS per session
 *   (enforced by the caller/route handler, not this helper).
 */

if (typeof window !== 'undefined') {
  throw new Error('[sarvam/stt] This module is SERVER-ONLY.');
}

import {
  isSarvamConfigured,
  sarvamPostForm,
  SARVAM_STT_MODEL,
  DEMO_MODE_MAX_CALLS,
} from './client';
import type {
  SarvamSTTResponse,
  SarvamLanguageCode,
  SarvamSTTMode,
  SarvamOutcome,
  SarvamError,
} from './types';

// ── Validation limits ────────────────────────────────────────────────────────

/** Maximum audio file size the Sarvam STT endpoint accepts (25 MB). */
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

/** Allowed audio MIME types for Sarvam STT. */
const ALLOWED_AUDIO_MIME = new Set([
  'audio/wav',
  'audio/wave',
  'audio/x-wav',
  'audio/webm',
  'audio/ogg',
  'audio/mp4',
  'audio/mpeg',
]);

// ── Demo Mode mock response ───────────────────────────────────────────────────

const DEMO_TRANSCRIPTS: Record<string, string> = {
  'te-IN':
    'ఈ కేసులో మా క్లయింట్ నిర్దోషి. అరెస్ట్ చేసిన తేదీ నుండి బెయిల్ దరఖాస్తు పెట్టాలి.',
  'hi-IN':
    'इस मामले में हमारे मुवक्किल को ज़मानत मिलनी चाहिए। अगली सुनवाई 15 तारीख को है।',
  'en-IN':
    'In this case the client is innocent. We need to file a bail application at the earliest.',
  'unknown':
    'Client innocent hai. Bail application file karna padega — next hearing 15th ko hai.',
};

function demoTranscriptFor(languageCode: SarvamLanguageCode): SarvamOutcome<SarvamSTTResponse> {
  return {
    ok: true,
    data: {
      transcript:
        DEMO_TRANSCRIPTS[languageCode] ??
        DEMO_TRANSCRIPTS['en-IN'],
      language_code: languageCode,
    },
    requestId: 'demo-stt-mock',
  };
}

// ── Public STT helper ─────────────────────────────────────────────────────────

export interface STTOptions {
  /** Audio blob — WAV or WEBM recommended. Max 25 MB. */
  audioBlob: Blob;
  /** BCP-47 language code or 'unknown' for auto-detect. */
  languageCode?: SarvamLanguageCode;
  /**
   * Transcript mode.
   * - 'codemix' is recommended for lawyer speech mixing Telugu/Hindi with English legal terms.
   * - 'transcribe' for verbatim output in source language.
   */
  mode?: SarvamSTTMode;
  withTimestamps?: boolean;
  /** If true, return a mock transcript without calling Sarvam (demo/anonymous users). */
  isDemoMode?: boolean;
  /** Override request timeout. Default: 30s. */
  timeoutMs?: number;
}

export type STTResult = SarvamOutcome<SarvamSTTResponse>;

/**
 * Transcribe audio using Sarvam Speech-to-Text.
 *
 * Returns a SarvamOutcome — check `.ok` before accessing `.data`.
 */
export async function transcribeAudio(options: STTOptions): Promise<STTResult> {
  const {
    audioBlob,
    languageCode = 'unknown',
    mode = 'codemix',
    withTimestamps = false,
    isDemoMode = false,
    timeoutMs = 30_000,
  } = options;

  // ── Demo mode: return mock, never call Sarvam ─────────────────────────────
  if (isDemoMode) {
    return demoTranscriptFor(languageCode);
  }

  // ── Key guard ─────────────────────────────────────────────────────────────
  if (!isSarvamConfigured()) {
    const err: SarvamError = {
      ok: false,
      message:
        'SARVAM_API_KEY is not configured. Add it to .env.local to enable Speech-to-Text.',
      code: 'not_configured',
    };
    return err;
  }

  // ── File size validation ───────────────────────────────────────────────────
  if (audioBlob.size > MAX_AUDIO_BYTES) {
    const sizeMB = (audioBlob.size / (1024 * 1024)).toFixed(1);
    return {
      ok: false,
      message: `Audio file is too large (${sizeMB} MB). Maximum is 25 MB. Please trim the recording and try again.`,
      code: 'validation_error',
    };
  }

  // ── MIME type check ───────────────────────────────────────────────────────
  if (audioBlob.type && !ALLOWED_AUDIO_MIME.has(audioBlob.type)) {
    return {
      ok: false,
      message: `Audio format "${audioBlob.type}" is not supported. Please record in WAV or WEBM format.`,
      code: 'validation_error',
    };
  }

  // ── Build multipart form ───────────────────────────────────────────────────
  const form = new FormData();
  const filename =
    audioBlob.type === 'audio/wav' || audioBlob.type === 'audio/wave'
      ? 'recording.wav'
      : 'recording.webm';
  form.append('file', audioBlob, filename);
  form.append('model', SARVAM_STT_MODEL);
  form.append('language_code', languageCode);
  form.append('mode', mode);
  if (withTimestamps) {
    form.append('with_timestamps', 'true');
  }

  // ── Call Sarvam STT endpoint ───────────────────────────────────────────────
  return sarvamPostForm<SarvamSTTResponse>(
    '/speech-to-text',
    form,
    { timeoutMs }
  );
}

// Re-export limit constant so route handlers can reference it
export { DEMO_MODE_MAX_CALLS };
