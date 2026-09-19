/**
 * Server-only error logger.
 *
 * Users only ever see a short, friendly message. The real error goes here:
 *   - Always: one JSON line to stderr (terminal locally, Vercel Runtime Logs in production).
 *   - Always (best effort): a row in the `error_logs` table, readable from the developer dashboard.
 *   - Locally only (not on Vercel): also appended to ./logs/app-errors.log.
 *     Vercel's filesystem is read-only/ephemeral, so a file is not possible there.
 *
 * `await` this in request handlers: on Vercel a function can be frozen right after it
 * responds, which would drop an un-awaited database write.
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
const DB_WRITE_TIMEOUT_MS = 1500;

async function writeToDatabase(scope: string, message: string, context: Record<string, unknown>) {
  try {
    const { createServiceClient } = await import('@/lib/supabase/service');
    const db = createServiceClient() as any;
    await db.from('error_logs').insert({
      scope: scope.slice(0, 120),
      message: message.slice(0, 500),
      context,
    });
  } catch {
    // Logging must never break a request (table may not exist yet, or no service key).
  }
}

export async function logServerError(
  scope: string,
  error: unknown,
  context: Record<string, unknown> = {},
): Promise<void> {
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

  const tasks: Promise<unknown>[] = [
    Promise.race([
      writeToDatabase(scope, err.message, context),
      new Promise((resolve) => setTimeout(resolve, DB_WRITE_TIMEOUT_MS)),
    ]),
  ];

  // Vercel has no writable persistent disk; runtime logs and the database row cover it.
  if (!process.env.VERCEL) {
    tasks.push(
      mkdir(LOG_DIR, { recursive: true })
        .then(() => appendFile(LOG_FILE, line + '\n'))
        .catch(() => {}),
    );
  }

  await Promise.all(tasks);
}
