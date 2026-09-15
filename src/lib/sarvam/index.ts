/**
 * Sarvam AI — Server-Side Library Barrel
 *
 * SERVER-ONLY. All exports in this module run exclusively on the server.
 * Never import this barrel from client components or browser code.
 *
 * Usage in route handlers:
 *   import { transcribeAudio } from '@/lib/sarvam';
 *   import { translateText }   from '@/lib/sarvam';
 *   import { transliterateText } from '@/lib/sarvam';
 *   import { extractDocumentText } from '@/lib/sarvam';
 */

export { transcribeAudio, DEMO_MODE_MAX_CALLS } from './stt';
export type { STTOptions, STTResult } from './stt';

export { translateText } from './translate';
export type { TranslateOptions, TranslateResult } from './translate';

export { transliterateText } from './transliterate';
export type { TransliterateOptions, TransliterateResult } from './transliterate';

export { extractDocumentText, DOC_AI_MAX_PAGES, DOC_AI_POLL_TIMEOUT_MS } from './docai';
export type { DocAIOptions, DocAIResult } from './docai';

export { isSarvamConfigured, SARVAM_BASE_URL, SARVAM_STT_MODEL, SARVAM_TRANSLATE_MODEL, SARVAM_DOCAI_MODEL } from './client';

export type {
  SarvamLanguageCode,
  SarvamSTTMode,
  SarvamSTTRequest,
  SarvamSTTResponse,
  SarvamTranslateRequest,
  SarvamTranslateResponse,
  SarvamTransliterateRequest,
  SarvamTransliterateResponse,
  SarvamDocAIRequest,
  SarvamDocAIJobResponse,
  SarvamDocAIJobStatus,
  SarvamDocAIOutputFormat,
  SarvamResult,
  SarvamError,
  SarvamOutcome,
  SarvamApiError,
} from './types';
