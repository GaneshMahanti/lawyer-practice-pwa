-- ==============================================================================
-- VAKILDESK — PHASE 2 DATABASE MIGRATION
-- Adds: Client Onboarding KYC, Client Fees, Case Classification, Unified Notes,
-- and Telugu Document Translation.
-- ==============================================================================

-- 1. Extend clients table with KYC, Phone 2, and registration token
ALTER TABLE public.clients
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('pending', 'active')),
    ADD COLUMN IF NOT EXISTS registration_token TEXT UNIQUE,
    ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS aadhaar_last4 VARCHAR(4),
    ADD COLUMN IF NOT EXISTS current_address TEXT,
    ADD COLUMN IF NOT EXISTS permanent_address TEXT,
    ADD COLUMN IF NOT EXISTS phone_2 TEXT;

-- Allow provisional pending client records before client fills KYC
ALTER TABLE public.clients ALTER COLUMN name DROP NOT NULL;
ALTER TABLE public.clients ALTER COLUMN phone DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_clients_reg_token ON public.clients(registration_token) 
    WHERE registration_token IS NOT NULL;

-- 2. Client Fees Table (linked to client_id, stores non-zero fees only)
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

ALTER TABLE public.client_fees ENABLE ROW LEVEL SECURITY;

CREATE POLICY "client_fees_owner_access" ON public.client_fees
    FOR ALL USING (auth.uid() = owner_id)
    WITH CHECK (auth.uid() = owner_id);

-- 3. Extend matters table with case classification fields (maintaining matter_id everywhere)
ALTER TABLE public.matters
    ADD COLUMN IF NOT EXISTS category TEXT,
    ADD COLUMN IF NOT EXISTS state TEXT NOT NULL DEFAULT 'Andhra Pradesh',
    ADD COLUMN IF NOT EXISTS district TEXT,
    ADD COLUMN IF NOT EXISTS court_complex TEXT,
    ADD COLUMN IF NOT EXISTS case_year INTEGER;

CREATE INDEX IF NOT EXISTS idx_matters_classification ON public.matters(owner_id, category, district);

-- 4. Extend diary_entries for unified notes (voice + typed notes with client/matter links)
ALTER TABLE public.diary_entries
    ADD COLUMN IF NOT EXISTS entry_type TEXT NOT NULL DEFAULT 'voice' CHECK (entry_type IN ('voice', 'text')),
    ADD COLUMN IF NOT EXISTS title TEXT,
    ADD COLUMN IF NOT EXISTS content TEXT;

-- 5. Extend documents for Telugu document translation & dual memo
ALTER TABLE public.documents
    ADD COLUMN IF NOT EXISTS image_url TEXT,
    ADD COLUMN IF NOT EXISTS original_text TEXT,
    ADD COLUMN IF NOT EXISTS translated_text TEXT,
    ADD COLUMN IF NOT EXISTS ocr_accuracy_warning TEXT DEFAULT 'Handwritten Telugu OCR accuracy is lower than printed text. Verify against original.';
