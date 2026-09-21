/**
 * VakilDesk AI metering helpers — Phase C2
 *
 * SERVER-ONLY. Never import from client components or browser code.
 *
 * Usage pattern in each Sarvam route:
 *
 *   const owner   = await resolveOwner(service, user.id);
 *   const est     = estimateStt(audioBlob);          // or estimateText / estimateOcr
 *   const meter   = await reserve(service, owner, user.id, 'stt', est.paise);
 *   if (!meter.ok) return httpErrorFrom(meter);
 *
 *   const result = await transcribeAudio(...);
 *   if (result.ok) {
 *     await settle(service, meter.reserveId, est.paise, est.units);
 *   } else {
 *     await release(service, meter.reserveId);
 *   }
 *
 * Demo users are NEVER metered — gate them before calling reserve().
 * Phase D: update resolveOwner() to support team members sharing the owner's wallet.
 */

if (typeof window !== 'undefined') {
  throw new Error('[ai/metering] This module is SERVER-ONLY.');
}

import { logServerError } from '@/lib/log/serverLog';

// ── Constants ─────────────────────────────────────────────────────────────────

/** STT rate: Rs 30 / hour = 3000p / 3600s */
const STT_PAISE_PER_SECOND = 3000 / 3600; // ≈ 0.8333

/** Translate / transliterate rate: Rs 20 / 10,000 chars = 0.2p / char */
const TEXT_PAISE_PER_CHAR = 2000 / 10_000; // = 0.2

/** OCR rate: Rs 0.5 / page = 50p / page */
const OCR_PAISE_PER_PAGE = 50;

/** Maximum requests per workspace per minute before velocity 429. */
const VELOCITY_LIMIT_PER_MINUTE = 20;

// ── Return types ──────────────────────────────────────────────────────────────

export interface MeterResult {
  ok: true;
  reserveId: string;
  estimatedPaise: number;
}

export interface MeterError {
  ok: false;
  code:
    | 'insufficient_credits'
    | 'wallet_paused'
    | 'daily_cap_exceeded'
    | 'no_wallet'
    | 'invalid_estimate'
    | 'velocity_limit';
  /** Short plain message safe to surface in the UI. */
  message: string;
  /** Suggested HTTP status for the caller to return. */
  httpStatus: number;
}

export type MeterOutcome = MeterResult | MeterError;

export interface Estimate {
  paise: number;
  units: number;
  unitLabel: 'seconds' | 'characters' | 'pages';
}

// ── Workspace owner resolution ────────────────────────────────────────────────

/**
 * Returns the workspace owner ID for the given user.
 * For now every lawyer is their own owner.
 * Phase D will update this to check workspace_members for team seats.
 */
export async function resolveOwner(
  _service: unknown,
  userId: string
): Promise<string> {
  return userId;
}

// ── Developer's own usage (free of wallets, still logged) ─────────────────────

/**
 * The developer pays Sarvam directly, so the developer's own AI use is never charged to a
 * lawyer wallet and never blocked by credits. It IS logged (ledger kind 'internal_usage')
 * so the developer dashboard can show it and the Sarvam balance estimate stays right.
 * reserve() hands back a marker id: internal:<feature>:<userId>:<uuid>.
 */
const INTERNAL_PREFIX = 'internal:';

async function isDeveloperActor(service: any, userId: string): Promise<boolean> {
  try {
    const { data, error } = await service.auth.admin.getUserById(userId);
    if (error || !data?.user) return false;
    // Role comes from app_metadata only (set by the server, never by the user).
    return data.user.app_metadata?.role === 'developer';
  } catch {
    return false; // if in doubt, meter normally
  }
}

// ── Cost estimators ───────────────────────────────────────────────────────────

/**
 * Estimates STT cost from WAV file duration.
 * Reads the WAV header (byte rate + data sub-chunk size) to compute duration.
 * Falls back to file size if the header cannot be parsed cleanly.
 */
export async function estimateStt(audioBlob: Blob): Promise<Estimate> {
  const seconds = await wavDurationSeconds(audioBlob);
  return {
    paise: Math.ceil(seconds * STT_PAISE_PER_SECOND),
    units: seconds,
    unitLabel: 'seconds',
  };
}

/** Estimates translate or transliterate cost from character count. */
export function estimateText(chars: number): Estimate {
  return {
    paise: Math.ceil(chars * TEXT_PAISE_PER_CHAR),
    units: chars,
    unitLabel: 'characters',
  };
}

