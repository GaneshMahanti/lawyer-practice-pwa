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
    client_id       UUID,
    fee_snapshot    JSONB NOT NULL DEFAULT '[]',
    expires_at      TIMESTAMPTZ NOT NULL,
    revoked_at      TIMESTAMPTZ,
    submitted_at    TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Safely attach foreign key constraint if public.clients table already exists
DO $$ 
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'clients') THEN
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.table_constraints 
            WHERE constraint_name = 'portal_invites_client_id_fkey'
        ) THEN
            ALTER TABLE public.portal_invites 
            ADD CONSTRAINT portal_invites_client_id_fkey 
            FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE SET NULL;
        END IF;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_portal_invites_token ON public.portal_invites(token_hash);
CREATE INDEX IF NOT EXISTS idx_portal_invites_status ON public.portal_invites(status);
CREATE INDEX IF NOT EXISTS idx_portal_invites_owner ON public.portal_invites(owner_id);

ALTER TABLE public.portal_invites ENABLE ROW LEVEL SECURITY;

-- Only the owning advocate can read or manage their invites via client queries
DROP POLICY IF EXISTS "portal_invites_owner_policy" ON public.portal_invites;
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
DROP POLICY IF EXISTS "portal_submissions_owner_policy" ON public.portal_submissions;
CREATE POLICY "portal_submissions_owner_policy" ON public.portal_submissions
    FOR SELECT USING (auth.uid() = owner_id);

-- 4. Lawyer Onboarding Columns on Profiles
DO $$ 
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'profiles') THEN
        ALTER TABLE public.profiles 
            ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN NOT NULL DEFAULT false,
            ADD COLUMN IF NOT EXISTS bar_council_number TEXT,
            ADD COLUMN IF NOT EXISTS state_bar_council TEXT,
            ADD COLUMN IF NOT EXISTS chamber_address TEXT,
            ADD COLUMN IF NOT EXISTS city TEXT,
            ADD COLUMN IF NOT EXISTS practice_areas TEXT[] DEFAULT '{}';
    END IF;
END $$;

-- ==============================================================================
-- NOTE: sync_user_app_metadata_role() trigger function intentionally omitted.
-- Role stamping is handled exclusively in /src/app/auth/callback/route.ts via
-- auth.admin.updateUserById() using the privileged SUPABASE_SECRET_KEY.
-- A SECURITY DEFINER trigger is unnecessary and creates a redundant,
-- uncontrolled authorization path. The /auth/callback route is the single
-- source of truth for role assignment and is enforced at every login.
-- ==============================================================================
