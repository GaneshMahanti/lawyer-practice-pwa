-- ==============================================================================
-- VAKILDESK — COMPLETE ALL-IN-ONE DATABASE SETUP (IDEMPOTENT)
-- Includes: Base Schema (Phase 1) + Phase 2 + Phase 3 (RBAC, Portals, Onboarding)
-- Target: Supabase PostgreSQL SQL Editor
-- Run this single script on a clean or existing Supabase project.
-- ==============================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ------------------------------------------------------------------------------
-- 1. PROFILES (Advocate Workspace Identity & Onboarding)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    display_name TEXT NOT NULL DEFAULT '',
    bar_council_number TEXT,
    office_address TEXT,
    chamber_address TEXT,
    city TEXT,
    state_bar_council TEXT,
    practice_areas TEXT[] DEFAULT '{}',
    phone TEXT,
    preferred_language VARCHAR(5) NOT NULL DEFAULT 'en' CHECK (preferred_language IN ('en', 'hi', 'te')),
    timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    onboarding_completed BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_profiles_user_id ON public.profiles(user_id);

-- Ensure columns exist if table was already created
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS bar_council_number TEXT,
    ADD COLUMN IF NOT EXISTS state_bar_council TEXT,
    ADD COLUMN IF NOT EXISTS chamber_address TEXT,
    ADD COLUMN IF NOT EXISTS city TEXT,
    ADD COLUMN IF NOT EXISTS practice_areas TEXT[] DEFAULT '{}';

