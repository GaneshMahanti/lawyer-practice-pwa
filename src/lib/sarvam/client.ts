/**
 * Sarvam AI — Secure Server-Side HTTP Client
 *
 * SECURITY RULES (enforced by test-security.js):
 *  1. This file MUST only ever be imported in server-side code (route handlers,
 *     lib helpers). Never in client components or pages that run in the browser.
 *  2. SARVAM_API_KEY is read exclusively via process.env here. It is NEVER
 *     returned in API responses, never logged, and never bundled into the client.
 *  3. Request/response bodies are never logged in production.
 *
 * All requests use AbortController with a configurable timeout to prevent
 * hanging connections. Errors are mapped to typed SarvamError objects.
 */

// Server-only guard — fail loudly if somehow imported client-side
if (typeof window !== 'undefined') {
  throw new Error(
    '[sarvam/client] This module is SERVER-ONLY. ' +
    'Do not import it from client components or pages.'
  );
}

import type { SarvamApiError, SarvamOutcome } from './types';

// ── Configuration constants ──────────────────────────────────────────────────

/** Sarvam API base URL. Override via SARVAM_BASE_URL env var. */
export const SARVAM_BASE_URL =
  process.env.SARVAM_BASE_URL?.replace(/\/$/, '') ?? 'https://api.sarvam.ai';

/**
 * Default Speech-to-Text model.
 * Per official docs (verified 2026-09-15): saaras:v2 is the current stable model.
 * Override via SARVAM_STT_MODEL env var to switch to a newer version without code changes.
 *
 * ⚠️  Verify at implementation time: https://docs.sarvam.ai/api-reference-docs/speech-to-text
 */
export const SARVAM_STT_MODEL =
  process.env.SARVAM_STT_MODEL ?? 'saaras:v2';

/**
 * Default Translation model.
 * Per official docs (verified 2026-09-15): mayura:v1 is the recommended production model
 * for formal legal text. sarvam-translate:v1 supports more languages but is less
 * suited for formal legal register.
 * Override via SARVAM_TRANSLATE_MODEL env var.
 *
 * ⚠️  Verify at implementation time: https://docs.sarvam.ai/api-reference-docs/translate
 */
export const SARVAM_TRANSLATE_MODEL =
  process.env.SARVAM_TRANSLATE_MODEL ?? 'mayura:v1';

/**
 * Document AI model selector. Most Sarvam Doc AI endpoints do not require an
 * explicit model field — the API defaults to the latest model. Only pass this
 * value when the API contract explicitly requires a model field.
 * Override via SARVAM_DOCAI_MODEL env var.
 */
export const SARVAM_DOCAI_MODEL: string | undefined =
  process.env.SARVAM_DOCAI_MODEL;

/** Default request timeout in milliseconds. */
const DEFAULT_TIMEOUT_MS = 30_000;

/** Maximum polling timeout for async jobs (Document AI). */
export const DOC_AI_POLL_TIMEOUT_MS = 60_000;

/** Document AI polling interval. */
export const DOC_AI_POLL_INTERVAL_MS = 2_000;

/** Maximum pages to send to Document AI to control cost. */
export const DOC_AI_MAX_PAGES = 10;

// ── Key validation ───────────────────────────────────────────────────────────

/**
 * Returns true if a real, non-placeholder SARVAM_API_KEY is configured.
 * Note: key existence/validity is checked but the key itself is never returned.
 */
export function isSarvamConfigured(): boolean {
  const k = process.env.SARVAM_API_KEY;
  return (
    !!k &&
    k.trim().length > 10 &&
    k !== 'your_sarvam_api_key_here' &&
    !k.startsWith('YOUR_') &&
    !k.toLowerCase().startsWith('your-')
  );
}

// ── Demo mode helpers ────────────────────────────────────────────────────────

/**
 * Demo / anonymous user limit: max 3 mock Sarvam calls per session.
 * This is checked by callers; the client itself does not enforce it —
 * the route handler must gate on `isDemoUser` before calling Sarvam helpers.
 */
export const DEMO_MODE_MAX_CALLS = 3;

// ── Core HTTP helpers ─────────────────────────────────────────────────────────

type FetchOptions = {
  method?: 'GET' | 'POST';
  body?: BodyInit;
  headers?: Record<string, string>;
  timeoutMs?: number;
};

/**
 * Internal helper: makes an authenticated HTTP request to the Sarvam API.
 * Returns the raw Response. Throws on network error or AbortController timeout.
 *
 * Callers should use the capability-specific helpers (stt.ts, translate.ts, etc.)
 * instead of calling this directly.
 */
async function sarvamFetch(
  path: string,
  options: FetchOptions = {}
): Promise<Response> {
  const apiKey = process.env.SARVAM_API_KEY;
  // Key guard: should be gated upstream, but double-check
  if (!apiKey || !isSarvamConfigured()) {
    throw new SarvamClientError(
      'SARVAM_API_KEY is not configured on the server.',
      'not_configured',
      undefined
    );
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const url = `${SARVAM_BASE_URL}${path}`;

  try {
    const res = await fetch(url, {
      method: options.method ?? 'POST',
      headers: {
        'api-subscription-key': apiKey,
        ...options.headers,
      },
      body: options.body,
      signal: controller.signal,
    });
    return res;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new SarvamClientError(
        `Request to Sarvam timed out after ${timeoutMs / 1000}s.`,
        'timeout',
        undefined
      );
    }
    const msg = err instanceof Error ? err.message : 'Network error';
    throw new SarvamClientError(
      `Could not reach Sarvam API: ${msg}`,
      'unknown',
      undefined
    );
  } finally {
    clearTimeout(timer);
  }
}

