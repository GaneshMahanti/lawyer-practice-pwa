-- ==============================================================================
-- VakilDesk Migration Phase 3: RBAC, Approved Users, Client Portal Lifecycle,
-- and Lawyer Onboarding
-- ==============================================================================

-- 1. Explicit Approved Users / Authorization Allowlist Table
-- Strictly internal authorization control table:
-- Normal authenticated users and anon have ZERO SELECT/INSERT/UPDATE/DELETE access.
-- Privileged server-side code queries this table using the service role key.
CREATE TABLE IF NOT EXISTS public.approved_users (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email       TEXT NOT NULL UNIQUE,
    role        TEXT NOT NULL CHECK (role IN ('developer', 'lawyer')),
    name        TEXT,
    is_active   BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Revoke all table permissions from public, anon, and authenticated roles
REVOKE ALL ON public.approved_users FROM PUBLIC, anon, authenticated;

-- Enable Row Level Security (no policies granted to anon/authenticated = total denial)
ALTER TABLE public.approved_users ENABLE ROW LEVEL SECURITY;

-- Seed initial approved developer and lawyer accounts
INSERT INTO public.approved_users (email, role, name, is_active)
VALUES 
    ('mahanti9988@gmail.com', 'developer', 'Ganesh Mahanti (Developer)', true),
    ('testuser@gmail.com', 'lawyer', 'Test Advocate', true)
ON CONFLICT (email) DO UPDATE 
SET role = EXCLUDED.role, is_active = EXCLUDED.is_active, updated_at = now();

-- 2. Client Portal Invites with Stateful Workflow Lifecycle
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

ALTER TABLE public.portal_invites ENABLE ROW LEVEL SECURITY;

-- Only the owning advocate can read or manage their invites via client queries
CREATE POLICY "portal_invites_owner_policy" ON public.portal_invites
    FOR ALL USING (auth.uid() = owner_id)
    WITH CHECK (auth.uid() = owner_id);

-- 3. Portal Submissions Table (Client KYC Data)
CREATE TABLE IF NOT EXISTS public.portal_submissions (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invite_id         UUID NOT NULL REFERENCES public.portal_invites(id) ON DELETE CASCADE,
    owner_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name              TEXT NOT NULL,
    phone_1           TEXT NOT NULL,
    phone_2           TEXT,
    aadhaar_last4     VARCHAR(4) NOT NULL, -- UIDAI compliance: last 4 digits only
    current_address   TEXT NOT NULL,
    permanent_address TEXT NOT NULL,
    submitted_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_portal_submissions_invite ON public.portal_submissions(invite_id);
CREATE INDEX IF NOT EXISTS idx_portal_submissions_owner ON public.portal_submissions(owner_id);

ALTER TABLE public.portal_submissions ENABLE ROW LEVEL SECURITY;

-- Advocates can view KYC submissions belonging to their invites
CREATE POLICY "portal_submissions_owner_policy" ON public.portal_submissions
    FOR SELECT USING (auth.uid() = owner_id);

-- 4. Lawyer Onboarding Columns on Profiles
ALTER TABLE public.profiles 
    ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS bar_council_number TEXT,
    ADD COLUMN IF NOT EXISTS state_bar_council TEXT,
    ADD COLUMN IF NOT EXISTS chamber_address TEXT,
    ADD COLUMN IF NOT EXISTS city TEXT,
    ADD COLUMN IF NOT EXISTS practice_areas TEXT[] DEFAULT '{}';

-- 5. Helper function for server-side role stamping
CREATE OR REPLACE FUNCTION public.sync_user_app_metadata_role()
RETURNS TRIGGER AS $$
DECLARE
    matched_role TEXT;
    is_user_active BOOLEAN;
BEGIN
    SELECT role, is_active INTO matched_role, is_user_active
    FROM public.approved_users
    WHERE email = NEW.email;

    IF matched_role IS NOT NULL AND is_user_active = true THEN
        NEW.raw_app_meta_data = COALESCE(NEW.raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('role', matched_role);
    ELSE
        NEW.raw_app_meta_data = COALESCE(NEW.raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('role', 'unauthorized');
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
