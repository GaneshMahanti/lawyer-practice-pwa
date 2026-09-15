import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getRequestUser } from '@/lib/auth/requestUser';
import { isAnonymousUser, isRealAppUser } from '@/lib/supabase/auth';
import { createServiceClient } from '@/lib/supabase/service';
import { extractDocumentText, isSarvamConfigured, DOC_AI_MAX_PAGES } from '@/lib/sarvam';

/**
 * POST /api/ocr/enhanced
 *
 * Server-side OCR powered exclusively by Sarvam Document AI (Sarvam Vision 1.5).
 *
 * Requirements:
 *   1. Sarvam Document AI is the primary OCR provider for scanned images (JPEG/PNG) and PDFs.
 *   2. Zero OpenAI fallback — no silent third-party degradation.
 *   3. If Sarvam is unavailable, returns a clear retryable error state.
 *   4. Demo Mode may use deterministic mock OCR, but authenticated real advocates
 *      with SARVAM_API_KEY NEVER receive demo OCR text.
 *   5. Accepts original PDF, JPEG, and PNG files via multipart/form-data (or JSON base64).
 *   6. Audit metadata only (never logs document text).
 *
 * Response (JSON):
 *   { text: string; warning?: string; provider: 'sarvam_docai' | 'demo_docai'; jobId?: string }
 *   or { error: string }
 */

export async function POST(request: NextRequest) {
  // ── Auth gate ─────────────────────────────────────────────────────────────
  const user = await getRequestUser(request);
  if (!user) {
    return NextResponse.json(
      { error: 'Authentication required. Please sign in.' },
      { status: 401 }
    );
  }

  const isDemo = isAnonymousUser(user);
  const isReal = isRealAppUser(user);

  if (!isDemo && !isReal) {
    return NextResponse.json(
      { error: 'Enhanced Document AI is limited to approved advocates.' },
      { status: 403 }
    );
  }

  const service = createServiceClient() as any;
  const contentType = request.headers.get('content-type') ?? '';

  // ── Route: multipart/form-data (primary path for PDF & image files) ─────────
  if (contentType.includes('multipart/form-data')) {
    return handleMultipartOcr(request, user.id, isDemo, service);
  }

  // ── Route: JSON body (backward compatibility for data URLs) ─────────────────
  return handleJsonOcr(request, user.id, isDemo, service);
}

// ── Multipart form handler ────────────────────────────────────────────────────

async function handleMultipartOcr(
  request: NextRequest,
  userId: string,
  isDemo: boolean,
  service: any
) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid multipart form data.' }, { status: 400 });
  }

  const consent = formData.get('consent');
  if (consent !== 'true') {
    return NextResponse.json(
      { error: 'Explicit advocate consent is required before processing documents with Document AI.' },
      { status: 400 }
    );
  }

  const fileEntry = formData.get('file');
  if (!fileEntry || !(fileEntry instanceof Blob)) {
    return NextResponse.json(
      { error: 'No file provided. Include a "file" field (PDF, JPEG, or PNG) in the form data.' },
      { status: 400 }
    );
  }

  const matterId = typeof formData.get('matterId') === 'string'
    ? (formData.get('matterId') as string)
    : null;

  // 1. Demo Mode: return deterministic mock OCR
  if (isDemo) {
    const demoResult = await extractDocumentText({
      fileBlob: fileEntry,
      isDemoMode: true,
    });
    return NextResponse.json({
      text: demoResult.ok ? demoResult.data.text : '',
      provider: 'demo_docai',
      warning: 'Demo Mode: Deterministic mock extraction. Configure SARVAM_API_KEY in server environment for live Document AI.',
    });
  }

  // 2. Real Advocate: must have SARVAM_API_KEY configured
  if (!isSarvamConfigured()) {
    return NextResponse.json(
      {
        error:
          'SARVAM_API_KEY is not configured on this server. Add SARVAM_API_KEY to server environment variables to enable Document AI extraction.',
      },
      { status: 503 }
    );
  }

  const fileName = fileEntry instanceof File ? fileEntry.name : undefined;

  // Pages limit guard
  let pages: number[] | undefined;
  const pagesRaw = formData.get('pages');
  if (typeof pagesRaw === 'string') {
    try {
      const parsed = JSON.parse(pagesRaw);
      if (Array.isArray(parsed)) {
        pages = parsed.slice(0, DOC_AI_MAX_PAGES).map(Number).filter((n) => !isNaN(n) && n > 0);
      }
    } catch {}
  }

  try {
    const result = await extractDocumentText({
      fileBlob: fileEntry,
      fileName,
      outputFormat: 'md',
      pages,
      isDemoMode: false,
      pollTimeoutMs: 60_000,
    });

    if (!result.ok) {
      // Audit failure metadata only
      try {
        await service.from('external_ocr_audit').insert({
          owner_id: userId,
          matter_id: matterId,
          provider: 'sarvam_docai',
          outcome: 'failure',
        });
      } catch (auditErr) {
        console.warn('[ocr/enhanced] Audit insert warning:', auditErr);
      }

      const httpStatus =
        result.code === 'auth_error' ? 401
        : result.code === 'quota_exhausted' ? 402
        : result.code === 'rate_limited' ? 429
        : result.code === 'validation_error' ? 422
        : result.code === 'timeout' ? 504
        : 502;

      return NextResponse.json(
        { error: result.message, code: result.code, retryable: result.code !== 'auth_error' && result.code !== 'validation_error' },
        { status: httpStatus }
      );
    }

    // Audit success metadata
    try {
      await service.from('external_ocr_audit').insert({
        owner_id: userId,
        matter_id: matterId,
        provider: 'sarvam_docai',
        outcome: 'success',
      });
    } catch (auditErr) {
      console.warn('[ocr/enhanced] Audit insert warning:', auditErr);
    }

    return NextResponse.json({
      text: result.data.text,
      provider: 'sarvam_docai',
      jobId: result.data.jobId,
      warning: '✦ Sarvam Document AI Draft — review against original document before use.',
    });
  } catch (error) {
    console.error('[ocr/enhanced] Sarvam DocAI error:', error);
    try {
      await service.from('external_ocr_audit').insert({
        owner_id: userId,
        matter_id: matterId,
        provider: 'sarvam_docai',
        outcome: 'failure',
      });
    } catch {}

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Document AI extraction failed. Please try again.', retryable: true },
      { status: 500 }
    );
  }
}

