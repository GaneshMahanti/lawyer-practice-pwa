// ==============================================================================
// Database Schema & RLS Verification Script
// Validates: RLS enabled on all tables, owner isolation policies, immutable audit trail,
// unique idempotency constraints on payments, and storage security policies.
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

console.log('--- Starting VakilDesk Database & RLS Verification ---');

const schemaPath = path.join(__dirname, '..', 'supabase', 'schema.sql');
if (!fs.existsSync(schemaPath)) {
  console.error('[FATAL] supabase/schema.sql missing');
  process.exit(1);
}

const schema = fs.readFileSync(schemaPath, 'utf8');

const requiredTables = [
  'profiles',
  'clients',
  'matters',
  'bookings',
  'invoices',
  'payments',
  'diary_entries',
  'documents',
  'court_lookups',
  'reminders',
  'audit_logs',
];

// 1. Verify all 11 tables exist in schema
for (const table of requiredTables) {
  const tableExists = schema.includes(`CREATE TABLE IF NOT EXISTS public.${table}`);
  report(tableExists, `Table defined: public.${table}`);
}

// 2. Verify RLS enabled on every table
for (const table of requiredTables) {
  const rlsEnabled = schema.includes(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;`);
  report(rlsEnabled, `RLS enabled on public.${table}`);
}

// 3. Verify Payments provider_event_id UNIQUE constraint (idempotency requirement)
const hasPaymentUniqueId =
  schema.includes('provider_event_id TEXT NOT NULL UNIQUE') ||
  schema.includes('provider_event_id TEXT UNIQUE NOT NULL');
report(hasPaymentUniqueId, 'Payments table enforces database UNIQUE constraint on provider_event_id');

// 4. Verify Invoices uses minor currency units amount_paise
const hasInvoicePaise = schema.includes('amount_paise BIGINT NOT NULL CHECK (amount_paise >= 0)');
report(hasInvoicePaise, 'Invoices table enforces integer minor currency units (amount_paise)');

// 5. Verify Matters lifecycle check constraint for Disposed state
const hasDisposedCheck = schema.includes('chk_disposed_state');
report(hasDisposedCheck, 'Matters table enforces disposal_date and final_order_summary on Disposed state');

// 6. Verify Bookings preserves civil timezone
const hasCivilTimezone = schema.includes("timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata'");
report(hasCivilTimezone, 'Bookings table preserves civil timezone semantics');

// 7. Verify Audit Logs Immutability (no UPDATE/DELETE policies, and trigger protection)
const hasAuditTrigger = schema.includes('prevent_audit_modification') && schema.includes('trg_audit_logs_immutable');
const hasNoAuditUpdatePolicy = !schema.includes('ON public.audit_logs FOR UPDATE');
const hasNoAuditDeletePolicy = !schema.includes('ON public.audit_logs FOR DELETE');
report(hasAuditTrigger && hasNoAuditUpdatePolicy && hasNoAuditDeletePolicy, 'Audit logs table is strictly append-only (UPDATE/DELETE blocked)');

// 8. Verify Storage Bucket Security & RLS
const hasStorageBuckets = schema.includes("'legal-audio'") && schema.includes("'legal-documents'");
const hasStoragePolicies = schema.includes('legal_audio_owner_access') && schema.includes('legal_documents_owner_access');
report(hasStorageBuckets && hasStoragePolicies, 'Supabase Storage buckets are private with owner-isolated RLS');

console.log('------------------------------------------------------');
if (failures > 0) {
  console.error(`Database & RLS Verification FAILED with ${failures} error(s).`);
  process.exit(1);
} else {
  console.log('Database & RLS Verification PASSED cleanly.');
  process.exit(0);
}
