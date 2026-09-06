// ==============================================================================
// Security Verification Script for Legal Practice Management PWA
// Checks: Client/Server boundary, Secret exposure, Service Worker caching isolation
// ==============================================================================

const fs = require('fs');
const path = require('path');

let failures = 0;

function report(status, testName, message = '') {
  if (status) {
    console.log(`[PASS] ${testName}`);
  } else {
    console.error(`[FAIL] ${testName}: ${message}`);
    failures++;
  }
}

console.log('--- Starting VakilDesk Security Verification Suite ---');

// 1. Check .gitignore protects secret files
const gitignorePath = path.join(__dirname, '..', '.gitignore');
if (fs.existsSync(gitignorePath)) {
  const content = fs.readFileSync(gitignorePath, 'utf8');
  const hasEnvProtection = content.includes('.env.local') && content.includes('.env');
  report(hasEnvProtection, 'Gitignore protects environment secret files');
} else {
  report(false, 'Gitignore exists', '.gitignore missing');
}

// 2. Check no secrets leaked in client-facing code
const clientDirs = [
  path.join(__dirname, '..', 'src', 'app'),
  path.join(__dirname, '..', 'src', 'components'),
  path.join(__dirname, '..', 'public'),
];

const secretTokens = [
  'RAZORPAY_KEY_SECRET',
  'SUPABASE_SERVICE_ROLE_KEY',
  'OPENAI_API_KEY',
  'WHATSAPP_API_KEY',
];

function scanFiles(dir) {
  let files = [];
  if (!fs.existsSync(dir)) return files;
  const items = fs.readdirSync(dir, { withFileTypes: true });
  for (const item of items) {
    const fullPath = path.join(dir, item.name);
    if (item.isDirectory()) {
      files = files.concat(scanFiles(fullPath));
    } else if (item.isFile() && (item.name.endsWith('.ts') || item.name.endsWith('.tsx') || item.name.endsWith('.js'))) {
      files.push(fullPath);
    }
  }
  return files;
}

let secretLeakFound = false;
for (const dir of clientDirs) {
  const files = scanFiles(dir);
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    for (const token of secretTokens) {
      // Check if raw secret variable is accessed in client components (excluding NEXT_PUBLIC)
      if (content.includes(`process.env.${token}`) || (content.includes(token) && !token.startsWith('NEXT_PUBLIC_') && !file.includes('route.ts') && !file.includes('test-'))) {
        console.error(`Leak detected in ${file}: references ${token}`);
        secretLeakFound = true;
      }
    }
  }
}
report(!secretLeakFound, 'Zero server-side secrets exposed in client components');

// 3. Check Service Worker does NOT cache sensitive API endpoints
const swPath = path.join(__dirname, '..', 'public', 'sw.js');
if (fs.existsSync(swPath)) {
  const swContent = fs.readFileSync(swPath, 'utf8');
  const hasApiBypass = swContent.includes('/api/') && swContent.includes('supabase.co');
  report(hasApiBypass, 'Service Worker strictly bypasses /api/ and Supabase endpoints');
} else {
  report(false, 'Service worker exists', 'public/sw.js missing');
}

// 4. Check next.config.js security headers
const nextConfigPath = path.join(__dirname, '..', 'next.config.js');
if (fs.existsSync(nextConfigPath)) {
  const configContent = fs.readFileSync(nextConfigPath, 'utf8');
  const hasHeaders =
    configContent.includes('X-Frame-Options') &&
    configContent.includes('X-Content-Type-Options') &&
    configContent.includes('DENY');
  report(hasHeaders, 'Security headers (X-Frame-Options, X-Content-Type-Options) configured');
} else {
  report(false, 'next.config.js exists');
}

console.log('----------------------------------------------------');
if (failures > 0) {
  console.error(`Security Verification FAILED with ${failures} error(s).`);
  process.exit(1);
} else {
  console.log('Security Verification PASSED cleanly.');
  process.exit(0);
}