// ── JSON body handler (backward compatibility) ────────────────────────────────

async function handleJsonOcr(
  request: NextRequest,
  userId: string,
  isDemo: boolean,
  service: any
) {
  let body: { consent?: unknown; matterId?: unknown; imageBase64?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON request payload' }, { status: 400 });
  }

  if (body.consent !== true) {
    return NextResponse.json(
      { error: 'Explicit advocate consent is required before processing documents with Document AI.' },
      { status: 400 }
    );
  }

  const imageBase64 = typeof body.imageBase64 === 'string' ? body.imageBase64 : null;
  if (!imageBase64) {
    return NextResponse.json(
      { error: 'No image or document data provided for Document AI.' },
      { status: 400 }
    );
  }

  const matterId = typeof body.matterId === 'string' ? body.matterId : null;

  // 1. Demo Mode
  if (isDemo) {
    const demoResult = await extractDocumentText({
      fileBlob: new Blob(['demo']),
      isDemoMode: true,
    });
    return NextResponse.json({
      text: demoResult.ok ? demoResult.data.text : '',
      provider: 'demo_docai',
      warning: 'Demo Mode: Deterministic mock extraction.',
    });
  }

  // 2. Real Advocate
  if (!isSarvamConfigured()) {
    return NextResponse.json(
      {
        error:
          'SARVAM_API_KEY is not configured on this server. Add SARVAM_API_KEY to server environment variables to enable Document AI extraction.',
      },
      { status: 503 }
    );
  }

  try {
    // Decode base64 to Blob for Sarvam DocAI
    let mime = 'image/jpeg';
    let b64 = imageBase64;
    if (imageBase64.startsWith('data:')) {
      const [meta, raw] = imageBase64.split(',');
      const match = meta.match(/data:([^;]+);/);
      if (match) mime = match[1];
      b64 = raw;
    }

    const binaryStr = atob(b64);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: mime });

    const result = await extractDocumentText({
      fileBlob: blob,
      outputFormat: 'md',
      isDemoMode: false,
      pollTimeoutMs: 60_000,
    });

    if (!result.ok) {
      try {
        await service.from('external_ocr_audit').insert({
          owner_id: userId,
          matter_id: matterId,
          provider: 'sarvam_docai',
          outcome: 'failure',
        });
      } catch {}

      return NextResponse.json(
        { error: result.message, code: result.code, retryable: true },
        { status: 502 }
      );
    }

    try {
      await service.from('external_ocr_audit').insert({
        owner_id: userId,
        matter_id: matterId,
        provider: 'sarvam_docai',
        outcome: 'success',
      });
    } catch {}

    return NextResponse.json({
      text: result.data.text,
      provider: 'sarvam_docai',
      jobId: result.data.jobId,
      warning: '✦ Sarvam Document AI Draft — review against original document before use.',
    });
  } catch (error) {
    console.error('[ocr/enhanced] Sarvam DocAI JSON handler error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Document AI extraction failed.', retryable: true },
      { status: 500 }
    );
  }
}
