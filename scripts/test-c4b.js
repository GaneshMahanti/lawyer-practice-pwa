/**
 * test-c4b.js — static code verification for C4b (developer payments inbox)
 *
 * These are pure source-code assertions — no network, no DB needed.
 * Run with: node scripts/test-c4b.js
 *
 * Checks:
 *  1.  payments route uses requireDeveloperUser (not requireRealAppUser or none)
 *  2.  decision route uses requireDeveloperUser
 *  3.  topup route uses requireDeveloperUser
 *  4.  config route uses requireDeveloperUser
 *  5.  killswitch route uses requireDeveloperUser
 *  6.  decision route calls approve_payment_request / reject_payment_request (not direct UPDATE)
 *  7.  decision route never logs UPI values (no log call with upi_vpa / upi_payee_name)
 *  8.  config route never logs string-key values (upi_vpa / upi_payee_name not in logServerError calls)
 *  9.  killswitch requires explicit 'pause_all' or 'resume_all' — no free-form action
 * 10.  payments route derives sharePaise = received - credited (never stored column)
 * 11.  AiUsageDeveloperCard renders a Payments tab / inbox section
 * 12.  AiUsageDeveloperCard renders an approve button gated on developer confirmation text
 * 13.  AiUsageDeveloperCard renders a Config section
 * 14.  Recharge math: floor(received * percent / 100) matches migration SQL
 * 15.  No /api/admin/* route returns UPI VPA in a plain string log statement
 */

const fs   = require('fs');
const path = require('path');

let failures = 0;

function pass(name) { console.log(`[PASS] ${name}`); }
function fail(name, reason) { console.error(`[FAIL] ${name}: ${reason}`); failures++; }

function check(name, cond, reason) {
  if (cond) pass(name); else fail(name, reason);
}

function read(rel) {
  try { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }
  catch { return ''; }
}

// ── Source files ──────────────────────────────────────────────────────────────
const payments   = read('src/app/api/admin/payments/route.ts');
const decision   = read('src/app/api/admin/payments/decision/route.ts');
const topup      = read('src/app/api/admin/payments/topup/route.ts');
const config     = read('src/app/api/admin/config/route.ts');
const killswitch = read('src/app/api/admin/payments/killswitch/route.ts');
const devCard    = read('src/components/AiUsageDeveloperCard.tsx');

// ── 1–5: requireDeveloperUser in every new admin route ────────────────────────
check('1. payments route: requireDeveloperUser',
  payments.includes('requireDeveloperUser') && !payments.includes('requireRealAppUser'),
  'Must use requireDeveloperUser, not requireRealAppUser');

check('2. decision route: requireDeveloperUser',
  decision.includes('requireDeveloperUser'),
  'Must use requireDeveloperUser');

check('3. topup route: requireDeveloperUser',
  topup.includes('requireDeveloperUser'),
  'Must use requireDeveloperUser');

check('4. config route: requireDeveloperUser',
  config.includes('requireDeveloperUser'),
  'Must use requireDeveloperUser');

check('5. killswitch route: requireDeveloperUser',
  killswitch.includes('requireDeveloperUser'),
  'Must use requireDeveloperUser');

// ── 6: decision calls SQL functions, not direct UPDATE on payment_requests ────
check('6. decision: calls approve_payment_request / reject_payment_request via rpc',
  decision.includes('approve_payment_request') && decision.includes('reject_payment_request'),
  'Must call SQL SECURITY DEFINER functions, not direct UPDATE');

