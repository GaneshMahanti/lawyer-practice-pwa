-- ==============================================================================
-- LEGAL PRACTICE MANAGEMENT PWA — COMPLETE DATABASE SCHEMA & AUTHORIZATION
-- Target: Supabase PostgreSQL
-- ==============================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ------------------------------------------------------------------------------
-- 1. PROFILES (Advocate Workspace Identity)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    display_name TEXT NOT NULL,
    bar_council_number TEXT,
    office_address TEXT,
    phone TEXT,
    preferred_language VARCHAR(5) NOT NULL DEFAULT 'en' CHECK (preferred_language IN ('en', 'hi', 'te')),
    timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_profiles_user_id ON public.profiles(user_id);

-- ------------------------------------------------------------------------------
-- 2. CLIENTS
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.clients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    email TEXT,
    case_reference TEXT,
    notes TEXT,
    whatsapp_opt_in BOOLEAN NOT NULL DEFAULT false,
    whatsapp_opt_in_at TIMESTAMPTZ,
    preferred_language VARCHAR(5) NOT NULL DEFAULT 'en' CHECK (preferred_language IN ('en', 'hi', 'te')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_clients_owner_id ON public.clients(owner_id);
CREATE INDEX IF NOT EXISTS idx_clients_phone ON public.clients(owner_id, phone);

-- ------------------------------------------------------------------------------
-- 3. MATTERS (Legal Cases with Extensible Workflow States)
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

-- ------------------------------------------------------------------------------
-- 4. BOOKINGS (Hearings, Consultations & Client Appointments)
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
-- 5. INVOICES (Minor Currency Units: amount_paise)
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
-- 6. PAYMENTS (Database-Enforced Webhook Idempotency)
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
    provider_event_id TEXT NOT NULL UNIQUE, -- Crucial for webhook idempotency
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_payments_owner_id ON public.payments(owner_id);
CREATE INDEX IF NOT EXISTS idx_payments_invoice_id ON public.payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_payments_client_id ON public.payments(client_id);

-- ------------------------------------------------------------------------------
-- 7. DIARY ENTRIES (Voice Notes with Audio in Storage)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.diary_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
    matter_id UUID REFERENCES public.matters(id) ON DELETE SET NULL,
    audio_storage_path TEXT, -- Stored in private 'legal-audio' bucket
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
-- 8. DOCUMENTS (Generated Court Forms with Version Tracking)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
    matter_id UUID REFERENCES public.matters(id) ON DELETE SET NULL,
    template_id TEXT NOT NULL,
    template_version TEXT NOT NULL,
    title TEXT NOT NULL,
    file_storage_path TEXT NOT NULL, -- Stored in private 'legal-documents' bucket
    form_data_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    statutory_basis TEXT,
    generated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_documents_owner_id ON public.documents(owner_id);
CREATE INDEX IF NOT EXISTS idx_documents_matter_id ON public.documents(matter_id);

-- ------------------------------------------------------------------------------
-- 9. COURT LOOKUPS (On-Demand User-Triggered CNR Inquiries)
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
-- 10. REMINDERS (Idempotent Message Dispatch Queue)
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
-- 11. AUDIT LOGS (Append-Only Immutable Trail, No UPDATE/DELETE)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    action TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id UUID NOT NULL,
    metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb, -- Privacy preserved: change keys only
    outcome TEXT NOT NULL DEFAULT 'success' CHECK (outcome IN ('success', 'failure')),
    ip_hash TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_owner ON public.audit_logs(owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON public.audit_logs(resource_type, resource_id);

-- Immutability Guard: Trigger blocking any UPDATE or DELETE on audit_logs
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


-- ==============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES — DAY 1 ISOLATION
-- ==============================================================================

-- Enable RLS on every single table
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diary_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.court_lookups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- 1. Profiles Policy (user_id matches auth.uid)
CREATE POLICY "profiles_owner_access" ON public.profiles
    FOR ALL USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- 2. Clients Policy
CREATE POLICY "clients_owner_access" ON public.clients
    FOR ALL USING (auth.uid() = owner_id)
    WITH CHECK (auth.uid() = owner_id);

-- 3. Matters Policy
CREATE POLICY "matters_owner_access" ON public.matters
    FOR ALL USING (auth.uid() = owner_id)
    WITH CHECK (auth.uid() = owner_id);

-- 4. Bookings Policy
CREATE POLICY "bookings_owner_access" ON public.bookings
    FOR ALL USING (auth.uid() = owner_id)
    WITH CHECK (auth.uid() = owner_id);

-- 5. Invoices Policy
CREATE POLICY "invoices_owner_access" ON public.invoices
    FOR ALL USING (auth.uid() = owner_id)
    WITH CHECK (auth.uid() = owner_id);

-- 6. Payments Policy
CREATE POLICY "payments_owner_access" ON public.payments
    FOR ALL USING (auth.uid() = owner_id)
    WITH CHECK (auth.uid() = owner_id);

-- 7. Diary Entries Policy
CREATE POLICY "diary_entries_owner_access" ON public.diary_entries
    FOR ALL USING (auth.uid() = owner_id)
    WITH CHECK (auth.uid() = owner_id);

-- 8. Documents Policy
CREATE POLICY "documents_owner_access" ON public.documents
    FOR ALL USING (auth.uid() = owner_id)
    WITH CHECK (auth.uid() = owner_id);

-- 9. Court Lookups Policy
CREATE POLICY "court_lookups_owner_access" ON public.court_lookups
    FOR ALL USING (auth.uid() = owner_id)
    WITH CHECK (auth.uid() = owner_id);

-- 10. Reminders Policy
CREATE POLICY "reminders_owner_access" ON public.reminders
    FOR ALL USING (auth.uid() = owner_id)
    WITH CHECK (auth.uid() = owner_id);

-- 11. Audit Logs Policy (SELECT and INSERT only, no UPDATE, no DELETE)
CREATE POLICY "audit_logs_owner_select" ON public.audit_logs
    FOR SELECT USING (auth.uid() = owner_id);

CREATE POLICY "audit_logs_owner_insert" ON public.audit_logs
    FOR INSERT WITH CHECK (auth.uid() = owner_id);


-- ==============================================================================
-- STORAGE BUCKETS & POLICIES (Supabase Storage)
-- ==============================================================================
-- Create private storage buckets if storage extension is active
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES 
    ('legal-audio', 'legal-audio', false, 26214400, ARRAY['audio/webm', 'audio/mp4', 'audio/wav', 'audio/ogg']),
    ('legal-documents', 'legal-documents', false, 10485760, ARRAY['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
ON CONFLICT (id) DO UPDATE SET 
    public = false,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- RLS for legal-audio bucket
CREATE POLICY "legal_audio_owner_access" ON storage.objects
    FOR ALL USING (
        bucket_id = 'legal-audio' AND (storage.foldername(name))[1] = auth.uid()::text
    )
    WITH CHECK (
        bucket_id = 'legal-audio' AND (storage.foldername(name))[1] = auth.uid()::text
    );

-- RLS for legal-documents bucket
CREATE POLICY "legal_documents_owner_access" ON storage.objects
    FOR ALL USING (
        bucket_id = 'legal-documents' AND (storage.foldername(name))[1] = auth.uid()::text
    )
    WITH CHECK (
        bucket_id = 'legal-documents' AND (storage.foldername(name))[1] = auth.uid()::text
    );
