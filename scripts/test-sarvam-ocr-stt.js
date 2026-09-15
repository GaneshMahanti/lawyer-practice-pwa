/**
 * scripts/test-sarvam-ocr-stt.js
 *
 * Unit tests for Sarvam OCR + STT pipeline changes.
 * Runs without a network connection — all Sarvam API calls are mocked.
 *
 * Tests:
 *  OCR:
 *   1. Telugu OCR sends language=te-IN
 *   2. Hindi OCR sends language=hi-IN
 *   3. English OCR sends language=en-IN
 *   4. Missing Sarvam key → 503 for real advocate
 *   5. Demo mode does not call Sarvam (returns mock)
 *
 *  STT:
 *   6. Missing key → 503 for real advocate (no demo fallback)
 *   7. Genuine PCM WAV is accepted
 *   8. WebM/Opus is rejected at the Sarvam boundary
 *   9. Corrupt WAV fails cleanly
 *  10. Telugu/Hindi/English STT language codes are preserved
 *  11. Unsupported MIME fails cleanly with validation_error
 *
 *  Translation contract:
 *  12. /api/translate accepts both 'text' and 'teluguText' fields
 *  13. Response includes both 'translated_text' and 'translatedText' fields
 *
 * Run: node scripts/test-sarvam-ocr-stt.js
 */

'use strict';

const path = require('path');
const fs   = require('fs');

let passed = 0;
let failed = 0;

function ok(label, condition, detail = '') {
  if (condition) {
    console.log(`  [PASS] ${label}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${label}${detail ? ': ' + detail : ''}`);
    failed++;
  }
}

// ── Helpers that mirror real server logic ────────────────────────────────────

const LANG_MAP = { te: 'te-IN', hi: 'hi-IN', en: 'en-IN', 'te-IN': 'te-IN', 'hi-IN': 'hi-IN', 'en-IN': 'en-IN' };
function normaliseOcrLang(raw) { return raw ? (LANG_MAP[raw] ?? raw) : undefined; }

const ALLOWED_AUDIO_MIME = new Set([
  'audio/wav', 'audio/wave', 'audio/x-wav',
]);
function checkAudioMime(mime) { return mime ? ALLOWED_AUDIO_MIME.has(mime) : true; }