// ── Error mapping ─────────────────────────────────────────────────────────────

export class SarvamClientError extends Error {
  constructor(
    message: string,
    public readonly code: import('./types').SarvamError['code'],
    public readonly httpStatus: number | undefined
  ) {
    super(message);
    this.name = 'SarvamClientError';
  }
}

/**
 * Parse an unsuccessful Sarvam HTTP response into a user-friendly SarvamError.
 * Never logs response body in production — only the status and mapped code.
 */
export async function parseSarvamError(
  res: Response
): Promise<import('./types').SarvamError> {
  let message: string;
  let code: import('./types').SarvamError['code'] = 'unknown';

  switch (res.status) {
    case 401:
    case 403:
      code = 'auth_error';
      message =
        'Sarvam API key is invalid or unauthorised. Please check SARVAM_API_KEY in .env.local.';
      break;
    case 402:
      code = 'quota_exhausted';
      message =
        'Sarvam API credits are exhausted. Please top up your Sarvam account.';
      break;
    case 429:
      code = 'rate_limited';
      message =
        'Sarvam API rate limit reached. Please wait a moment and try again.';
      break;
    case 422:
      code = 'validation_error';
      message = 'The request was rejected by Sarvam (validation error). Check input size and format.';
      // Attempt to extract specific message from Sarvam error body safely
      try {
        const body = (await res.json()) as SarvamApiError;
        if (typeof body?.detail === 'string') {
          message = `Sarvam validation error: ${body.detail}`;
        } else if (Array.isArray(body?.detail)) {
          message = `Sarvam validation error: ${body.detail.map((d) => d.msg).join('; ')}`;
        } else if (body?.message) {
          message = `Sarvam error: ${body.message}`;
        }
      } catch {
        // Swallow parse failure — use generic message
      }
      break;
    case 500:
    case 502:
    case 503:
    case 504:
      code = 'service_error';
      message =
        'Sarvam API is temporarily unavailable. Please try again in a few moments.';
      break;
    default:
      code = 'unknown';
      message = `Sarvam API returned an unexpected error (HTTP ${res.status}).`;
  }

  return { ok: false, message, code, httpStatus: res.status };
}

// ── Public fetch wrappers ─────────────────────────────────────────────────────

/**
 * POST JSON to a Sarvam endpoint.
 * Returns SarvamOutcome<T> — callers do not need to inspect raw Response.
 */
export async function sarvamPost<T>(
  path: string,
  payload: Record<string, unknown>,
  options: { timeoutMs?: number } = {}
): Promise<SarvamOutcome<T>> {
  try {
    const res = await sarvamFetch(path, {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'application/json' },
      timeoutMs: options.timeoutMs,
    });

    if (!res.ok) return parseSarvamError(res);

    const data = (await res.json()) as T;
    const requestId =
      (res.headers.get('x-request-id') ?? undefined) as string | undefined;
    return { ok: true, data, requestId };
  } catch (err) {
    if (err instanceof SarvamClientError) {
      return { ok: false, message: err.message, code: err.code, httpStatus: err.httpStatus };
    }
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return { ok: false, message: msg, code: 'unknown' };
  }
}

/**
 * POST multipart/form-data to a Sarvam endpoint (for file uploads).
 * Returns SarvamOutcome<T>.
 */
export async function sarvamPostForm<T>(
  path: string,
  formData: FormData,
  options: { timeoutMs?: number } = {}
): Promise<SarvamOutcome<T>> {
  try {
    const res = await sarvamFetch(path, {
      method: 'POST',
      body: formData,
      // Do NOT set Content-Type: fetch sets multipart boundary automatically
      timeoutMs: options.timeoutMs,
    });

    if (!res.ok) return parseSarvamError(res);

    const data = (await res.json()) as T;
    const requestId =
      (res.headers.get('x-request-id') ?? undefined) as string | undefined;
    return { ok: true, data, requestId };
  } catch (err) {
    if (err instanceof SarvamClientError) {
      return { ok: false, message: err.message, code: err.code, httpStatus: err.httpStatus };
    }
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return { ok: false, message: msg, code: 'unknown' };
  }
}

/**
 * GET a Sarvam endpoint (used for polling async job status).
 * Returns SarvamOutcome<T>.
 */
export async function sarvamGet<T>(
  path: string,
  options: { timeoutMs?: number } = {}
): Promise<SarvamOutcome<T>> {
  try {
    const res = await sarvamFetch(path, {
      method: 'GET',
      timeoutMs: options.timeoutMs,
    });

    if (!res.ok) return parseSarvamError(res);

    const data = (await res.json()) as T;
    const requestId =
      (res.headers.get('x-request-id') ?? undefined) as string | undefined;
    return { ok: true, data, requestId };
  } catch (err) {
    if (err instanceof SarvamClientError) {
      return { ok: false, message: err.message, code: err.code, httpStatus: err.httpStatus };
    }
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return { ok: false, message: msg, code: 'unknown' };
  }
}