/** Estimates OCR cost from page count. */
export function estimateOcr(pages: number): Estimate {
  return {
    paise: Math.ceil(pages * OCR_PAISE_PER_PAGE),
    units: pages,
    unitLabel: 'pages',
  };
}

/**
 * Counts pages in a PDF by scanning the raw bytes for /Count N in the page tree.
 * For images (JPEG/PNG) returns 1.
 * Falls back to DOC_AI_MAX_PAGES on parse failure so we over-reserve rather than
 * under-reserve (the unused credit is refunded by ai_settle).
 */
export async function countPdfPages(blob: Blob, docAiMaxPages: number): Promise<number> {
  const mime = blob.type.toLowerCase();
  if (mime.startsWith('image/')) return 1;
  if (!mime.includes('pdf')) return docAiMaxPages;

  // Scan first 100 KB for /Count N (root page tree is almost always here).
  const scanSize = Math.min(blob.size, 100_000);
  try {
    const buf = await blob.slice(0, scanSize).arrayBuffer();
    const text = new TextDecoder('latin1').decode(buf);
    const matches = [...text.matchAll(/\/Count\s+(\d+)/g)];
    if (matches.length > 0) {
      const counts = matches.map((m) => parseInt(m[1], 10)).filter((n) => n > 0 && n < 10_000);
      if (counts.length > 0) {
        return Math.min(Math.max(...counts), docAiMaxPages);
      }
    }
  } catch {
    // If blob read fails, fall through to the safe default.
  }
  return docAiMaxPages;
}

// ── Reserve / settle / release ────────────────────────────────────────────────

/**
 * Atomically reserves AI credits before calling Sarvam.
 * Returns { ok: true, reserveId } on success, or a MeterError on failure.
 *
 * The caller MUST call settle() after a successful Sarvam call, or
 * release() after a failed Sarvam call.
 */
export async function reserve(
  service: any,
  ownerId: string,
  actorUserId: string,
  feature: 'stt' | 'translate' | 'transliterate' | 'ocr',
  estimatedPaise: number
): Promise<MeterOutcome> {
  if (!Number.isFinite(estimatedPaise) || estimatedPaise <= 0) {
    return {
      ok: false,
      code: 'invalid_estimate',
      message: 'Cannot process this request. Check the file and try again.',
      httpStatus: 400,
    };
  }

  // Developer account: free of wallets, but logged (see settle()).
  if (await isDeveloperActor(service, actorUserId)) {
    return {
      ok: true,
      reserveId: `${INTERNAL_PREFIX}${feature}:${actorUserId}:${crypto.randomUUID()}`,
      estimatedPaise,
    };
  }

  // Per-minute velocity check
  try {
    const windowStart = new Date(Date.now() - 60_000).toISOString();
    const { count } = await service
      .from('ai_ledger')
      .select('id', { count: 'exact', head: true })
      .eq('owner_id', ownerId)
      .eq('kind', 'usage')
      .gte('created_at', windowStart);

    if (typeof count === 'number' && count >= VELOCITY_LIMIT_PER_MINUTE) {
      return {
        ok: false,
        code: 'velocity_limit',
        message: 'Too many AI requests. Please wait a moment and try again.',
        httpStatus: 429,
      };
    }
  } catch {
    // Velocity check is best-effort. If the ledger query fails, allow the request
    // through — do not block real work over a monitoring failure.
  }

  const { data, error } = await service.rpc('ai_reserve', {
    p_owner_id: ownerId,
    p_actor_user_id: actorUserId,
    p_feature: feature,
    p_est_paise: estimatedPaise,
  });

  if (error) {
    const msg: string = error.message ?? '';
    return meterErrorFromPg(msg);
  }

  if (!data) {
    return {
      ok: false,
      code: 'insufficient_credits',
      message: 'AI credits finished. Please recharge in Settings.',
      httpStatus: 402,
    };
  }

  return { ok: true, reserveId: data as string, estimatedPaise };
}

/**
 * Finalises a reservation with the actual cost.
 * Call after a SUCCESSFUL Sarvam call.
 * Idempotent — safe to call twice.
 * Errors are logged but never surfaced to the user (the Sarvam call already succeeded).
 */
