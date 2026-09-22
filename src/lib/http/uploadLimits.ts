/**
 * Shared upload-size limits (CLIENT + SERVER safe: no browser-only APIs).
 *
 * Vercel Serverless Functions have a HARD 4.5 MB limit on both the request body
 * and the response body — this cannot be raised from application code. A file
 * that exceeds it never reaches our route: the platform rejects it and returns a
 * short PLAIN TEXT error ("Request Entity Too Large"), not JSON. If the client
 * blindly does `await res.json()` on that, it throws a cryptic parse error
 * ("Unexpected token 'R'...") instead of telling the person what went wrong.
 *
 * Fix, in two layers:
 *   1. Stay under the limit in the first place (this file + compressImage.ts):
 *      refuse/compress on the client before ever sending the request.
 *   2. If a non-JSON response ever comes back anyway, translate it into a plain
 *      message instead of crashing (see fetchJson.ts).
 *
 * MAX_UPLOAD_BYTES is deliberately below Vercel's 4.5 MB ceiling to leave room
 * for multipart boundaries/headers and any base64 inflation (JSON requests).
 */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // 4 MB

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function isOverUploadLimit(bytes: number): boolean {
  return bytes > MAX_UPLOAD_BYTES;
}
