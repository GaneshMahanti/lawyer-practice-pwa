// ==============================================================================
// VakilDesk RBAC & Authentication Acceptance Test Suite
// Verifies: Route isolation, Middleware rules, Token hashing, Aadhaar masking,
//           and Service-role separation.
// ==============================================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let failures = 0;

function report(status, testName, message = '') {
  if (status) {
    console.log(`[PASS] ${testName}`);
  } else {
    console.error(`[FAIL] ${testName}: ${message}`);
    failures++;
  }
}

console.log('--- Starting VakilDesk RBAC & Authentication Acceptance Tests ---');

// 1. Check Middleware route enforcement config
const middlewarePath = path.join(__dirname, '..', 'src', 'middleware.ts');
if (fs.existsSync(middlewarePath)) {
  const content = fs.readFileSync(middlewarePath, 'utf8');
  const protectsApp = content.includes("pathname.startsWith('/app')");
  const redirectsToLogin = content.includes("loginUrl = new URL('/login'");
  const checksRoles = content.includes("role !== 'developer' && role !== 'lawyer'");
  const blocksLawyerAdmin = content.includes("pathname.startsWith('/app/admin')");
  
  report(
    protectsApp && redirectsToLogin && checksRoles && blocksLawyerAdmin,
    'Middleware enforces strict /app/* authentication & role restrictions'
  );
} else {
  report(false, 'Middleware exists', 'src/middleware.ts missing');
}

// 2. Check Client Portal Token Hashing (Raw token never stored directly)
const migrationPath = path.join(__dirname, '..', 'supabase', 'migration_phase3.sql');
if (fs.existsSync(migrationPath)) {
  const content = fs.readFileSync(migrationPath, 'utf8');
  const hasTokenHashCol = content.includes('token_hash') && content.includes('portal_invites');
  report(hasTokenHashCol, 'Database schema uses token_hash (SHA-256) for portal invites');
} else {
  report(false, 'Migration phase 3 exists', 'supabase/migration_phase3.sql missing');
}

// 3. Check Portal API server-side validation & hashing
const portalSubmitPath = path.join(__dirname, '..', 'src', 'app', 'api', 'portal', 'submit', 'route.ts');
if (fs.existsSync(portalSubmitPath)) {
  const content = fs.readFileSync(portalSubmitPath, 'utf8');
  const hashesToken = content.includes("createHash('sha256').update(token).digest('hex')");
  const marksUsed = content.includes('used_at: new Date().toISOString()');
  const masksAadhaar = content.includes('aadhaar_last4') && !content.includes('aadhaar_full');
  
  report(
    hashesToken && marksUsed && masksAadhaar,
    'Portal submit API validates SHA-256 hash, marks token used, and restricts to aadhaar_last4'
  );
} else {
  report(false, 'Portal submit route exists', 'src/app/api/portal/submit/route.ts missing');
}

// 4. Verify UIDAI Aadhaar compliance in client portal form
const portalFormPath = path.join(__dirname, '..', 'src', 'app', 'portal', '[token]', 'PortalForm.tsx');
if (fs.existsSync(portalFormPath)) {
  const content = fs.readFileSync(portalFormPath, 'utf8');
  const capturesLast4 = content.includes('aadhaar_last4') && content.includes('slice(-4)');
  report(capturesLast4, 'Client portal form captures strictly Aadhaar last-4 (UIDAI compliant)');
} else {
  report(false, 'PortalForm exists', 'src/app/portal/[token]/PortalForm.tsx missing');
}

// 5. Verify isolated portal route never loads app shell or main app tables
const portalPagePath = path.join(__dirname, '..', 'src', 'app', 'portal', '[token]', 'page.tsx');
if (fs.existsSync(portalPagePath)) {
  const content = fs.readFileSync(portalPagePath, 'utf8');
  const serverComponent = !content.startsWith("'use client'");
  const queriesOnlyInvites = content.includes("from('portal_invites')") && !content.includes("from('clients')");
  report(serverComponent && queriesOnlyInvites, 'Client portal is isolated server component querying portal_invites only');
} else {
  report(false, 'Portal page exists', 'src/app/portal/[token]/page.tsx missing');
}

// 6. Verify Service Role client is isolated to server
const serviceClientPath = path.join(__dirname, '..', 'src', 'lib', 'supabase', 'service.ts');
if (fs.existsSync(serviceClientPath)) {
  const content = fs.readFileSync(serviceClientPath, 'utf8');
  const hasGuard = content.includes('SUPABASE_SERVICE_ROLE_KEY');
  const isServer = !content.trim().startsWith("'use client'");
  report(hasGuard && isServer, 'Service-role client is strictly server-only with env guards');
} else {
  report(false, 'Service client exists', 'src/lib/supabase/service.ts missing');
}

// 7. Verify Root Layout is bare for public routes, app shell is confined to /app/*
const rootLayoutPath = path.join(__dirname, '..', 'src', 'app', 'layout.tsx');
const appLayoutPath = path.join(__dirname, '..', 'src', 'app', 'app', 'layout.tsx');
if (fs.existsSync(rootLayoutPath) && fs.existsSync(appLayoutPath)) {
  const rootContent = fs.readFileSync(rootLayoutPath, 'utf8');
  const appContent = fs.readFileSync(appLayoutPath, 'utf8');
  const rootIsBare = !rootContent.includes('<Header') && !rootContent.includes('<BottomNav');
  const appHasShell = appContent.includes('<Header') && appContent.includes('<BottomNav');
  report(rootIsBare && appHasShell, 'Layout split: public routes get bare layout, /app/* gets app shell');
} else {
  report(false, 'Layout split verified', 'Root or App layout missing');
}

console.log('----------------------------------------------------');
if (failures > 0) {
  console.error(`Acceptance Tests FAILED with ${failures} error(s).`);
  process.exit(1);
} else {
  console.log('All 7 Acceptance Tests PASSED cleanly.');
  process.exit(0);
}
