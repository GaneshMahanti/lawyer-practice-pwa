-- ==============================================================================
-- VAKILDESK — PHASE 3 DATABASE MIGRATION
-- Adds: Role claims, isolated client portal tables (portal_invites, portal_submissions)
-- Run in Supabase SQL Editor after migration_phase2.sql
-- ==============================================================================

-- ==============================================================================
-- A. ROLE STAMPING (run once per user — requires service role / dashboard access)
--    Replace email values with actual accounts before running.
-- ==============================================================================
-- Developer account (full access):
-- UPDATE auth.users
--   SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb) || '{"role":"developer"}'::jsonb
--   WHERE email = 'mahanti9988@gmail.com';

-- Lawyer account (practice access only):
-- UPDATE auth.users
--   SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb) || '{"role":"lawyer"}'::jsonb
--   WHERE email = '<lawyer-email-here>';

-- Verify:
-- SELECT id, email, raw_app_meta_data->>'role' AS role FROM auth.users;


-- ==============================================================================
-- B. PORTAL INVITES TABLE
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.portal_invites (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id        UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    token_hash      TEXT        NOT NULL UNIQUE,
    purpose         TEXT        NOT NULL DEFAULT 'kyc_registration'
                                CHECK (purpose IN ('kyc_registration')),
    client_id       UUID        REFERENCES public.clients(id) ON DELETE SET NULL,
    fee_snapshot    JSONB       NOT NULL DEFAULT '[]'::jsonb,
    advocate_name   TEXT        NOT NULL DEFAULT '',
    expires_at      TIMESTAMPTZ NOT NULL,
    revoked_at      TIMESTAMPTZ,
    used_at         TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_portal_invites_token_hash ON public.portal_invites(token_hash);
CREATE INDEX IF NOT EXISTS idx_portal_invites_owner      ON public.portal_invites(owner_id);
CREATE INDEX IF NOT EXISTS idx_portal_invites_client     ON public.portal_invites(client_id)
    WHERE client_id IS NOT NULL;

ALTER TABLE public.portal_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "portal_invites_owner_access" ON public.portal_invites
    FOR ALL
    USING  (auth.uid() = owner_id)
    WITH CHECK (auth.uid() = owner_id);


-- ==============================================================================
-- C. PORTAL SUBMISSIONS TABLE
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.portal_submissions (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    invite_id         UUID        NOT NULL REFERENCES public.portal_invites(id) ON DELETE RESTRICT,
    owner_id          UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name              TEXT        NOT NULL,
    phone_1           TEXT        NOT NULL,
    phone_2           TEXT,
    aadhaar_last4     VARCHAR(4)  NOT NULL,
    current_address   TEXT        NOT NULL,
    permanent_address TEXT        NOT NULL,
    submitted_at      TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    promotion_status  TEXT        NOT NULL DEFAULT 'pending'
                                  CHECK (promotion_status IN ('pending', 'promoted', 'rejected')),
    promoted_client_id UUID       REFERENCES public.clients(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_portal_submissions_invite ON public.portal_submissions(invite_id);
CREATE INDEX IF NOT EXISTS idx_portal_submissions_owner  ON public.portal_submissions(owner_id);
CREATE INDEX IF NOT EXISTS idx_portal_submissions_status ON public.portal_submissions(owner_id, promotion_status);

ALTER TABLE public.portal_submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "portal_submissions_owner_select" ON public.portal_submissions
    FOR SELECT USING (auth.uid() = owner_id);


-- ==============================================================================
-- D. DEPRECATE OLD TOKEN COLUMNS ON CLIENTS
-- ==============================================================================
COMMENT ON COLUMN public.clients.registration_token IS
    'DEPRECATED Phase 3: use portal_invites.token_hash for new invites.';
COMMENT ON COLUMN public.clients.token_expires_at IS
    'DEPRECATED Phase 3: see portal_invites.expires_at.';
