'use client';

/**
 * Client-side image compression, CANVAS-ONLY (no dependencies).
 *
 * A phone photo of a document is very often 8–15 MB, well over Vercel's hard
 * 4.5 MB request-body limit (see uploadLimits.ts). Rather than let that request
 * fail with a cryptic error, shrink the image in the browser first — legal-document
 * text stays perfectly readable to OCR well below original camera resolution.
 *
 * Downscales the longest edge and re-encodes as JPEG, backing off quality/size
 * until the result fits `maxBytes` or the attempts run out. Never throws: on any
 * failure it returns the original file untouched, so the normal "file too large"
 * message in the caller still applies.
 */

const MAX_DIMENSION_STEPS = [2200, 1800, 1400, 1100];
const QUALITY_STEPS = [0.82, 0.7, 0.55, 0.4];

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read this image.'));
    };
    img.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', quality));
}

/**
 * Compress `file` so it is at or under `maxBytes`, trying progressively smaller
 * dimensions and lower JPEG quality. Returns the original file if it is already
 * small enough, if it is not an image, or if compression could not help enough.
 */
export async function compressImageIfNeeded(file: File, maxBytes: number): Promise<File> {
  if (!file.type.startsWith('image/') || file.size <= maxBytes) return file;

  try {
    const img = await loadImage(file);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;

    for (const maxDim of MAX_DIMENSION_STEPS) {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      for (const quality of QUALITY_STEPS) {
        const blob = await canvasToBlob(canvas, quality);
        if (blob && blob.size <= maxBytes) {
          const name = file.name.replace(/\.[^./]+$/, '') + '.jpg';
          return new File([blob], name, { type: 'image/jpeg', lastModified: Date.now() });
        }
      }
    }
    return file; // could not get small enough — caller's size check will explain why
  } catch {
    return file; // never let a compression bug block the upload path
  }
}
