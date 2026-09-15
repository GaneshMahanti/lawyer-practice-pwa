/**
 * Pure Node.js ZIP archive extractor using built-in zlib.
 * Zero external dependencies.
 *
 * Used to extract Markdown and metadata from Sarvam Document AI
 * output ZIP archives delivered via /doc-ai/v1/job/{job_id}/download-url.
 */

import { inflateRawSync } from 'zlib';

export interface ZipEntry {
  filename: string;
  data: Buffer;
  uncompressedSize: number;
}

/**
 * Extracts all files from a ZIP archive buffer.
 * Traverses the Central Directory for reliable file boundaries.
 */
export function extractFilesFromZip(zipBuffer: Buffer | Uint8Array): ZipEntry[] {
  const buf = Buffer.isBuffer(zipBuffer) ? zipBuffer : Buffer.from(zipBuffer);
  const entries: ZipEntry[] = [];

  // Find End of Central Directory Record (EOCD): signature 0x06054b50
  let eocdOffset = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset === -1) {
    // Fallback: try parsing local file headers directly
    return extractFromLocalHeaders(buf);
  }

  const numEntries = buf.readUInt16LE(eocdOffset + 10);
  const cdOffset = buf.readUInt32LE(eocdOffset + 16);

  let cur = cdOffset;
  for (let i = 0; i < numEntries && cur < eocdOffset; i++) {
    if (buf.readUInt32LE(cur) !== 0x02014b50) {
      break;
    }

    const compressionMethod = buf.readUInt16LE(cur + 10);
    const compressedSize = buf.readUInt32LE(cur + 20);
    const uncompressedSize = buf.readUInt32LE(cur + 24);
    const fileNameLen = buf.readUInt16LE(cur + 28);
    const extraLen = buf.readUInt16LE(cur + 30);
    const commentLen = buf.readUInt16LE(cur + 32);
    const localHeaderOffset = buf.readUInt32LE(cur + 42);

    const filename = buf.toString('utf8', cur + 46, cur + 46 + fileNameLen);
    cur += 46 + fileNameLen + extraLen + commentLen;

    // Skip directories
    if (filename.endsWith('/')) continue;

    // Locate data in local header
    if (localHeaderOffset + 30 <= buf.length) {
      const localFileNameLen = buf.readUInt16LE(localHeaderOffset + 26);
      const localExtraLen = buf.readUInt16LE(localHeaderOffset + 28);
      const dataStart = localHeaderOffset + 30 + localFileNameLen + localExtraLen;
      const dataEnd = dataStart + compressedSize;

      if (dataEnd <= buf.length) {
        const compressedData = buf.subarray(dataStart, dataEnd);
        let fileData: Buffer;

        if (compressionMethod === 0) {
          // Stored (no compression)
          fileData = Buffer.from(compressedData);
        } else if (compressionMethod === 8) {
          // DEFLATE
          fileData = inflateRawSync(compressedData);
        } else {
          // Unsupported compression
          continue;
        }

        entries.push({ filename, data: fileData, uncompressedSize });
      }
    }
  }

  return entries;
}

/**
 * Fallback parser using local headers when EOCD is absent/corrupted.
 */
function extractFromLocalHeaders(buf: Buffer): ZipEntry[] {
  const entries: ZipEntry[] = [];
  let pos = 0;

  while (pos + 30 < buf.length) {
    if (buf.readUInt32LE(pos) !== 0x04034b50) {
      pos++;
      continue;
    }

    const compression = buf.readUInt16LE(pos + 8);
    const compSize = buf.readUInt32LE(pos + 18);
    const uncompSize = buf.readUInt32LE(pos + 22);
    const nameLen = buf.readUInt16LE(pos + 26);
    const extraLen = buf.readUInt16LE(pos + 28);

    const name = buf.toString('utf8', pos + 30, pos + 30 + nameLen);
    const dataStart = pos + 30 + nameLen + extraLen;
    const dataEnd = dataStart + compSize;

    if (compSize > 0 && dataEnd <= buf.length && !name.endsWith('/')) {
      try {
        const compressed = buf.subarray(dataStart, dataEnd);
        const data = compression === 8 ? inflateRawSync(compressed) : Buffer.from(compressed);
        entries.push({ filename: name, data, uncompressedSize: uncompSize });
      } catch {}
    }

    pos = compSize > 0 ? dataEnd : dataStart;
  }

  return entries;
}

/**
 * Safely extracts the primary Markdown file from a Sarvam Doc AI output ZIP.
 * Returns the markdown string, or empty string if no markdown file was found.
 */
export function extractMarkdownFromZip(zipBuffer: Buffer | Uint8Array): string {
  const entries = extractFilesFromZip(zipBuffer);

  // 1. Look for .md file
  const mdEntry = entries.find((e) => e.filename.toLowerCase().endsWith('.md'));
  if (mdEntry) {
    return mdEntry.data.toString('utf8').trim();
  }

  // 2. Look for .txt file
  const txtEntry = entries.find((e) => e.filename.toLowerCase().endsWith('.txt'));
  if (txtEntry) {
    return txtEntry.data.toString('utf8').trim();
  }

  // 3. Fallback: look for structured .json if no text/md found
  const jsonEntry = entries.find((e) => e.filename.toLowerCase().endsWith('.json'));
  if (jsonEntry) {
    try {
      const parsed = JSON.parse(jsonEntry.data.toString('utf8'));
      if (typeof parsed?.text === 'string') return parsed.text.trim();
      if (typeof parsed?.output === 'string') return parsed.output.trim();
    } catch {}
  }

  return '';
}
