-- ==============================================================================
-- Admin allowlist columns for approved_users
-- Idempotent: safe to run repeatedly.
-- Run this in your Supabase project SQL editor before using /app/admin.
-- ==============================================================================

ALTER TABLE public.approved_users
    ADD COLUMN IF NOT EXISTS plan TEXT
        NOT NULL DEFAULT 'standard'
        CHECK (plan IN ('basic', 'standard', 'premium'));

ALTER TABLE public.approved_users
    ADD COLUMN IF NOT EXISTS subscription_end TIMESTAMPTZ;

ALTER TABLE public.approved_users
    ADD COLUMN IF NOT EXISTS phone TEXT;

CREATE INDEX IF NOT EXISTS approved_users_subscription_end_idx
    ON public.approved_users(subscription_end);

-- Backfill: existing rows that have no subscription_end get 1 year from today
UPDATE public.approved_users
   SET subscription_end = now() + INTERVAL '1 year'
 WHERE subscription_end IS NULL;
