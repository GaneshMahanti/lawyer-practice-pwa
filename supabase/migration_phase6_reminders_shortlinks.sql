-- ==============================================================================
-- VakilDesk Phase 6: push notifications for hearing reminders + short invite links
-- Idempotent: safe to run more than once. Run in the Supabase SQL editor.
--
-- All tables below are SERVER-ONLY: RLS is on, no policies exist, and access is
-- revoked from anon/authenticated. The app reaches them with the secret key.
-- ==============================================================================

-- 1. Browser/phone push subscriptions (one row per device)
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    endpoint        TEXT NOT NULL UNIQUE,
    p256dh          TEXT NOT NULL,
    auth            TEXT NOT NULL,
    user_agent      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_success_at TIMESTAMPTZ,
    last_error_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_owner ON public.push_subscriptions(owner_id);

-- 2. One row per (hearing, reminder offset) so a reminder is never sent twice
CREATE TABLE IF NOT EXISTS public.reminder_deliveries (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    booking_id      UUID NOT NULL,
    offset_minutes  INTEGER NOT NULL,
    channel         TEXT NOT NULL DEFAULT 'push',
    status          TEXT NOT NULL CHECK (status IN ('sending', 'sent', 'failed')),
    attempt_count   INTEGER NOT NULL DEFAULT 1,
    devices_reached INTEGER NOT NULL DEFAULT 0,
    error_summary   TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT reminder_deliveries_unique UNIQUE (booking_id, offset_minutes, channel)
);
CREATE INDEX IF NOT EXISTS idx_reminder_deliveries_owner ON public.reminder_deliveries(owner_id, created_at DESC);

-- 3. Real error details (users only ever see a short message)
CREATE TABLE IF NOT EXISTS public.error_logs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    scope       TEXT NOT NULL,
    message     TEXT NOT NULL,
    context     JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_error_logs_created ON public.error_logs(created_at DESC);

-- 4. Heartbeat so the developer dashboard can tell if the scheduler stopped
CREATE TABLE IF NOT EXISTS public.app_heartbeats (
    name        TEXT PRIMARY KEY,
    last_run_at TIMESTAMPTZ NOT NULL,
    detail      JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- 5. Short invite links: /p/<code> redirects to /portal/<token>
CREATE TABLE IF NOT EXISTS public.short_links (
    code        TEXT PRIMARY KEY,
    target_path TEXT NOT NULL UNIQUE,
    owner_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    expires_at  TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_short_links_expires ON public.short_links(expires_at);

-- Lock every table above to the server (secret key bypasses RLS)
ALTER TABLE public.push_subscriptions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reminder_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.error_logs          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_heartbeats      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.short_links         ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.push_subscriptions  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.reminder_deliveries FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.error_logs          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.app_heartbeats      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.short_links         FROM PUBLIC, anon, authenticated;

-- 6. Fix: Settings offers "5 days before" (7200 min) but the old constraint rejected it,
--    so that choice silently failed to save.
DO $$
BEGIN
  IF to_regclass('public.reminder_preferences') IS NOT NULL THEN
    ALTER TABLE public.reminder_preferences DROP CONSTRAINT IF EXISTS reminder_offsets_valid;
    ALTER TABLE public.reminder_preferences
      ADD CONSTRAINT reminder_offsets_valid CHECK (
        cardinality(offsets_minutes) > 0
        AND cardinality(offsets_minutes) <= 8
        AND offsets_minutes <@ ARRAY[15,30,60,120,1440,2880,7200,10080]
      );
  END IF;
END $$;
