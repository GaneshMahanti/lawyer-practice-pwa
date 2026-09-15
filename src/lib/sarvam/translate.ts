/**
 * Sarvam AI — Translation Helper
 *
 * SERVER-ONLY. Do not import from client components.
 *
 * Wraps the Sarvam /translate endpoint (model: mayura:v1 by default,
 * configurable via SARVAM_TRANSLATE_MODEL env var).
 *
 * Key behaviours:
 *   - Input text capped at 2000 characters (Sarvam limit).
 *   - Normalises short language codes (te → te-IN, hi → hi-IN, en → en-IN).
 *   - Uses 'formal' mode by default — appropriate for legal documents.
 *   - Demo Mode: returns a realistic mock translation without consuming credits.
 *   - Never alters the original source text.
 *   - All translations are drafts; the lawyer must review before use.
 */

if (typeof window !== 'undefined') {
  throw new Error('[sarvam/translate] This module is SERVER-ONLY.');
}

import {
  isSarvamConfigured,
  sarvamPost,
  SARVAM_TRANSLATE_MODEL,
} from './client';
import type {
  SarvamTranslateResponse,
  SarvamLanguageCode,
  SarvamOutcome,
  SarvamError,
} from './types';

// ── Limits ────────────────────────────────────────────────────────────────────

/** Sarvam Translate enforces a 2000-character input limit. */
const MAX_INPUT_CHARS = 2000;

// ── Language code normalisation ───────────────────────────────────────────────

const LANG_NORMALISE: Record<string, SarvamLanguageCode> = {
  te: 'te-IN',
  hi: 'hi-IN',
  en: 'en-IN',
  kn: 'kn-IN',
  ta: 'ta-IN',
  ml: 'ml-IN',
  mr: 'mr-IN',
  gu: 'gu-IN',
  pa: 'pa-IN',
  or: 'or-IN',
  bn: 'bn-IN',
  ur: 'ur-IN',
};

function normaliseLang(code: string): SarvamLanguageCode {
  return (LANG_NORMALISE[code] ?? code) as SarvamLanguageCode;
}

// ── Demo Mode mocks ───────────────────────────────────────────────────────────

const DEMO_TRANSLATIONS: Partial<Record<string, string>> = {
  'te-IN→en-IN':
    '[Demo] This is a mock legal translation from Telugu to English. Configure SARVAM_API_KEY to enable real AI translation.',
  'hi-IN→en-IN':
    '[Demo] This is a mock legal translation from Hindi to English. Configure SARVAM_API_KEY to enable real AI translation.',
  'en-IN→te-IN':
    '[Demo] ఇది తెలుగులోకి అనువాదం యొక్క డెమో నమూనా. నిజమైన అనువాదం కోసం SARVAM_API_KEY సెట్ చేయండి.',
  'en-IN→hi-IN':
    '[Demo] यह हिंदी में अनुवाद का डेमो नमूना है। वास्तविक अनुवाद के लिए SARVAM_API_KEY सेट करें।',
};

function demoTranslation(
  sourceLang: SarvamLanguageCode,
  targetLang: SarvamLanguageCode
): SarvamOutcome<SarvamTranslateResponse> {
  const key = `${sourceLang}→${targetLang}`;
  const translated_text =
    DEMO_TRANSLATIONS[key] ??
    `[Demo] Translation from ${sourceLang} to ${targetLang} (mock). Configure SARVAM_API_KEY to enable real translation.`;
  return {
    ok: true,
    data: { translated_text, source_language_code: sourceLang, target_language_code: targetLang },
    requestId: 'demo-translate-mock',
  };
}

// ── Public translate helper ───────────────────────────────────────────────────

export interface TranslateOptions {
  /** Source text to translate. Max 2000 characters. */
  text: string;
  /** Source language code (short or BCP-47 form). Default: 'te-IN' */
  sourceLang?: string;
  /** Target language code. Default: 'en-IN' */
  targetLang?: string;
  /**
   * Register/style.
   * 'formal' is recommended for legal documents and court correspondence.
   */
  mode?: 'formal' | 'colloquial' | 'modern-colloquial';
  /** Speaker gender, used for gendered honourifics in some models. */
  speakerGender?: 'Male' | 'Female';
  /** Return a mock translation without calling Sarvam (demo/anonymous users). */
  isDemoMode?: boolean;
  timeoutMs?: number;
}

export type TranslateResult = SarvamOutcome<SarvamTranslateResponse>;

/**
 * Translate text using the Sarvam AI translation service.
 *
 * Returns a SarvamOutcome — check `.ok` before accessing `.data.translated_text`.
 * Translations are always drafts and must be reviewed by the lawyer.
 */
export async function translateText(options: TranslateOptions): Promise<TranslateResult> {
  const {
    text,
    sourceLang = 'te',
    targetLang = 'en',
    mode = 'formal',
    speakerGender,
    isDemoMode = false,
    timeoutMs = 20_000,
  } = options;

  const src = normaliseLang(sourceLang);
  const tgt = normaliseLang(targetLang);

  // ── Demo mode ─────────────────────────────────────────────────────────────
  if (isDemoMode) {
    return demoTranslation(src, tgt);
  }

  // ── Key guard ─────────────────────────────────────────────────────────────
  if (!isSarvamConfigured()) {
    const err: SarvamError = {
      ok: false,
      message:
        'SARVAM_API_KEY is not configured. Add it to .env.local to enable AI translation.',
      code: 'not_configured',
    };
    return err;
  }

  // ── Input validation ───────────────────────────────────────────────────────
  const trimmed = text.trim();
  if (!trimmed) {
    return {
      ok: false,
      message: 'Translation input is empty.',
      code: 'validation_error',
    };
  }

  if (trimmed.length > MAX_INPUT_CHARS) {
    return {
      ok: false,
      message: `Text is too long for translation (${trimmed.length} chars). Please limit to ${MAX_INPUT_CHARS} characters per request.`,
      code: 'validation_error',
    };
  }

  if (src === tgt) {
    // No-op: return the source text as-is
    return {
      ok: true,
      data: {
        translated_text: trimmed,
        source_language_code: src,
        target_language_code: tgt,
      },
    };
  }

  // ── Build request payload ──────────────────────────────────────────────────
  const payload: Record<string, unknown> = {
    input: trimmed,
    source_language_code: src,
    target_language_code: tgt,
    model: SARVAM_TRANSLATE_MODEL,
    mode,
    enable_preprocessing: true,
  };

  if (speakerGender) {
    payload.speaker_gender = speakerGender;
  }

  // ── Call Sarvam Translate endpoint ────────────────────────────────────────
  return sarvamPost<SarvamTranslateResponse>('/translate', payload, { timeoutMs });
}
