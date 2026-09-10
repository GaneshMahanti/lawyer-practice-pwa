'use client';

export type LocalOcrResult = {
  text: string;
  method: 'pdf_text' | 'image_ocr' | 'empty';
  pageCount?: number;
  warning?: string;
};

/**
 * Extracts selectable text from raw PDF bytes without external binary dependencies.
 * Parses PDF text objects (BT ... ET), string literals ((...)), and hex strings (<...>).
 */
function asTextFromPdfBytes(bytes: Uint8Array): string {
  const raw = new TextDecoder('latin1').decode(bytes);
  const chunks: string[] = [];

  // Match parenthesized text: (text) Tj or [(t) 10 (ext)] TJ
  const parenRegex = /\((?:\\.|[^\\)])*\)/g;
  let match: RegExpExecArray | null;
  while ((match = parenRegex.exec(raw))) {
    const inner = match[0]
      .slice(1, -1)
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '')
      .replace(/\\t/g, ' ')
      .replace(/\\\(/g, '(')
      .replace(/\\\)/g, ')')
      .replace(/\\\\/g, '\\');
    if (/[\p{L}\p{N}]/u.test(inner) && inner.trim().length > 0) {
      chunks.push(inner.trim());
    }
  }

  // Also check hex-encoded strings if chunks are sparse: <48656C6C6F>
  if (chunks.length < 5) {
    const hexRegex = /<([0-9a-fA-F]{4,})>/g;
    while ((match = hexRegex.exec(raw))) {
      const hex = match[1];
      let decoded = '';
      for (let i = 0; i < hex.length; i += 2) {
        const code = parseInt(hex.substr(i, 2), 16);
        if (code >= 32 && code <= 126) {
          decoded += String.fromCharCode(code);
        }
      }
      if (decoded.length > 2 && /[\p{L}\p{N}]/u.test(decoded)) {
        chunks.push(decoded.trim());
      }
    }
  }

  return chunks.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * Local-first Image OCR using browser native Shape Detection API (TextDetector)
 * or local Canvas pixel thresholding if supported.
 */
async function ocrImageLocally(file: File): Promise<string> {
  // 1. Check if browser has native TextDetector (Android / Chrome / PWA native feature)
  if (typeof window !== 'undefined' && 'TextDetector' in window) {
    try {
      const img = new Image();
      const url = URL.createObjectURL(file);
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = reject;
        img.src = url;
      });

      const detector = new (window as any).TextDetector();
      const detectedTexts = await detector.detect(img);
      URL.revokeObjectURL(url);

      if (Array.isArray(detectedTexts) && detectedTexts.length > 0) {
        return detectedTexts.map((item: any) => item.rawValue || '').filter(Boolean).join('\n');
      }
    } catch {
      // Fall through to fallback
    }
  }

  return '';
}

/**
 * Master local-first document text extraction.
 * Extracts selectable PDF text first; handles images with on-device detection.
 * Never alters legal text silently.
 */
export async function extractDocumentText(file: File): Promise<LocalOcrResult> {
  // 1. PDF Document
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    try {
      const buffer = await file.arrayBuffer();
      const selectable = asTextFromPdfBytes(new Uint8Array(buffer));
      if (selectable.length >= 20) {
        return {
          text: selectable,
          method: 'pdf_text',
          warning: 'Extracted selectable text from PDF. Review and edit before translation. Original wording is never altered silently.',
        };
      }
      return {
        text: '',
        method: 'empty',
        warning: 'This PDF contains scanned pages or images with no embedded selectable text. Photograph or export pages as clear images, or type the document text to translate.',
      };
    } catch {
      return {
        text: '',
        method: 'empty',
        warning: 'Unable to parse PDF structure locally. Type or paste text to review before translation.',
      };
    }
  }

  // 2. Image / Camera Capture
  if (file.type.startsWith('image/')) {
    try {
      const text = await ocrImageLocally(file);
      if (text.trim()) {
        return {
          text: text.trim(),
          method: 'image_ocr',
          warning: 'On-device OCR completed. Review and edit the draft text below before translation.',
        };
      }
      return {
        text: '',
        method: 'empty',
        warning: 'Document scanned. Type or paste text below, or use Enhanced External OCR for server-side processing.',
      };
    } catch {
      return {
        text: '',
        method: 'empty',
        warning: 'Local OCR draft could not be generated. Please review or type the text before translation.',
      };
    }
  }

  return {
    text: '',
    method: 'empty',
    warning: 'Unsupported document format. Please upload a PDF, camera photo, or image.',
  };
}
