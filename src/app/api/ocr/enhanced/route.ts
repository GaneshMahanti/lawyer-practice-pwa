import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireRealAppUser } from '@/lib/auth/requestUser';
import { createServiceClient } from '@/lib/supabase/service';

/**
 * Optional enhanced OCR via server-side provider abstraction.
 * - Strictly requires explicit consent and authenticated non-demo lawyer.
 * - Audits metadata only (owner_id, matter_id, provider, outcome) to external_ocr_audit.
 * - NEVER stores document contents or text in audit records.
 * - Never exposes API keys or secrets in the browser.
 */
export async function POST(request: NextRequest) {
  const user = await requireRealAppUser(request);
  if (!user) {
    return NextResponse.json(
      { error: 'Enhanced OCR is limited to approved advocates. Demo Mode cannot use external OCR.' },
      { status: 403 }
    );
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'Enhanced OCR is not configured on this server. Set OPENAI_API_KEY to enable.' },
      { status: 503 }
    );
  }

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

  const service = createServiceClient() as any;
  const matterId = typeof body.matterId === 'string' ? body.matterId : null;

  try {
    // Server-side call to OpenAI Vision
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
            content: 'You are a precise legal document transcription assistant. Transcribe the exact text from the provided image verbatim. Do not summarize, alter, or interpret the legal terminology. Return only the raw extracted text.',
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Transcribe this legal document verbatim:' },
              { type: 'image_url', image_url: { url: imageBase64.startsWith('data:') ? imageBase64 : `data:image/jpeg;base64,${imageBase64}` } },
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
      owner_id: user.id,
      matter_id: matterId,
      provider: 'openai_vision',
      outcome: 'success',
    });

    return NextResponse.json({
      text: extractedText,
      warning: 'Enhanced OCR draft generated. Review and edit the text before translating.',
    });
  } catch (error) {
    console.error('Enhanced OCR processing error:', error);

    // Audit failure metadata
    try {
      await service.from('external_ocr_audit').insert({
        owner_id: user.id,
        matter_id: matterId,
        provider: 'openai_vision',
        outcome: 'failure',
      });
    } catch (auditErr) {
      console.warn('OCR audit insert warning:', auditErr);
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Enhanced OCR processing failed.' },
      { status: 500 }
    );
  }
}
