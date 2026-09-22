'use client';

/**
 * fetchJson — the ONE way client code in this app should call our /api/* routes.
 *
 * Why this exists: `await fetch(url).then(r => r.json())` assumes the server
 * always answers with JSON. It does not:
 *   - A file over Vercel's 4.5 MB limit never reaches our route; the platform
 *     answers with plain text ("Request Entity Too Large"), not JSON.
 *   - A slow AI call can be cut off by the platform's function timeout, which
 *     returns its own HTML/plain error page.
 *   - A network blip, proxy, or ad blocker can return an empty or HTML body.
 * `res.json()` on any of those throws a raw SyntaxError like
 * `Unexpected token 'R', "Request En"... is not valid JSON` straight into the UI —
 * confusing and, worse, it can look like the whole feature is broken rather than
 * "this one file is too large". fetchJson turns every one of these into a short,
 * plain-language message instead, and NEVER throws — the caller just checks `ok`.
 */

export interface FetchJsonResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  /** Plain-language message, always set when ok is false. */
  error: string | null;
  /** Machine code from the JSON body, if the server sent one (e.g. 'insufficient_credits'). */
  code?: string;
}

const DEFAULT_TIMEOUT_MS = 45_000;

function messageForNonJson(status: number, snippet: string): string {
  if (status === 413 || /entity too large/i.test(snippet)) {
    return 'This file is too large to upload. Please use a smaller file (under 4 MB) and try again.';
  }
  if (status === 401) return 'Please sign in again to continue.';
  if (status === 403) return "You don't have access to this. Please contact support if that seems wrong.";
  if (status === 429) return 'Too many requests. Please wait a moment and try again.';
  if (status === 502 || status === 503 || status === 504) {
    return 'The service took too long to respond or is temporarily unavailable. Please try again in a moment.';
  }
  if (status >= 500) return 'Something went wrong on our end. Please try again.';
  return 'Something went wrong talking to the server. Please try again.';
}

/**
 * Calls `input`, safely reading the response as JSON. Never throws.
 *   - Non-JSON response (any status): mapped to a short message via messageForNonJson.
 *   - JSON response with !res.ok: `data.error` (if present) is used as the message.
 *   - Timeout / aborted / network failure: a plain "couldn't reach the server" message.
 */
export async function fetchJson<T = any>(
  input: string,
  init?: RequestInit & { timeoutMs?: number },
): Promise<FetchJsonResult<T>> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...requestInit } = init ?? {};
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(input, { ...requestInit, signal: controller.signal });
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof DOMException && err.name === 'AbortError') {
      return {
        ok: false,
        status: 0,
        data: null,
        error: 'This is taking too long. Please try again with a smaller file, or check your connection.',
      };
    }
    return {
      ok: false,
      status: 0,
      data: null,
      error: 'Could not reach the server. Please check your internet connection and try again.',
    };
  } finally {
    clearTimeout(timer);
  }

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    // Read a small amount of text for status-code disambiguation; never surface it raw.
    let snippet = '';
    try {
      snippet = (await res.text()).slice(0, 200);
    } catch {}
    return { ok: false, status: res.status, data: null, error: messageForNonJson(res.status, snippet) };
  }

  let body: any = null;
  try {
    body = await res.json();
  } catch {
    return {
      ok: false,
      status: res.status,
      data: null,
      error: 'The server sent back something we could not read. Please try again.',
    };
  }

  if (!res.ok) {
    const message =
      typeof body?.error === 'string' && body.error
        ? body.error
        : messageForNonJson(res.status, '');
    return { ok: false, status: res.status, data: body, error: message, code: body?.code };
  }

  return { ok: true, status: res.status, data: body as T, error: null, code: body?.code };
}