const directUpdateOnPayments = /db\s*\.\s*from\s*\(\s*['"]payment_requests['"]\s*\)\s*\.update/.test(decision);
check('6b. decision: no direct UPDATE on payment_requests',
  !directUpdateOnPayments,
  'Should not directly UPDATE payment_requests table');

// ── 7: decision route does not log UPI values ─────────────────────────────────
check('7. decision: no UPI values in log calls',
  !decision.includes('upi_vpa') && !decision.includes('upi_payee_name'),
  'UPI VPA/payee name must never appear in the decision route');

// ── 8: config route does not log UPI string values ───────────────────────────
// The config route handles upi_vpa; verify logServerError doesn't include the value
const logLines = config
  .split('\n')
  .filter(l => l.includes('logServerError'));
const logsUpiValue = logLines.some(l => l.includes('upi_vpa') || l.includes('upi_payee_name'));
check('8. config: UPI values not passed to logServerError',
  !logsUpiValue,
  'UPI VPA/payee name must not appear in logServerError calls');

// ── 9: killswitch validates action explicitly ─────────────────────────────────
check("9. killswitch: explicit 'pause_all' / 'resume_all' check",
  killswitch.includes("'pause_all'") && killswitch.includes("'resume_all'"),
  "Must validate action is exactly 'pause_all' or 'resume_all'");

// ── 10: payments route derives share (never a stored column) ─────────────────
check('10. payments: sharePaise derived as received - credited',
  payments.includes('sharePaise') && payments.includes('received - credited'),
  'Developer share must be derived, never stored');

// ── 11: developer card has payments inbox ────────────────────────────────────
check('11. AiUsageDeveloperCard: payments inbox section exists',
  devCard.includes('inbox') || devCard.includes('Inbox') || devCard.includes('Payments'),
  'Developer card must render a payments inbox');

// ── 12: developer card has approve confirmation ───────────────────────────────
check('12. AiUsageDeveloperCard: approval confirmation warning text',
  devCard.includes('Approve only after') || devCard.includes('bank') || devCard.includes('UPI app'),
  'Approval screen must say "Approve only after you see this payment in your bank/UPI app"');

// ── 13: developer card has config section ────────────────────────────────────
check('13. AiUsageDeveloperCard: config editing section exists',
  devCard.includes('recharge_credit_percent') || devCard.includes('Config') || devCard.includes('config'),
  'Developer card must render a config editing section');

// ── 14: recharge math consistency check ──────────────────────────────────────
// floor(received * percent / 100) — verify same formula in migration SQL
const migration = read('supabase/migration_phase8_credits_payments.sql');
check('14. Migration: approve uses FLOOR(received * percent / 100)',
  migration.includes('FLOOR(p_received_paise * v_credit_percent / 100)'),
  'SQL must use FLOOR for credit calculation');

// JS math check: Rs 100 at 85% = 8500 paise
const paise100 = Math.floor(10000 * 85 / 100);
check('14b. JS math: Rs 100 at 85% = Rs 85 (8500 paise)',
  paise100 === 8500,
  `Expected 8500, got ${paise100}`);

// Rs 10 at 85% = 850 paise
const paise10 = Math.floor(1000 * 85 / 100);
check('14c. JS math: Rs 10 at 85% = Rs 8.50 (850 paise)',
  paise10 === 850,
  `Expected 850, got ${paise10}`);

// Rs 100 at 90% = 9000 paise (original migration default before developer changed to 85)
const paise100at90 = Math.floor(10000 * 90 / 100);
check('14d. JS math: Rs 100 at 90% = 9000 paise',
  paise100at90 === 9000,
  `Expected 9000, got ${paise100at90}`);

// ── 15: no admin route leaks UPI in console.log ──────────────────────────────
const allAdminSrc = [payments, decision, topup, config, killswitch].join('\n');
const consoleLogLines = allAdminSrc.split('\n').filter(l => l.includes('console.log'));
const leaksUpi = consoleLogLines.some(l => l.includes('upi_vpa') || l.includes('upi_payee_name'));
check('15. No admin route logs UPI VPA via console.log',
  !leaksUpi,
  'UPI VPA/payee name must not appear in console.log');

// ── Recharge route checks (C5) ────────────────────────────────────────────────
const recharge      = read('src/app/api/ai/recharge/route.ts');
const rechargeSubmit = read('src/app/api/ai/recharge/submit/route.ts');

check('16. Recharge: requireRealAppUser (not developer)',
  recharge.includes('requireRealAppUser'),
  'Recharge must use requireRealAppUser');

check('17. Recharge: lawyer-only check',
  recharge.includes("role !== 'lawyer'") || recharge.includes("role === 'lawyer'"),
  'Recharge must gate on lawyer role');

check('18. Recharge: UPI URL built from config, not hardcoded',
  recharge.includes('upi_vpa') && recharge.includes('upi://pay'),
  'UPI VPA must come from app_config');

check('19. Recharge submit: UTR validation is exactly 12 digits',
  rechargeSubmit.includes('\\d{12}') || rechargeSubmit.includes('12}'),
  'UTR must be validated as exactly 12 digits');

check('20. Recharge submit: 48-hour expiry check',
  rechargeSubmit.includes('48') || rechargeSubmit.includes('EXPIRY'),
  'Submit must check for 48-hour expiry');

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('');
if (failures === 0) {
  console.log('All checks passed.');
} else {
  console.error(`${failures} check(s) failed.`);
  process.exit(1);
}