export async function settle(
  service: any,
  reserveId: string,
  actualPaise: number,
  units?: number
): Promise<void> {
  if (reserveId.startsWith(INTERNAL_PREFIX)) {
    try {
      const [, feature, actorUserId] = reserveId.split(':');
      const { error } = await service.from('ai_ledger').insert({
        owner_id: actorUserId,
        actor_user_id: actorUserId,
        kind: 'internal_usage',
        bucket: 'internal',
        amount_paise: -Math.abs(actualPaise),
        feature,
        units: units ?? null,
        request_ref: 'developer',
      });
      if (error) await logServerError('ai/metering/internal-usage', new Error(error.message), { feature });
    } catch (err) {
      await logServerError('ai/metering/internal-usage', err);
    }
    return;
  }

  try {
    const { error } = await service.rpc('ai_settle', {
      p_reserve_id: reserveId,
      p_actual_paise: actualPaise,
      p_units: units ?? null,
    });
    if (error) {
      await logServerError('ai/metering/settle', new Error(error.message), { reserveId });
    }
  } catch (err) {
    await logServerError('ai/metering/settle', err, { reserveId });
  }
}

/**
 * Releases (fully refunds) a reservation after a Sarvam failure.
 * MUST NOT be called after settle() — once settled, the transaction is closed.
 * Idempotent — safe to call twice.
 */
export async function release(service: any, reserveId: string): Promise<void> {
  if (reserveId.startsWith(INTERNAL_PREFIX)) return; // developer usage: nothing was reserved
  try {
    const { error } = await service.rpc('ai_release', { p_reserve_id: reserveId });
    if (error) {
      await logServerError('ai/metering/release', new Error(error.message), { reserveId });
    }
  } catch (err) {
    await logServerError('ai/metering/release', err, { reserveId });
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Reads a PCM WAV blob and returns the audio duration in seconds.
 * The route handler has already validated this is a real PCM WAV before calling
 * Sarvam, so we can trust the header layout here.
 *
 * Layout (standard 44-byte PCM WAV):
 *   Offset 28: byte rate (uint32 LE) = sample_rate × channels × bits_per_sample / 8
 *   Offset 36: "data" sub-chunk ID
 *   Offset 40: data sub-chunk size (uint32 LE)
 *   Duration = data_size / byte_rate
 *
 * If the "data" chunk is not at offset 36 (e.g. extra LIST chunk), scans
 * the first 256 bytes to locate it.
 */
async function wavDurationSeconds(blob: Blob): Promise<number> {
  const headerSize = Math.min(blob.size, 256);
  let buf: ArrayBuffer;
  try {
    buf = await blob.slice(0, headerSize).arrayBuffer();
  } catch {
    // Blob read failed (should never happen on the server); estimate from file size.
    return blob.size / 32_000; // assume 16-bit mono 16 kHz = 32 KB/s
  }

  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);

  const byteRate = view.getUint32(28, true);
  if (byteRate === 0) return 0;

  const label = (offset: number) =>
    String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);

  // Scan for "data" sub-chunk starting at offset 36
  for (let i = 36; i <= headerSize - 8; i++) {
    if (label(i) === 'data') {
      const dataSize = view.getUint32(i + 4, true);
      return dataSize / byteRate;
    }
  }

  // Fallback: treat everything after the 44-byte header as audio data
  return Math.max(0, (blob.size - 44)) / byteRate;
}

/**
 * Maps a Postgres exception message (from ai_reserve RAISE EXCEPTION) to a MeterError.
 */
function meterErrorFromPg(pgMessage: string): MeterError {
  const m = pgMessage.toLowerCase();

  if (m.includes('insufficient_credits') || m.includes('no_wallet')) {
    return {
      ok: false,
      code: m.includes('no_wallet') ? 'no_wallet' : 'insufficient_credits',
      message: m.includes('no_wallet')
        ? 'You have no AI credits yet. Please recharge in Settings.'
        : 'AI credits finished. Please recharge in Settings.',
      httpStatus: 402,
    };
  }
  if (m.includes('wallet_paused')) {
    return {
      ok: false,
      code: 'wallet_paused',
      message: 'AI credits are paused for your account. Contact support.',
      httpStatus: 403,
    };
  }
  if (m.includes('daily_cap_exceeded')) {
    return {
      ok: false,
      code: 'daily_cap_exceeded',
      message: 'Daily AI usage limit reached. Try again tomorrow.',
      httpStatus: 429,
    };
  }
  if (m.includes('invalid_estimate')) {
    return {
      ok: false,
      code: 'invalid_estimate',
      message: 'Cannot process this request. Check the file and try again.',
      httpStatus: 400,
    };
  }

  // Unknown DB error — treat as 402 to keep the user experience consistent.
  return {
    ok: false,
    code: 'insufficient_credits',
    message: 'AI credits finished. Please recharge in Settings.',
    httpStatus: 402,
  };
}
