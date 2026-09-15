import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireRealAppUser } from '@/lib/auth/requestUser';
import { createServiceClient } from '@/lib/supabase/service';
import { extractDocumentText, isSarvamConfigured, DOC_AI_MAX_PAGES } from '@/lib/sarvam';

/**
 * POST /api/ocr/enhanced
 *
 * Server-side OCR with Sarvam Document AI as PRIMARY provider.
 * Falls back to OpenAI Vision only when Sarvam is not configured.
 *
 * Security:
 *   - requireRealAppUser blocks demo/anonymous users (consent & auth gate).
 *   - Requires explicit advocate consent (`consent: true` in request body).
 *   - NEVER logs document text content — only metadata in external_ocr_audit.
 *   - API keys stay server-side; never returned in responses or logs.
 *
 * Request (JSON):
 *   {
 *     consent: true,               // Required
 *     matterId?: string | null,    // For audit metadata
 *     imageBase64?: string,        // Base64 data URL for OpenAI Vision fallback (images only)
 *     fileBlob?: never,            // Use /api/ocr/sarvam for direct file upload
 *   }
 *
 * When Sarvam is configured (SARVAM_API_KEY set):
 *   Accepts multipart/form-data with 'file' field (PDF, JPEG, PNG).
 *   Falls back to JSON + imageBase64 for backward compatibility (OpenAI Vision path).
 *
 * Response (JSON):
 *   { text: string; warning?: string; provider: 'sarvam_docai' | 'openai_vision' }
 *   or { error: string }
 */

export async function POST(request: NextRequest) {
  // ── Auth gate ─────────────────────────────────────────────────────────────
  const user = await requireRealAppUser(request);
  if (!user) {
    return NextResponse.json(
      { error: 'Enhanced OCR is limited to approved advocates. Demo Mode cannot use external OCR.' },
      { status: 403 }
    );
  }

  const service = createServiceClient() as any;
  const contentType = request.headers.get('content-type') ?? '';

  // ── Route: multipart/form-data (Sarvam DocAI path) ────────────────────────
  if (contentType.includes('multipart/form-data')) {
    return handleSarvamDocAI(request, user.id, service);
  }

  // ── Route: JSON body (backward-compat path for Documents page) ────────────
  return handleJsonPath(request, user.id, service);
}

// ── Sarvam Document AI handler ────────────────────────────────────────────────

async function handleSarvamDocAI(
  request: NextRequest,
  userId: string,
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
      { error: 'Explicit advocate consent is required before sending a document to enhanced external OCR.' },
      { status: 400 }
    );
  }

  const fileEntry = formData.get('file');
  if (!fileEntry || !(fileEntry instanceof Blob)) {
    return NextResponse.json(
      { error: 'No file provided. Include a "file" field in the multipart form.' },
      { status: 400 }
    );
  }

  if (!isSarvamConfigured()) {
    const demoResult = await extractDocumentText({
      fileBlob: fileEntry,
      isDemoMode: true,
    });
    if (demoResult.ok) {
      return NextResponse.json({
        text: demoResult.data.text,
        provider: 'demo_docai',
        warning:
          'Demo Mode: No SARVAM_API_KEY configured on this server. Add SARVAM_API_KEY to environment variables for live Sarvam Document AI.',
      });
    }

    return NextResponse.json(
      { error: 'SARVAM_API_KEY is not configured. Add it to environment variables.' },
      { status: 503 }
    );
  }

  const matterId = typeof formData.get('matterId') === 'string'
    ? (formData.get('matterId') as string)
    : null;

  const fileName = fileEntry instanceof File ? fileEntry.name : undefined;

  // Pages guard: honour explicit page selection if provided
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
      outputFormat: 'markdown',
      pages,
      isDemoMode: false,
      pollTimeoutMs: 60_000,
    });

    if (!result.ok) {
      // Audit failure metadata — never log text content
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

      return NextResponse.json({ error: result.message }, { status: httpStatus });
    }

    // Audit success metadata — NEVER log extracted text
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
      warning: 'AI-Extracted Text (Draft — review against original document before use).',
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
      { error: error instanceof Error ? error.message : 'Document AI processing failed.' },
      { status: 500 }
    );
  }
}

// ── JSON body path (backward-compat — existing Documents page calls) ──────────