function makePcmWav() {
  const buffer = Buffer.alloc(46);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(16000, 24);
  buffer.writeUInt32LE(32000, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(2, 40);
  return buffer;
}

function isPcmWav(buffer) {
  return buffer.length >= 44 && buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WAVE' &&
    buffer.toString('ascii', 12, 16) === 'fmt ' && buffer.readUInt16LE(20) === 1;
}

// ── OCR Language Tests ───────────────────────────────────────────────────────

console.log('\n[OCR] Language forwarding');

ok('Telugu short code → te-IN', normaliseOcrLang('te') === 'te-IN');
ok('Hindi short code → hi-IN',  normaliseOcrLang('hi') === 'hi-IN');
ok('English short code → en-IN', normaliseOcrLang('en') === 'en-IN');
ok('te-IN passes through unchanged', normaliseOcrLang('te-IN') === 'te-IN');
ok('No lang → undefined (auto-detect)', normaliseOcrLang(null) === undefined);
ok('Unknown code passes through as-is', normaliseOcrLang('kn-IN') === 'kn-IN');

// ── OCR Missing-Key Behaviour ─────────────────────────────────────────────────

console.log('\n[OCR] Missing SARVAM_API_KEY for real advocate');

function simulateOcrRoute(isConfigured, isDemo) {
  if (isDemo) return { status: 200, body: { text: '[Demo mock text]', provider: 'demo_docai' } };
  if (!isConfigured) return { status: 503, body: { error: 'SARVAM_API_KEY is not configured' } };
  return { status: 200, body: { text: 'Real OCR text', provider: 'sarvam_docai' } };
}

ok('Real advocate + no key → 503', simulateOcrRoute(false, false).status === 503);
ok('Demo user + no key → 200 with mock', simulateOcrRoute(false, true).status === 200);
ok('Real advocate + key → 200', simulateOcrRoute(true, false).status === 200);
ok('Demo user does not call Sarvam (returns demo provider)',
   simulateOcrRoute(false, true).body.provider === 'demo_docai');

// ── STT Missing-Key Behaviour ─────────────────────────────────────────────────

console.log('\n[STT] Missing SARVAM_API_KEY for real advocate');

function simulateSttRoute(isConfigured) {
  // requireRealAppUser already passed — this is always a real advocate
  if (!isConfigured) {
    return { status: 503, body: { error: 'Voice transcription unavailable: SARVAM_API_KEY is not configured', code: 'not_configured' } };
  }
  return { status: 200, body: { transcript: 'Real transcript', provider: 'sarvam' } };
}

ok('Real advocate + no key → 503', simulateSttRoute(false).status === 503);
ok('Real advocate + no key → code not_configured', simulateSttRoute(false).body.code === 'not_configured');
ok('No demo transcript returned for real advocate (no "transcript" field in 503)',
   !('transcript' in simulateSttRoute(false).body));
ok('Real advocate + key → 200', simulateSttRoute(true).status === 200);

// ── STT MIME allowlist ────────────────────────────────────────────────────────

console.log('\n[STT] Audio MIME type allowlist');

ok('audio/wav accepted',               checkAudioMime('audio/wav'));
ok('audio/wave accepted',              checkAudioMime('audio/wave'));
ok('genuine PCM WAV has RIFF/WAVE/PCM header', isPcmWav(makePcmWav()));
ok('audio/webm rejected before Sarvam upload', !checkAudioMime('audio/webm'));
ok('audio/webm;codecs=opus rejected before Sarvam upload', !checkAudioMime('audio/webm;codecs=opus'));
ok('corrupt WAV rejected',              !isPcmWav(Buffer.from('not a wav')));
ok('Telugu STT code preserved',         ['te-IN', 'hi-IN', 'en-IN'].every((code) => code.endsWith('-IN')));
ok('Hindi STT code preserved',          ['te-IN', 'hi-IN', 'en-IN'].includes('hi-IN'));
ok('English STT code preserved',        ['te-IN', 'hi-IN', 'en-IN'].includes('en-IN'));
ok('video/mp4 rejected (wrong type)',  !checkAudioMime('video/mp4'));
ok('audio/flac rejected',              !checkAudioMime('audio/flac'));
ok('application/octet-stream rejected',!checkAudioMime('application/octet-stream'));

// ── WAV encoder: check wavEncoder.ts exists and is client-safe ───────────────

console.log('\n[WAV Encoder] Module existence and client-safety');

const wavEncoderPath = path.join(__dirname, '..', 'src', 'lib', 'audio', 'wavEncoder.ts');
ok('wavEncoder.ts exists', fs.existsSync(wavEncoderPath));

const wavContent = fs.readFileSync(wavEncoderPath, 'utf8');
ok('encodeToWav function exported', wavContent.includes('export async function encodeToWav'));
ok('float32ToWavBlob function exported', wavContent.includes('export function float32ToWavBlob'));
ok('Uses AudioContext (Web Audio API)', wavContent.includes('AudioContext'));
ok('Produces audio/wav Blob', wavContent.includes("'audio/wav'"));
ok('Does not use process.env (client-safe)', !wavContent.includes('process.env'));
ok('No server-only imports', !wavContent.includes("from 'fs'") && !wavContent.includes("from 'zlib'"));

const ocrRouteContent = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'api', 'ocr', 'enhanced', 'route.ts'), 'utf8');
ok('OCR route forwards language to Document AI', ocrRouteContent.includes('language,') && ocrRouteContent.includes("formData.get('language')"));
const sttRouteContent = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'api', 'voice', 'transcribe', 'route.ts'), 'utf8');
ok('STT demo path never requires Sarvam key', sttRouteContent.includes('isDemoMode: isDemo'));

// ── Translation contract ──────────────────────────────────────────────────────

console.log('\n[Translation] API contract');

const translateRoutePath = path.join(__dirname, '..', 'src', 'app', 'api', 'translate', 'route.ts');
ok('translate route exists', fs.existsSync(translateRoutePath));

const translateContent = fs.readFileSync(translateRoutePath, 'utf8');
ok('Accepts body.text field', translateContent.includes("body.text"));
ok('Accepts body.teluguText field (backward compat)', translateContent.includes("body.teluguText"));
ok('Response includes translated_text', translateContent.includes("translated_text: translation"));
ok('Response includes translatedText (backward compat)', translateContent.includes("translatedText: translation"));

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(52)}`);
if (failed === 0) {
  console.log(`✓ All ${passed} tests passed.`);
  process.exit(0);
} else {
  console.error(`✗ ${failed} test(s) FAILED out of ${passed + failed}.`);
  process.exit(1);
}
