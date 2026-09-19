/**
 * Server-only error logger.
 *
 * Users only ever see a short, friendly message. The real error goes here:
 *   - Always: one JSON line to stderr (visible in the terminal locally and in
 *     Vercel -> Project -> Logs -> Runtime Logs in production).
 *   - Locally only (not on Vercel): also appended to ./logs/app-errors.log.
 *     Vercel's filesystem is read-only/ephemeral, so a file is not possible there.
 *
 * PRIVACY: never put document text, transcripts, client details, tokens or API
 * keys in `context`. IDs, error codes, sizes and counts only.
 */

if (typeof window !== 'undefined') {
  throw new Error('[serverLog] This module is SERVER-ONLY.');
}

import { appendFile, mkdir } from 'fs/promises';
import path from 'path';

const LOG_DIR = path.join(process.cwd(), 'logs');
const LOG_FILE = path.join(LOG_DIR, 'app-errors.log');

export function logServerError(
  scope: string,
  error: unknown,
  context: Record<string, unknown> = {},
): void {
  const err = error instanceof Error ? error : new Error(String(error));
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level: 'error',
    scope,
    message: err.message,
    stack: err.stack ? err.stack.split('\n').slice(0, 6).join('\n') : undefined,
    context,
  });

  console.error(line);

  // Vercel has no writable persistent disk; runtime logs already capture the line above.
  if (process.env.VERCEL) return;

  void mkdir(LOG_DIR, { recursive: true })
    .then(() => appendFile(LOG_FILE, line + '\n'))
    .catch(() => {
      // Logging must never break a request.
    });
}
