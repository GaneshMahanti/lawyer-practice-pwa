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

// ── Chunking helper ──────────────────────────────────────────────────────────

/**
 * Splits text into logical chunks of at most maxChars (default 1800 to stay safely within the 2000 limit).
 * Prioritizes splitting on:
 *   1. Paragraph breaks (\n\n)
 *   2. Single line breaks (\n)
 *   3. Sentence endings ( ।, ., ?, ! )
 *   4. Word boundaries (spaces)
 * Preserves paragraph and sentence structure upon reassembly.
 */
export function chunkTextForTranslation(text: string, maxChars = 1800): string[] {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) {
    return [trimmed];
  }

  const chunks: string[] = [];
  // Split first by paragraphs
  const paragraphs = trimmed.split(/\n\s*\n/);
  let currentChunk = '';

  for (const para of paragraphs) {
    const p = para.trim();
    if (!p) continue;

    if (p.length > maxChars) {
      // Paragraph itself exceeds maxChars; flush current chunk first
      if (currentChunk) {
        chunks.push(currentChunk.trim());
        currentChunk = '';
      }

      // Split paragraph by sentences (including Indic danda '।')
      const sentences = p.split(/(?<=[।\.?!;\n])\s+/);
      let sentChunk = '';

      for (const sent of sentences) {
        const s = sent.trim();
        if (!s) continue;

        if (s.length > maxChars) {
          // Sentence itself exceeds maxChars; flush sentChunk
          if (sentChunk) {
            chunks.push(sentChunk.trim());
            sentChunk = '';
          }

          // Split sentence by words
          const words = s.split(/\s+/);
          let wordChunk = '';
          for (const w of words) {
            if ((wordChunk + ' ' + w).trim().length <= maxChars) {
              wordChunk = (wordChunk + ' ' + w).trim();
            } else {
              if (wordChunk) chunks.push(wordChunk);
              wordChunk = w;
            }
          }
          if (wordChunk) chunks.push(wordChunk);
        } else if ((sentChunk + ' ' + s).trim().length <= maxChars) {
          sentChunk = (sentChunk ? sentChunk + ' ' : '') + s;
        } else {
          if (sentChunk) chunks.push(sentChunk.trim());
          sentChunk = s;
        }
      }

      if (sentChunk) {
        chunks.push(sentChunk.trim());
      }
    } else if ((currentChunk + '\n\n' + p).trim().length <= maxChars) {
      currentChunk = currentChunk ? currentChunk + '\n\n' + p : p;
    } else {
      if (currentChunk) chunks.push(currentChunk.trim());
      currentChunk = p;
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk.trim());
  }

  return chunks.filter(Boolean);
}

// ── Public translate helper ───────────────────────────────────────────────────

export interface TranslateOptions {
  /** Source text to translate. */
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
 * Supports long documents through automatic paragraph-preserving chunking.
 *
 * Primary model: sarvam-translate:v1 with formal mode (supports up to 2000 chars per request).
 * Optional model: mayura:v1 (supports up to 1000 chars per request).
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
    timeoutMs = 30_000,
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

  // Determine per-request chunk limit based on model:
  // sarvam-translate:v1 supports up to 2000 chars (safe chunk: 1800)
  // mayura:v1 supports up to 1000 chars (safe chunk: 900)
  const isMayura = SARVAM_TRANSLATE_MODEL.includes('mayura');
  const safeChunkLimit = isMayura ? 900 : 1800;

  // If text exceeds safe limit, chunk and translate sequentially
  if (trimmed.length > safeChunkLimit) {
    const chunks = chunkTextForTranslation(trimmed, safeChunkLimit);
    const translatedChunks: string[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunkPayload: Record<string, unknown> = {
        input: chunks[i],
        source_language_code: src,
        target_language_code: tgt,
        model: SARVAM_TRANSLATE_MODEL,
        mode,
        enable_preprocessing: true,
      };

      if (speakerGender) {
        chunkPayload.speaker_gender = speakerGender;
      }

      const chunkRes = await sarvamPost<SarvamTranslateResponse>(
        '/translate',
        chunkPayload,
        { timeoutMs }
      );

      if (!chunkRes.ok) {
        return chunkRes;
      }

      translatedChunks.push(chunkRes.data.translated_text);
    }

    // Reassemble preserving paragraph breaks
    const joinedText = translatedChunks.join('\n\n');
    return {
      ok: true,
      data: {
        translated_text: joinedText,
        source_language_code: src,
        target_language_code: tgt,
      },
    };
  }

  // Single-request translation for standard text
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

  return sarvamPost<SarvamTranslateResponse>('/translate', payload, { timeoutMs });
}
