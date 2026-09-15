/**
 * Sarvam AI — Transliteration Helper
 *
 * SERVER-ONLY. Do not import from client components.
 *
 * Wraps the Sarvam /transliterate endpoint.
 *
 * Use cases:
 *   - Telugu script → Roman phonetic (te-IN → en-IN)
 *   - Roman phonetic → Telugu script (en-IN → te-IN)
 *   - Hindi Devanagari ↔ Roman (hi-IN ↔ en-IN)
 *   - Cross-script conversions for any supported Indic language
 *
 * Distinct from translation: transliteration changes the script/writing system
 * but preserves the original phonetics. Translation changes meaning into another
 * language.
 *
 * Demo Mode: returns a mock transliteration without consuming credits.
 */

if (typeof window !== 'undefined') {
  throw new Error('[sarvam/transliterate] This module is SERVER-ONLY.');
}

import { isSarvamConfigured, sarvamPost } from './client';
import type {
  SarvamTransliterateResponse,
  SarvamLanguageCode,
  SarvamOutcome,
  SarvamError,
} from './types';

// ── Demo mocks ────────────────────────────────────────────────────────────────

const DEMO_TRANSLIT: Partial<Record<string, string>> = {
  'te-IN→en-IN': 'naa muvaakkilu nirdoshi. bailu darakhastu pettaali.',
  'en-IN→te-IN': 'నా మువాక్కిలు నిర్దోషి. బైలు దరఖాస్తు పెట్టాలి.',
  'hi-IN→en-IN': 'mera muvaakkil nirdosh hai. zamanat ki darkhast daakhil karo.',
  'en-IN→hi-IN': 'मेरा मुवक्किल निर्दोष है। ज़मानत की दरखास्त दाखिल करो।',
};

function demoTranslit(
  src: SarvamLanguageCode,
  tgt: SarvamLanguageCode,
  input: string
): SarvamOutcome<SarvamTransliterateResponse> {
  const key = `${src}→${tgt}`;
  const transliterated_text =
    DEMO_TRANSLIT[key] ??
    `[Demo] Transliteration of "${input.slice(0, 40)}..." from ${src} to ${tgt}. Configure SARVAM_API_KEY for real transliteration.`;
  return {
    ok: true,
    data: { transliterated_text },
    requestId: 'demo-translit-mock',
  };
}

// ── Limits ────────────────────────────────────────────────────────────────────

const MAX_INPUT_CHARS = 2000;

// ── Public transliterate helper ───────────────────────────────────────────────

export interface TransliterateOptions {
  /** Text to transliterate. Max 2000 characters. */
  text: string;
  /** Source language/script code. */
  sourceLang: SarvamLanguageCode | string;
  /** Target language/script code. */
  targetLang: SarvamLanguageCode | string;
  numeralsFormat?: 'international' | 'native';
  /** Return a mock without calling Sarvam (demo/anonymous users). */
  isDemoMode?: boolean;
  timeoutMs?: number;
}

export type TransliterateResult = SarvamOutcome<SarvamTransliterateResponse>;

/**
 * Transliterate text between Indian scripts using Sarvam AI.
 *
 * Returns SarvamOutcome — check `.ok` before accessing `.data.transliterated_text`.
 */
export async function transliterateText(
  options: TransliterateOptions
): Promise<TransliterateResult> {
  const {
    text,
    sourceLang,
    targetLang,
    numeralsFormat = 'international',
    isDemoMode = false,
    timeoutMs = 15_000,
  } = options;

  const src = sourceLang as SarvamLanguageCode;
  const tgt = targetLang as SarvamLanguageCode;

  // ── Demo mode ─────────────────────────────────────────────────────────────
  if (isDemoMode) {
    return demoTranslit(src, tgt, text);
  }

  // ── Key guard ─────────────────────────────────────────────────────────────
  if (!isSarvamConfigured()) {
    const err: SarvamError = {
      ok: false,
      message:
        'SARVAM_API_KEY is not configured. Add it to .env.local to enable Transliteration.',
      code: 'not_configured',
    };
    return err;
  }

  // ── Input validation ──────────────────────────────────────────────────────
  const trimmed = text.trim();
  if (!trimmed) {
    return { ok: false, message: 'Transliteration input is empty.', code: 'validation_error' };
  }
  if (trimmed.length > MAX_INPUT_CHARS) {
    return {
      ok: false,
      message: `Text is too long (${trimmed.length} chars). Please limit to ${MAX_INPUT_CHARS} characters.`,
      code: 'validation_error',
    };
  }

  // ── Build request ─────────────────────────────────────────────────────────
  const payload: Record<string, unknown> = {
    input: trimmed,
    source_language_code: src,
    target_language_code: tgt,
    numerals_format: numeralsFormat,
  };

  return sarvamPost<SarvamTransliterateResponse>('/transliterate', payload, { timeoutMs });
}
