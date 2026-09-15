/**
 * Sarvam AI — TypeScript type contracts
 *
 * Sourced from the official Sarvam API documentation:
 *   https://docs.sarvam.ai/api-reference-docs
 *
 * All types are server-only. Never import from client components.
 *
 * ⚠️  IMPORTANT: Verify model identifiers against the live docs before
 *     upgrading. Model IDs and field names can change across major versions.
 *     Keep model names configurable through env vars (SARVAM_STT_MODEL, etc.)
 *     rather than hardcoding them here.
 */

// ── Shared ───────────────────────────────────────────────────────────────────

/** ISO-639-1 BCP-47 style language codes supported by Sarvam. */
export type SarvamLanguageCode =
  | 'as-IN'   // Assamese
  | 'bn-IN'   // Bengali
  | 'brx-IN'  // Bodo
  | 'doi-IN'  // Dogri
  | 'en-IN'   // English (Indian)
  | 'gu-IN'   // Gujarati
  | 'hi-IN'   // Hindi
  | 'kn-IN'   // Kannada
  | 'kok-IN'  // Konkani
  | 'ks-IN'   // Kashmiri
  | 'mai-IN'  // Maithili
  | 'ml-IN'   // Malayalam
  | 'mni-IN'  // Manipuri
  | 'mr-IN'   // Marathi
  | 'ne-IN'   // Nepali
  | 'or-IN'   // Odia
  | 'pa-IN'   // Punjabi
  | 'sa-IN'   // Sanskrit
  | 'sat-IN'  // Santali
  | 'sd-IN'   // Sindhi
  | 'ta-IN'   // Tamil
  | 'te-IN'   // Telugu
  | 'ur-IN'   // Urdu
  | 'unknown' // Auto-detect (STT only)
  ;

/** Standard Sarvam API error shape. */
export interface SarvamApiError {
  status_code?: number;
  message?: string;
  detail?: string | { msg: string; type: string }[];
}

// ── Speech-to-Text (STT) ─────────────────────────────────────────────────────

/**
 * STT transcript mode.
 *   codemix   — best for mixed-language speech (e.g. Telugu + English)
 *   transcribe — verbatim transcript in the detected language
 *   translate — translate to English on-the-fly
 *   verbatim  — exact words with disfluencies
 *   translit  — convert to Latin-script phonetic output
 */
export type SarvamSTTMode =
  | 'codemix'
  | 'transcribe'
  | 'translate'
  | 'verbatim'
  | 'translit';

/** Multipart/form-data fields sent to /speech-to-text. */
export interface SarvamSTTRequest {
  /** WAV or WEBM audio blob. Max 25MB. */
  file: Blob;
  model: string;             // env SARVAM_STT_MODEL, default 'saaras:v2'
  language_code: SarvamLanguageCode;
  mode?: SarvamSTTMode;
  with_timestamps?: boolean;
  with_disfluencies?: boolean;
  debug_mode?: boolean;
}

export interface SarvamSTTResponse {
  transcript: string;
  language_code?: string;
  /** Word-level timestamps, present when with_timestamps=true */
  timestamps?: Array<{ word: string; start: number; end: number }>;
  request_id?: string;
}

// ── Translation ───────────────────────────────────────────────────────────────

export interface SarvamTranslateRequest {
  /** Source text. Max 2000 characters per Sarvam docs. */
  input: string;
  source_language_code: SarvamLanguageCode;
  target_language_code: SarvamLanguageCode;
  model?: string;            // env SARVAM_TRANSLATE_MODEL, default 'mayura:v1'
  /** Use formal register (recommended for legal text). */
  mode?: 'formal' | 'colloquial' | 'modern-colloquial';
  /** Speaker gender — some models adjust honorfic phrasing. */
  speaker_gender?: 'Male' | 'Female';
  /** Treat numerals as literals rather than translating them. */
  numerals_format?: 'international' | 'native';
  enable_preprocessing?: boolean;
}

export interface SarvamTranslateResponse {
  translated_text: string;
  source_language_code?: string;
  target_language_code?: string;
  request_id?: string;
}

// ── Transliteration ──────────────────────────────────────────────────────────

export interface SarvamTransliterateRequest {
  input: string;
  source_language_code: SarvamLanguageCode | 'en-IN';
  target_language_code: SarvamLanguageCode | 'en-IN';
  /** Numerals output format */
  numerals_format?: 'international' | 'native';
}

export interface SarvamTransliterateResponse {
  transliterated_text: string;
  request_id?: string;
}

// ── Document AI ───────────────────────────────────────────────────────────────

/**
 * Output format for Document AI digitisation result.
 * Official docs specify 'md', 'html', or 'json'.
 */
export type SarvamDocAIOutputFormat = 'md' | 'json' | 'html';

/**
 * Request payload to start a Document AI digitise job.
 * Sent as multipart/form-data to /doc-ai/v1/job/digitise.
 */
export interface SarvamDocAIRequest {
  /** PDF, JPEG, or PNG file blob. Max 50MB. */
  file: Blob;
  output_format?: SarvamDocAIOutputFormat;
  language?: SarvamLanguageCode | string;
  /** Configurable via SARVAM_DOCAI_MODEL — pass only when the API requires an explicit model selector. */
  model?: string;
  pages?: number[];              // specific pages to process (1-indexed), max 10
}

export type SarvamDocAIJobStatus =
  | 'PENDING'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'PARTIALLY_COMPLETED'
  | 'FAILED'
  | 'REJECTED'
  | 'CANCELLED'
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'partially_completed'
  | 'failed'
  | 'rejected'
  | 'cancelled';

export interface SarvamDocAIJobResponse {
  job_id: string;
  status: SarvamDocAIJobStatus;
  download_url?: string;
  output?: string;
  error?: string;
  request_id?: string;
}

// ── Provider result wrappers (used internally by lib helpers) ─────────────────

export interface SarvamResult<T> {
  ok: true;
  data: T;
  requestId?: string;
}

export interface SarvamError {
  ok: false;
  /** User-visible error message (safe to surface in UI). */
  message: string;
  /** HTTP status from Sarvam, if available. */
  httpStatus?: number;
  /** Internal error code for programmatic handling. */
  code:
    | 'auth_error'        // 401/403 — invalid or missing API key
    | 'quota_exhausted'   // 402 — insufficient credits
    | 'rate_limited'      // 429 — too many requests
    | 'validation_error'  // 422 — bad input
    | 'service_error'     // 500/503 — upstream error
    | 'timeout'           // AbortController timeout
    | 'demo_mode'         // Demo/anonymous user — mocked response returned
    | 'not_configured'    // SARVAM_API_KEY not set
    | 'unknown';
}

export type SarvamOutcome<T> = SarvamResult<T> | SarvamError;
