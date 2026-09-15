/**
 * Browser-side WAV/PCM encoder.
 *
 * CLIENT-ONLY — uses Web Audio API (AudioContext, decodeAudioData).
 *
 * Converts any browser-recorded audio blob (WebM/Opus, OGG, MP4)
 * into a genuine 16-bit mono PCM WAV file that Sarvam STT accepts.
 *
 * The original blob is left untouched so it can still be used for playback.
 */

/** Write a 4-byte little-endian uint32 into a DataView at offset. */
function writeUint32LE(view: DataView, offset: number, value: number) {
  view.setUint32(offset, value, true);
}

/** Write a 2-byte little-endian uint16 into a DataView at offset. */
function writeUint16LE(view: DataView, offset: number, value: number) {
  view.setUint16(offset, value, true);
}

/**
 * Encode Float32 PCM samples into a 16-bit signed PCM WAV Blob.
 *
 * @param samples     Float32Array of mono PCM samples in [-1, 1]
 * @param sampleRate  Sample rate in Hz (e.g. 16000)
 */
export function float32ToWavBlob(samples: Float32Array, sampleRate: number): Blob {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const pcmDataBytes = samples.length * blockAlign;
  const wavHeaderBytes = 44;
  const totalBytes = wavHeaderBytes + pcmDataBytes;

  const buffer = new ArrayBuffer(totalBytes);
  const view = new DataView(buffer);

  // RIFF chunk descriptor
  view.setUint8(0, 0x52); view.setUint8(1, 0x49); view.setUint8(2, 0x46); view.setUint8(3, 0x46); // "RIFF"
  writeUint32LE(view, 4, totalBytes - 8);
  view.setUint8(8, 0x57); view.setUint8(9, 0x41); view.setUint8(10, 0x56); view.setUint8(11, 0x45); // "WAVE"

  // fmt sub-chunk
  view.setUint8(12, 0x66); view.setUint8(13, 0x6d); view.setUint8(14, 0x74); view.setUint8(15, 0x20); // "fmt "
  writeUint32LE(view, 16, 16);      // Subchunk1Size = 16 for PCM
  writeUint16LE(view, 20, 1);       // AudioFormat = 1 (PCM)
  writeUint16LE(view, 22, numChannels);
  writeUint32LE(view, 24, sampleRate);
  writeUint32LE(view, 28, byteRate);
  writeUint16LE(view, 32, blockAlign);
  writeUint16LE(view, 34, bitsPerSample);

  // data sub-chunk
  view.setUint8(36, 0x64); view.setUint8(37, 0x61); view.setUint8(38, 0x74); view.setUint8(39, 0x61); // "data"
  writeUint32LE(view, 40, pcmDataBytes);

  // Convert Float32 → Int16 PCM samples
  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, clamped < 0 ? clamped * 32768 : clamped * 32767, true);
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

/**
 * Decode an audio Blob with Web Audio API and re-encode as 16-bit mono PCM WAV.
 *
 * - Handles WebM/Opus, OGG, MP4 — whatever the browser recorded.
 * - Downmixes to mono (averaging all channels).
 * - Linear-interpolation resample to targetSampleRate.
 * - Compatible with Chrome desktop and mobile Safari 14.1+.
 *
 * @param audioBlob        Any browser-readable audio blob.
 * @param targetSampleRate Output sample rate (default 16 kHz — optimal for Sarvam STT).
 * @returns  A Blob of type 'audio/wav' with a valid RIFF header and 16-bit PCM samples.
 * @throws   If the browser cannot decode the audio or AudioContext is unavailable.
 */
export async function encodeToWav(
  audioBlob: Blob,
  targetSampleRate = 16000,
): Promise<Blob> {
  const arrayBuffer = await audioBlob.arrayBuffer();

  // Use the standard or webkit-prefixed AudioContext
  type WebkitWindow = Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext };
  const AudioCtx = window.AudioContext ?? (window as WebkitWindow).webkitAudioContext;
  if (!AudioCtx) {
    throw new Error('Web Audio API is not supported in this browser. Cannot convert audio for transcription.');
  }

  const ctx = new AudioCtx();
  let decoded: AudioBuffer;
  try {
    decoded = await ctx.decodeAudioData(arrayBuffer.slice(0)); // slice to detach for Safari
  } finally {
    ctx.close();
  }

  const numSamples = decoded.length;
  const sourceRate = decoded.sampleRate;

  // Downmix all channels to mono
  const monoSamples = new Float32Array(numSamples);
  for (let ch = 0; ch < decoded.numberOfChannels; ch++) {
    const channelData = decoded.getChannelData(ch);
    for (let i = 0; i < numSamples; i++) {
      monoSamples[i] += channelData[i];
    }
  }
  if (decoded.numberOfChannels > 1) {
    const inv = 1 / decoded.numberOfChannels;
    for (let i = 0; i < numSamples; i++) {
      monoSamples[i] *= inv;
    }
  }

  // Resample to targetSampleRate using linear interpolation
  let finalSamples: Float32Array;
  if (sourceRate === targetSampleRate) {
    finalSamples = monoSamples;
  } else {
    const ratio = sourceRate / targetSampleRate;
    const outLength = Math.round(numSamples / ratio);
    finalSamples = new Float32Array(outLength);
    for (let i = 0; i < outLength; i++) {
      const srcIdx = i * ratio;
      const lo = Math.floor(srcIdx);
      const hi = Math.min(lo + 1, numSamples - 1);
      const frac = srcIdx - lo;
      finalSamples[i] = monoSamples[lo] * (1 - frac) + monoSamples[hi] * frac;
    }
  }

  return float32ToWavBlob(finalSamples, targetSampleRate);
}