async function handleJsonPath(
  request: NextRequest,
  userId: string,
  service: any
) {
  let body: { consent?: unknown; matterId?: unknown; imageBase64?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request payload' }, { status: 400 });
  }

  if (body.consent !== true) {
    return NextResponse.json(
      { error: 'Explicit advocate consent is required before sending a document to enhanced external OCR.' },
      { status: 400 }
    );
  }

  const imageBase64 = typeof body.imageBase64 === 'string' ? body.imageBase64 : null;
  if (!imageBase64) {
    return NextResponse.json(
      { error: 'No image or document data provided for enhanced OCR.' },
      { status: 400 }
    );
  }

  const matterId = typeof body.matterId === 'string' ? body.matterId : null;

  // ── 1. Try Sarvam DocAI first when available (convert data URL to Blob) ───
  if (isSarvamConfigured() && imageBase64.startsWith('data:')) {
    try {
      const [meta, b64data] = imageBase64.split(',');
      const mimeMatch = meta.match(/data:([^;]+);/);
      const mime = mimeMatch?.[1] ?? 'image/jpeg';

      const byteChars = atob(b64data);
      const byteArr = new Uint8Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) {
        byteArr[i] = byteChars.charCodeAt(i);
      }
      const blob = new Blob([byteArr], { type: mime });

      const sarvamResult = await extractDocumentText({
        fileBlob: blob,
        outputFormat: 'markdown',
        isDemoMode: false,
        pollTimeoutMs: 60_000,
      });

      if (sarvamResult.ok && sarvamResult.data.text) {
        try {
          await service.from('external_ocr_audit').insert({
            owner_id: userId,
            matter_id: matterId,
            provider: 'sarvam_docai',
            outcome: 'success',
          });
        } catch {}
        return NextResponse.json({
          text: sarvamResult.data.text,
          provider: 'sarvam_docai',
          warning: 'AI-Extracted Text (Draft — review against original document before use).',
        });
      }
      // Sarvam failed — fall through to OpenAI
      console.warn('[ocr/enhanced] Sarvam DocAI unavailable, falling back to OpenAI Vision:', !sarvamResult.ok ? sarvamResult.message : 'empty text');
    } catch (err) {
      console.warn('[ocr/enhanced] Sarvam DocAI attempt failed, falling back to OpenAI:', err);
    }
  }

  // ── 2. OpenAI Vision (fallback when Sarvam not configured or failed) ───────
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey === 'your_openai_api_key') {
    const demoResult = await extractDocumentText({
      fileBlob: new Blob(['demo']),
      isDemoMode: true,
    });
    if (demoResult.ok) {
      return NextResponse.json({
        text: demoResult.data.text,
        provider: 'demo_docai',
        warning:
          'Demo Mode: No OCR provider configured on this server. Add SARVAM_API_KEY in environment variables for live Sarvam Document AI.',
      });
    }

    return NextResponse.json(
      { error: 'No OCR provider is configured on this server. Add SARVAM_API_KEY in environment variables.' },
      { status: 503 }
    );
  }

  try {
    const ocrResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content:
              'You are a precise legal document transcription assistant. Transcribe the exact text from the provided image verbatim. Do not summarize, alter, or interpret the legal terminology. Return only the raw extracted text.',
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Transcribe this legal document verbatim:' },
              {
                type: 'image_url',
                image_url: {
                  url: imageBase64.startsWith('data:')
                    ? imageBase64
                    : `data:image/jpeg;base64,${imageBase64}`,
                },
              },
            ],
          },
        ],
        max_tokens: 2000,
      }),
    });

    if (!ocrResponse.ok) {
      throw new Error(`External OCR provider returned error: ${ocrResponse.statusText}`);
    }

    const ocrData = await ocrResponse.json();
    const extractedText = ocrData.choices?.[0]?.message?.content?.trim() || '';

    // Audit metadata ONLY — never stores document contents
    await service.from('external_ocr_audit').insert({
      owner_id: userId,
      matter_id: matterId,
      provider: 'openai_vision',
      outcome: 'success',
    });

    return NextResponse.json({
      text: extractedText,
      provider: 'openai_vision',
      warning: 'Enhanced OCR draft generated. Review and edit the text before translating.',
    });
  } catch (error) {
    console.error('[ocr/enhanced] OpenAI Vision error:', error);
    try {
      await service.from('external_ocr_audit').insert({
        owner_id: userId,
        matter_id: matterId,
        provider: 'openai_vision',
        outcome: 'failure',
      });
    } catch {}
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Enhanced OCR processing failed.' },
      { status: 500 }
    );
  }
}
