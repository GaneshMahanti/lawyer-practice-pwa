/**
 * Sarvam AI — Document AI (OCR & Digitisation) Helper
 *
 * SERVER-ONLY. Do not import from client components.
 *
 * Wraps the Sarvam Document AI async job lifecycle:
 *   1. Submit a digitise job (POST /doc-ai/v1/job/digitise)
 *   2. Poll for completion (GET /doc-ai/v1/job/{job_id})
 *   3. Return the extracted text/markdown
 *
 * Supports scanned PDFs, JPEG, and PNG documents in Telugu, Hindi, English,
 * and other Indian languages supported by Sarvam Vision 1.5.
 *
 * Safety limits:
 *   - Max file size: 50 MB
 *   - Max pages processed per request: DOC_AI_MAX_PAGES (10, cost-controlled)
 *   - Max polling duration: DOC_AI_POLL_TIMEOUT_MS (60s)
 *   - Allowed file types: PDF, JPEG, PNG
 *
 * Demo Mode: returns mock extracted text without consuming credits or API calls.
 *
 * Audit note: NEVER log document text content. Only log job metadata.
 */

if (typeof window !== 'undefined') {
  throw new Error('[sarvam/docai] This module is SERVER-ONLY.');
}

import {
  isSarvamConfigured,
  sarvamPostForm,
  sarvamGet,
  SARVAM_DOCAI_MODEL,
  DOC_AI_POLL_TIMEOUT_MS,
  DOC_AI_POLL_INTERVAL_MS,
  DOC_AI_MAX_PAGES,
} from './client';
import type {
  SarvamDocAIJobResponse,
  SarvamDocAIOutputFormat,
  SarvamOutcome,
  SarvamError,
} from './types';

// ── Validation limits ─────────────────────────────────────────────────────────

/** Maximum document file size accepted by Sarvam Doc AI. */
const MAX_FILE_BYTES = 50 * 1024 * 1024;

const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/tiff',
]);

const MIME_TO_EXT: Record<string, string> = {
  'application/pdf': 'document.pdf',
  'image/jpeg': 'image.jpg',
  'image/jpg': 'image.jpg',
  'image/png': 'image.png',
  'image/webp': 'image.webp',
  'image/tiff': 'image.tiff',
};

// ── Demo Mode mock ────────────────────────────────────────────────────────────

const DEMO_EXTRACTED_TEXT = `[Demo — AI Extracted Text Draft]

This is a mock extraction result showing how Sarvam Document AI would process
a scanned legal document. In a real extraction, the text from your uploaded
PDF or image would appear here, including:

• Party names and case numbers
• Court headings and section references
• Dates, amounts, and legal provisions
• Handwritten annotations (where legible)

Configure SARVAM_API_KEY in .env.local to enable real document extraction.

⚠️ AI-extracted text is always a draft — please review against the original document before use.`;

function demoExtraction(): SarvamOutcome<{ text: string; format: string }> {
  return {
    ok: true,
    data: { text: DEMO_EXTRACTED_TEXT, format: 'markdown' },
    requestId: 'demo-docai-mock',
  };
}

// ── Job submission ────────────────────────────────────────────────────────────

export interface DocAIOptions {
  /** Document blob — PDF, JPEG, or PNG. Max 50 MB. */
  fileBlob: Blob;
  fileName?: string;
  outputFormat?: SarvamDocAIOutputFormat;
  /**
   * Specific page numbers to process (1-indexed).
   * Capped at DOC_AI_MAX_PAGES to control cost.
   * If omitted, Sarvam processes the entire document (up to its own limit).
   */
  pages?: number[];
  /** Return mock text without calling Sarvam (demo/anonymous users). */
  isDemoMode?: boolean;
  /** Override polling timeout. Default: 60s. */
  pollTimeoutMs?: number;
}

export type DocAIResult = SarvamOutcome<{ text: string; format: string; jobId?: string }>;

/**
 * Extract text from a scanned document or image using Sarvam Document AI.
 *
 * This is an async job — the helper submits the job and polls until
 * completion or timeout. Returns a SarvamOutcome with the extracted text.
 *
 * ⚠️  Only log job metadata externally — never log the extracted document text.
 */