-- ------------------------------------------------------------------------------
-- 2. CLIENTS (Provisional & KYC Verified)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.clients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT,
    phone TEXT,
    email TEXT,
    case_reference TEXT,
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('pending', 'active')),
    registration_token TEXT UNIQUE,
    token_expires_at TIMESTAMPTZ,
    aadhaar_last4 VARCHAR(4),
    current_address TEXT,
    permanent_address TEXT,
    phone_2 TEXT,
    whatsapp_opt_in BOOLEAN NOT NULL DEFAULT false,
    whatsapp_opt_in_at TIMESTAMPTZ,
    preferred_language VARCHAR(5) NOT NULL DEFAULT 'en' CHECK (preferred_language IN ('en', 'hi', 'te')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_clients_owner_id ON public.clients(owner_id);
CREATE INDEX IF NOT EXISTS idx_clients_phone ON public.clients(owner_id, phone);
CREATE INDEX IF NOT EXISTS idx_clients_reg_token ON public.clients(registration_token) 
    WHERE registration_token IS NOT NULL;

-- ------------------------------------------------------------------------------
-- 3. CLIENT FEES (Phase 2)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.client_fees (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    fee_type TEXT NOT NULL CHECK (fee_type IN ('consultation', 'legal_notice', 'case_fee')),
    amount NUMERIC NOT NULL CHECK (amount > 0),
    razorpay_link_id TEXT,
    razorpay_link_url TEXT,
    payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'paid', 'cancelled')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_client_fees_client_id ON public.client_fees(client_id);
CREATE INDEX IF NOT EXISTS idx_client_fees_owner_id ON public.client_fees(owner_id);

-- ------------------------------------------------------------------------------
-- 4. MATTERS (Legal Cases with Classification)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.matters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
    matter_number TEXT NOT NULL,
    title TEXT NOT NULL,
    court_name TEXT NOT NULL,
    matter_type TEXT NOT NULL DEFAULT 'Civil',
    case_type TEXT NOT NULL,
    filing_number TEXT,
    cnr_number VARCHAR(16),
    status TEXT NOT NULL DEFAULT 'Intake',
    category TEXT,
    state TEXT NOT NULL DEFAULT 'Andhra Pradesh',
    district TEXT,
    court_complex TEXT,
    case_year INTEGER,
    disposal_date DATE,
    final_order_summary TEXT,
    next_hearing_date TIMESTAMPTZ,
    limitation_date DATE,
    limitation_rule_ref TEXT,
    limitation_review_status TEXT NOT NULL DEFAULT 'pending_review' 
        CHECK (limitation_review_status IN ('pending_review', 'verified', 'manual_override')),
    fee_structure_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT chk_disposed_state CHECK (
        status != 'Disposed/Closed' OR (disposal_date IS NOT NULL AND final_order_summary IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_matters_owner_id ON public.matters(owner_id);
CREATE INDEX IF NOT EXISTS idx_matters_client_id ON public.matters(client_id);
CREATE INDEX IF NOT EXISTS idx_matters_cnr ON public.matters(cnr_number);
CREATE INDEX IF NOT EXISTS idx_matters_next_hearing ON public.matters(owner_id, next_hearing_date);
CREATE INDEX IF NOT EXISTS idx_matters_classification ON public.matters(owner_id, category, district);

-- ------------------------------------------------------------------------------
-- 5. BOOKINGS (Hearings, Consultations & Appointments)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bookings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
    matter_id UUID REFERENCES public.matters(id) ON DELETE SET NULL,
    start_at TIMESTAMPTZ NOT NULL,
    end_at TIMESTAMPTZ,
    timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    purpose TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'adjourned', 'cancelled')),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_bookings_owner_schedule ON public.bookings(owner_id, start_at);
CREATE INDEX IF NOT EXISTS idx_bookings_client_id ON public.bookings(client_id);
CREATE INDEX IF NOT EXISTS idx_bookings_matter_id ON public.bookings(matter_id);

-- ------------------------------------------------------------------------------
-- 6. INVOICES
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
    matter_id UUID REFERENCES public.matters(id) ON DELETE SET NULL,
    invoice_number TEXT NOT NULL,
    description TEXT NOT NULL,
    amount_paise BIGINT NOT NULL CHECK (amount_paise >= 0),
    due_at TIMESTAMPTZ,
    invoice_status TEXT NOT NULL DEFAULT 'draft' 
        CHECK (invoice_status IN ('draft', 'issued', 'partially_paid', 'paid', 'cancelled', 'written_off')),
    razorpay_payment_link_id TEXT,
    razorpay_payment_link_url TEXT,
    payment_link_status TEXT NOT NULL DEFAULT 'uncreated' 
        CHECK (payment_link_status IN ('uncreated', 'created', 'partially_paid', 'paid', 'expired', 'cancelled')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_invoices_owner_id ON public.invoices(owner_id);
CREATE INDEX IF NOT EXISTS idx_invoices_client_id ON public.invoices(client_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON public.invoices(owner_id, invoice_status);

-- ------------------------------------------------------------------------------
-- 7. PAYMENTS
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
    invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
    amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
    razorpay_payment_id TEXT,
    razorpay_payment_link_id TEXT,
    payment_status TEXT NOT NULL DEFAULT 'captured' 
        CHECK (payment_status IN ('captured', 'failed', 'refunded')),
    paid_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    provider_event_id TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_payments_owner_id ON public.payments(owner_id);
CREATE INDEX IF NOT EXISTS idx_payments_invoice_id ON public.payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_payments_client_id ON public.payments(client_id);

-- ------------------------------------------------------------------------------
-- 8. DIARY ENTRIES (Voice Notes & Rich Digital Journal)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.diary_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
    matter_id UUID REFERENCES public.matters(id) ON DELETE SET NULL,
    entry_type TEXT NOT NULL DEFAULT 'voice' CHECK (entry_type IN ('voice', 'text')),
    title TEXT,
    content TEXT,
    audio_storage_path TEXT,
    transcript TEXT,
    transcription_status TEXT NOT NULL DEFAULT 'recorded' 
        CHECK (transcription_status IN ('recorded', 'transcribing', 'completed', 'failed')),
    transcription_model TEXT,
    language VARCHAR(5),
    duration_seconds INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_diary_entries_owner_id ON public.diary_entries(owner_id);
CREATE INDEX IF NOT EXISTS idx_diary_entries_matter_id ON public.diary_entries(matter_id);

-- ------------------------------------------------------------------------------
-- 9. DOCUMENTS
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
    matter_id UUID REFERENCES public.matters(id) ON DELETE SET NULL,
    template_id TEXT NOT NULL,
    template_version TEXT NOT NULL,
    title TEXT NOT NULL,
    file_storage_path TEXT NOT NULL,
    form_data_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    statutory_basis TEXT,
    generated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_documents_owner_id ON public.documents(owner_id);
CREATE INDEX IF NOT EXISTS idx_documents_matter_id ON public.documents(matter_id);

-- ------------------------------------------------------------------------------
-- 10. COURT LOOKUPS
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.court_lookups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
    matter_id UUID REFERENCES public.matters(id) ON DELETE SET NULL,
    cnr_number VARCHAR(16) NOT NULL,
    provider TEXT NOT NULL,
    result_status TEXT NOT NULL DEFAULT 'pending' 
        CHECK (result_status IN ('pending', 'success', 'failed')),
    last_result_json JSONB,
    checked_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_court_lookups_owner_id ON public.court_lookups(owner_id);
CREATE INDEX IF NOT EXISTS idx_court_lookups_cnr ON public.court_lookups(cnr_number);

-- ------------------------------------------------------------------------------
-- 11. REMINDERS
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.reminders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    booking_id UUID REFERENCES public.bookings(id) ON DELETE CASCADE,
    matter_id UUID REFERENCES public.matters(id) ON DELETE SET NULL,
    channel TEXT NOT NULL CHECK (channel IN ('in_app', 'whatsapp')),
    scheduled_for TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' 
        CHECK (status IN ('pending', 'sent', 'failed', 'cancelled')),
    sent_at TIMESTAMPTZ,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    provider_message_id TEXT,
    template_name TEXT,
    template_language VARCHAR(5),
    idempotency_key TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_reminders_owner_status ON public.reminders(owner_id, status, scheduled_for);

-- ------------------------------------------------------------------------------
-- 12. AUDIT LOGS (Append-Only Immutable Trail)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    action TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id UUID NOT NULL,
    metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    outcome TEXT NOT NULL DEFAULT 'success' CHECK (outcome IN ('success', 'failure')),
    ip_hash TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_owner ON public.audit_logs(owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON public.audit_logs(resource_type, resource_id);

CREATE OR REPLACE FUNCTION public.prevent_audit_modification()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Audit logs are immutable. UPDATE and DELETE operations are strictly prohibited.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_logs_immutable ON public.audit_logs;
CREATE TRIGGER trg_audit_logs_immutable
BEFORE UPDATE OR DELETE ON public.audit_logs
FOR EACH ROW EXECUTE FUNCTION public.prevent_audit_modification();

-- ------------------------------------------------------------------------------
-- 13. APPROVED USERS (Phase 3 RBAC Allowlist Table)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.approved_users (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email       TEXT NOT NULL UNIQUE,
    role        TEXT NOT NULL CHECK (role IN ('developer', 'lawyer')),
    name        TEXT,
    is_active   BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Deny all direct access to anon and authenticated clients
REVOKE ALL ON public.approved_users FROM PUBLIC, anon, authenticated;
ALTER TABLE public.approved_users ENABLE ROW LEVEL SECURITY;

-- Seed developer and initial lawyer
INSERT INTO public.approved_users (email, role, name, is_active)
VALUES 
    ('mahanti9988@gmail.com', 'developer', 'Ganesh Mahanti (Developer)', true),
    ('testuser@gmail.com', 'lawyer', 'Test Advocate', true)
ON CONFLICT (email) DO UPDATE 
SET role = EXCLUDED.role, is_active = EXCLUDED.is_active, updated_at = now();

-- ------------------------------------------------------------------------------
-- 14. CLIENT PORTAL INVITES & SUBMISSIONS (Phase 3)
-- ------------------------------------------------------------------------------
DO $$ BEGIN
    CREATE TYPE portal_invite_status AS ENUM (
        'pending', 
        'submitted', 
        'payment_pending', 
        'completed', 
        'revoked', 
        'expired'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS public.portal_invites (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    token_hash      TEXT NOT NULL UNIQUE,
    status          portal_invite_status NOT NULL DEFAULT 'pending',
    advocate_name   TEXT NOT NULL,
    client_name     TEXT,
    client_id       UUID REFERENCES public.clients(id) ON DELETE SET NULL,
    fee_snapshot    JSONB NOT NULL DEFAULT '[]',
    expires_at      TIMESTAMPTZ NOT NULL,
    revoked_at      TIMESTAMPTZ,
    submitted_at    TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_portal_invites_token ON public.portal_invites(token_hash);
CREATE INDEX IF NOT EXISTS idx_portal_invites_status ON public.portal_invites(status);
CREATE INDEX IF NOT EXISTS idx_portal_invites_owner ON public.portal_invites(owner_id);

CREATE TABLE IF NOT EXISTS public.portal_submissions (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invite_id         UUID NOT NULL REFERENCES public.portal_invites(id) ON DELETE CASCADE,
    owner_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name              TEXT NOT NULL,
    phone_1           TEXT NOT NULL,
    phone_2           TEXT,
    aadhaar_last4     VARCHAR(4) NOT NULL,
    current_address   TEXT NOT NULL,
    permanent_address TEXT NOT NULL,
    submitted_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_portal_submissions_invite ON public.portal_submissions(invite_id);
CREATE INDEX IF NOT EXISTS idx_portal_submissions_owner ON public.portal_submissions(owner_id);

-- ------------------------------------------------------------------------------
-- 15. ROW LEVEL SECURITY (RLS) POLICIES (Idempotent)
-- ------------------------------------------------------------------------------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_fees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diary_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.court_lookups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_owner_access" ON public.profiles;
CREATE POLICY "profiles_owner_access" ON public.profiles
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "clients_owner_access" ON public.clients;
CREATE POLICY "clients_owner_access" ON public.clients
    FOR ALL USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "client_fees_owner_access" ON public.client_fees;
CREATE POLICY "client_fees_owner_access" ON public.client_fees
    FOR ALL USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "matters_owner_access" ON public.matters;
CREATE POLICY "matters_owner_access" ON public.matters
    FOR ALL USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "bookings_owner_access" ON public.bookings;
CREATE POLICY "bookings_owner_access" ON public.bookings
    FOR ALL USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "invoices_owner_access" ON public.invoices;
CREATE POLICY "invoices_owner_access" ON public.invoices
    FOR ALL USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "payments_owner_access" ON public.payments;
CREATE POLICY "payments_owner_access" ON public.payments
    FOR ALL USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "diary_entries_owner_access" ON public.diary_entries;
CREATE POLICY "diary_entries_owner_access" ON public.diary_entries
    FOR ALL USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "documents_owner_access" ON public.documents;
CREATE POLICY "documents_owner_access" ON public.documents
    FOR ALL USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "court_lookups_owner_access" ON public.court_lookups;
CREATE POLICY "court_lookups_owner_access" ON public.court_lookups
    FOR ALL USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "reminders_owner_access" ON public.reminders;
CREATE POLICY "reminders_owner_access" ON public.reminders
    FOR ALL USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "audit_logs_owner_select" ON public.audit_logs;
CREATE POLICY "audit_logs_owner_select" ON public.audit_logs
    FOR SELECT USING (auth.uid() = owner_id);

DROP POLICY IF EXISTS "audit_logs_owner_insert" ON public.audit_logs;
CREATE POLICY "audit_logs_owner_insert" ON public.audit_logs
    FOR INSERT WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "portal_invites_owner_policy" ON public.portal_invites;
CREATE POLICY "portal_invites_owner_policy" ON public.portal_invites
    FOR ALL USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "portal_submissions_owner_policy" ON public.portal_submissions;
CREATE POLICY "portal_submissions_owner_policy" ON public.portal_submissions
    FOR SELECT USING (auth.uid() = owner_id);

-- ------------------------------------------------------------------------------
-- 16. STORAGE BUCKETS SETUP (Private)
-- ------------------------------------------------------------------------------
DO $$ BEGIN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES 
        ('legal-audio', 'legal-audio', false, 26214400, ARRAY['audio/webm', 'audio/mp4', 'audio/wav', 'audio/ogg']),
        ('legal-documents', 'legal-documents', false, 10485760, ARRAY['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
    ON CONFLICT (id) DO UPDATE SET 
        public = false,
        file_size_limit = EXCLUDED.file_size_limit,
        allowed_mime_types = EXCLUDED.allowed_mime_types;
EXCEPTION
    WHEN others THEN null;
END $$;

DO $$ BEGIN
    DROP POLICY IF EXISTS "legal_audio_owner_access" ON storage.objects;
    CREATE POLICY "legal_audio_owner_access" ON storage.objects
        FOR ALL USING (
            bucket_id = 'legal-audio' AND (storage.foldername(name))[1] = auth.uid()::text
        )
        WITH CHECK (
            bucket_id = 'legal-audio' AND (storage.foldername(name))[1] = auth.uid()::text
        );
EXCEPTION
    WHEN others THEN null;
END $$;

DO $$ BEGIN
    DROP POLICY IF EXISTS "legal_documents_owner_access" ON storage.objects;
    CREATE POLICY "legal_documents_owner_access" ON storage.objects
        FOR ALL USING (
            bucket_id = 'legal-documents' AND (storage.foldername(name))[1] = auth.uid()::text
        )
        WITH CHECK (
            bucket_id = 'legal-documents' AND (storage.foldername(name))[1] = auth.uid()::text
        );
EXCEPTION
    WHEN others THEN null;
END $$;

-- =============================================================================
-- PHASE 5: Demo isolation, reminder prefs, OCR audit, hearing bookings,
-- practice-active clients, diary transcript provenance, privileged locks.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.demo_workspaces (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    reset_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.reminder_preferences (
    owner_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    offsets_minutes INTEGER[] NOT NULL DEFAULT ARRAY[1440, 120],
    in_app_enabled BOOLEAN NOT NULL DEFAULT true,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT reminder_offsets_valid CHECK (
      cardinality(offsets_minutes) > 0
      AND cardinality(offsets_minutes) <= 5
      AND offsets_minutes <@ ARRAY[15,30,60,120,1440,2880,10080]
    )
);

CREATE TABLE IF NOT EXISTS public.external_ocr_audit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    matter_id UUID REFERENCES public.matters(id) ON DELETE SET NULL,
    provider TEXT NOT NULL,
    outcome TEXT NOT NULL CHECK (outcome IN ('success', 'failure')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS is_practice_active BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE public.diary_entries
  ADD COLUMN IF NOT EXISTS original_transcript TEXT,
  ADD COLUMN IF NOT EXISTS edited_transcript TEXT,
  ADD COLUMN IF NOT EXISTS transcript_edited_at TIMESTAMPTZ;

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS original_text TEXT,
  ADD COLUMN IF NOT EXISTS translated_text TEXT,
  ADD COLUMN IF NOT EXISTS image_url TEXT;

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';

DO $$ BEGIN
  ALTER TABLE public.bookings
    ADD CONSTRAINT bookings_source_check CHECK (source IN ('manual', 'matter_hearing'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_matter_hearing
  ON public.bookings(owner_id, matter_id)
  WHERE source = 'matter_hearing' AND matter_id IS NOT NULL;

ALTER TABLE public.demo_workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reminder_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.external_ocr_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "demo_workspace_owner_access" ON public.demo_workspaces;
CREATE POLICY "demo_workspace_owner_access" ON public.demo_workspaces
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "reminder_preferences_owner_access" ON public.reminder_preferences;
CREATE POLICY "reminder_preferences_owner_access" ON public.reminder_preferences
  FOR ALL USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "external_ocr_audit_owner_access" ON public.external_ocr_audit;
CREATE POLICY "external_ocr_audit_owner_access" ON public.external_ocr_audit
  FOR SELECT USING (auth.uid() = owner_id);

-- Anonymous sessions may never touch portal, payments, or the allowlist.
DROP POLICY IF EXISTS "portal_invites_owner_policy" ON public.portal_invites;
CREATE POLICY "portal_invites_owner_policy" ON public.portal_invites
  FOR ALL
  USING (auth.uid() = owner_id AND COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false) IS NOT TRUE)
  WITH CHECK (auth.uid() = owner_id AND COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false) IS NOT TRUE);

DROP POLICY IF EXISTS "portal_submissions_owner_policy" ON public.portal_submissions;
CREATE POLICY "portal_submissions_owner_policy" ON public.portal_submissions
  FOR SELECT
  USING (auth.uid() = owner_id AND COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false) IS NOT TRUE);

DROP POLICY IF EXISTS "invoices_owner_access" ON public.invoices;
CREATE POLICY "invoices_owner_access" ON public.invoices
  FOR ALL
  USING (auth.uid() = owner_id AND COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false) IS NOT TRUE)
  WITH CHECK (auth.uid() = owner_id AND COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false) IS NOT TRUE);

DROP POLICY IF EXISTS "payments_owner_access" ON public.payments;
CREATE POLICY "payments_owner_access" ON public.payments
  FOR ALL
  USING (auth.uid() = owner_id AND COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false) IS NOT TRUE)
  WITH CHECK (auth.uid() = owner_id AND COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false) IS NOT TRUE);

REVOKE ALL ON public.approved_users FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.prevent_demo_whatsapp_reminders()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false) IS TRUE AND NEW.channel = 'whatsapp' THEN
    RAISE EXCEPTION 'whatsapp reminders are not available in demo mode';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_demo_whatsapp ON public.reminders;
CREATE TRIGGER trg_prevent_demo_whatsapp
BEFORE INSERT OR UPDATE ON public.reminders
FOR EACH ROW EXECUTE FUNCTION public.prevent_demo_whatsapp_reminders();

-- Bookings remain the calendar source of truth for hearing dates.
CREATE OR REPLACE FUNCTION public.sync_matter_hearing_booking()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NEW.owner_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'owner mismatch';
  END IF;

  IF NEW.status = 'Disposed/Closed' OR NEW.next_hearing_date IS NULL THEN
    UPDATE public.bookings
      SET status = 'cancelled', updated_at = now()
      WHERE owner_id = NEW.owner_id
        AND matter_id = NEW.id
        AND source = 'matter_hearing'
        AND status = 'scheduled';
  ELSE
    UPDATE public.bookings
      SET
        client_id = NEW.client_id,
        start_at = NEW.next_hearing_date,
        end_at = NEW.next_hearing_date + interval '1 hour',
        purpose = COALESCE(NULLIF(NEW.title, ''), 'Court hearing'),
        status = 'scheduled',
        notes = 'Hearing derived from matter next court date',
        updated_at = now()
      WHERE owner_id = NEW.owner_id
        AND matter_id = NEW.id
        AND source = 'matter_hearing';

    IF NOT FOUND THEN
      INSERT INTO public.bookings (
        owner_id, client_id, matter_id, start_at, end_at, timezone, purpose, status, notes, source
      ) VALUES (
        NEW.owner_id,
        NEW.client_id,
        NEW.id,
        NEW.next_hearing_date,
        NEW.next_hearing_date + interval '1 hour',
        'Asia/Kolkata',
        COALESCE(NULLIF(NEW.title, ''), 'Court hearing'),
        'scheduled',
        'Hearing derived from matter next court date',
        'matter_hearing'
      );
    END IF;
  END IF;

  UPDATE public.clients
    SET
      case_reference = NEW.matter_number,
      is_practice_active = CASE
        WHEN NEW.status = 'Disposed/Closed' AND NOT EXISTS (
          SELECT 1 FROM public.matters m
          WHERE m.client_id = NEW.client_id
            AND m.owner_id = NEW.owner_id
            AND m.id IS DISTINCT FROM NEW.id
            AND m.status IS DISTINCT FROM 'Disposed/Closed'
        ) THEN false
        ELSE true
      END,
      updated_at = now()
    WHERE id = NEW.client_id AND owner_id = NEW.owner_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_matter_hearing_booking ON public.matters;
CREATE TRIGGER trg_sync_matter_hearing_booking
AFTER INSERT OR UPDATE OF next_hearing_date, status, title, client_id, matter_number
ON public.matters
FOR EACH ROW EXECUTE FUNCTION public.sync_matter_hearing_booking();

CREATE OR REPLACE FUNCTION public.reset_demo_workspace()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  demo_id UUID := auth.uid();
  sample_client UUID := gen_random_uuid();
  sample_matter UUID := gen_random_uuid();
BEGIN
  IF demo_id IS NULL OR COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'demo access required';
  END IF;

  INSERT INTO public.demo_workspaces(user_id) VALUES (demo_id)
  ON CONFLICT (user_id) DO UPDATE SET reset_at = now();

  DELETE FROM public.reminders WHERE owner_id = demo_id;
  DELETE FROM public.bookings WHERE owner_id = demo_id;
  DELETE FROM public.diary_entries WHERE owner_id = demo_id;
  DELETE FROM public.documents WHERE owner_id = demo_id;
  DELETE FROM public.court_lookups WHERE owner_id = demo_id;
  DELETE FROM public.client_fees WHERE owner_id = demo_id;
  DELETE FROM public.matters WHERE owner_id = demo_id;
  DELETE FROM public.clients WHERE owner_id = demo_id;
  DELETE FROM public.profiles WHERE user_id = demo_id;
  DELETE FROM public.reminder_preferences WHERE owner_id = demo_id;

  INSERT INTO public.profiles(user_id, display_name, preferred_language, timezone, onboarding_completed)
    VALUES (demo_id, 'Demo Advocate', 'en', 'Asia/Kolkata', true);
  INSERT INTO public.clients(id, owner_id, name, phone, email, case_reference, notes, status, is_practice_active, preferred_language)
    VALUES (sample_client, demo_id, 'Asha Rao (Sample)', '9000000001', 'asha@example.test', 'DEMO 12/2026', 'Fictional demo client.', 'active', true, 'en');
  INSERT INTO public.matters(
    id, owner_id, client_id, matter_number, title, court_name, matter_type, case_type, category, status, next_hearing_date, state, district, court_complex, case_year
  ) VALUES (
    sample_matter, demo_id, sample_client, 'CC 12/2026', 'Sample Consumer Matter',
    'Demo District Court Complex, Visakhapatnam', 'Consumer', 'Consumer Complaint', 'Consumer', 'Active',
    now() + interval '7 days', 'Andhra Pradesh', 'Visakhapatnam', 'Visakhapatnam District Court Complex', EXTRACT(YEAR FROM now())::int
  );
  INSERT INTO public.diary_entries(owner_id, client_id, matter_id, entry_type, title, content, transcript, transcription_status, language)
    VALUES (demo_id, sample_client, sample_matter, 'text', 'Sample diary note', 'Review fictional consumer matter before hearing.', 'Review fictional consumer matter before hearing.', 'completed', 'en');
  INSERT INTO public.reminder_preferences(owner_id) VALUES (demo_id)
    ON CONFLICT (owner_id) DO UPDATE SET offsets_minutes = ARRAY[1440,120], in_app_enabled = true, updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.seed_demo_workspace()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  demo_id UUID := auth.uid();
BEGIN
  IF demo_id IS NULL OR COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'demo access required';
  END IF;

  IF EXISTS (SELECT 1 FROM public.demo_workspaces WHERE user_id = demo_id) THEN
    RETURN;
  END IF;

  PERFORM public.reset_demo_workspace();
END;
$$;

REVOKE ALL ON FUNCTION public.reset_demo_workspace() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.seed_demo_workspace() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reset_demo_workspace() TO authenticated;
GRANT EXECUTE ON FUNCTION public.seed_demo_workspace() TO authenticated;