export async function extractDocumentText(options: DocAIOptions): Promise<DocAIResult> {
  const {
    fileBlob,
    fileName,
    outputFormat = 'markdown',
    pages,
    isDemoMode = false,
    pollTimeoutMs = DOC_AI_POLL_TIMEOUT_MS,
  } = options;

  // ── Demo mode ─────────────────────────────────────────────────────────────
  if (isDemoMode) {
    return demoExtraction();
  }

  // ── Key guard ─────────────────────────────────────────────────────────────
  if (!isSarvamConfigured()) {
    const err: SarvamError = {
      ok: false,
      message:
        'SARVAM_API_KEY is not configured. Add it to .env.local to enable Document AI extraction.',
      code: 'not_configured',
    };
    return err;
  }

  // ── File size validation ───────────────────────────────────────────────────
  if (fileBlob.size > MAX_FILE_BYTES) {
    const sizeMB = (fileBlob.size / (1024 * 1024)).toFixed(1);
    return {
      ok: false,
      message: `Document is too large (${sizeMB} MB). Maximum is 50 MB for AI extraction.`,
      code: 'validation_error',
    };
  }

  // ── MIME type validation ───────────────────────────────────────────────────
  if (fileBlob.type && !ALLOWED_MIME.has(fileBlob.type)) {
    return {
      ok: false,
      message: `File type "${fileBlob.type}" is not supported. Please use PDF, JPEG, or PNG.`,
      code: 'validation_error',
    };
  }

  // ── Page limit guard ───────────────────────────────────────────────────────
  let safePages = pages;
  if (safePages && safePages.length > DOC_AI_MAX_PAGES) {
    safePages = safePages.slice(0, DOC_AI_MAX_PAGES);
    console.warn(
      `[sarvam/docai] pages array trimmed to ${DOC_AI_MAX_PAGES} to control cost. Original: ${pages?.length}`
    );
  }

  // ── Build multipart form ───────────────────────────────────────────────────
  const form = new FormData();
  const resolvedFileName =
    fileName ?? MIME_TO_EXT[fileBlob.type] ?? 'document.pdf';
  form.append('file', fileBlob, resolvedFileName);
  form.append('output_format', outputFormat);

  // Only include model field if explicitly configured — most Doc AI endpoints
  // default to Sarvam Vision 1.5 without needing an explicit model parameter.
  if (SARVAM_DOCAI_MODEL) {
    form.append('model', SARVAM_DOCAI_MODEL);
  }

  if (safePages && safePages.length > 0) {
    form.append('pages', JSON.stringify(safePages));
  }

  // ── Submit digitise job ────────────────────────────────────────────────────
  const submitResult = await sarvamPostForm<SarvamDocAIJobResponse>(
    '/doc-ai/v1/job/digitise',
    form,
    { timeoutMs: 30_000 }
  );

  if (!submitResult.ok) return submitResult;

  const { job_id } = submitResult.data;
  if (!job_id) {
    return {
      ok: false,
      message: 'Sarvam Document AI did not return a job ID. Please try again.',
      code: 'service_error',
    };
  }

  // Log only metadata — never log document content
  console.log(`[sarvam/docai] Job submitted: job_id=${job_id}`);

  // ── Poll for completion ────────────────────────────────────────────────────
  const deadline = Date.now() + pollTimeoutMs;
  let lastStatus: string = 'PENDING';

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, DOC_AI_POLL_INTERVAL_MS));

    const pollResult = await sarvamGet<SarvamDocAIJobResponse>(
      `/doc-ai/v1/job/${job_id}`,
      { timeoutMs: 10_000 }
    );

    if (!pollResult.ok) {
      // Surface polling errors but include the job_id for debugging
      console.error(`[sarvam/docai] Polling error for job_id=${job_id}:`, pollResult.code);
      return pollResult;
    }

    const { status, output, error } = pollResult.data;
    lastStatus = status;

    if (status === 'COMPLETED') {
      console.log(`[sarvam/docai] Job completed: job_id=${job_id}`);
      return {
        ok: true,
        data: {
          text: output ?? '',
          format: outputFormat,
          jobId: job_id,
        },
        requestId: pollResult.requestId,
      };
    }

    if (status === 'FAILED' || status === 'CANCELLED') {
      console.error(`[sarvam/docai] Job ${status}: job_id=${job_id}`);
      return {
        ok: false,
        message:
          error ??
          `Document AI job ${status.toLowerCase()}. Please try again with a cleaner scan.`,
        code: 'service_error',
        httpStatus: undefined,
      };
    }

    // PENDING or IN_PROGRESS — continue polling
  }

  // Timed out
  console.error(
    `[sarvam/docai] Polling timeout after ${pollTimeoutMs / 1000}s: job_id=${job_id}, last_status=${lastStatus}`
  );
  return {
    ok: false,
    message: `Document processing timed out after ${pollTimeoutMs / 1000}s. The document may be too complex. Please try again with fewer pages.`,
    code: 'timeout',
  };
}

// Re-export config constants for use in route handlers
export { DOC_AI_MAX_PAGES, DOC_AI_POLL_TIMEOUT_MS };
