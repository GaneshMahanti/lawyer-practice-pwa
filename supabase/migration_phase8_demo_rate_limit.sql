-- ==============================================================================
-- VakilDesk Phase 8 (C0): per-IP rate limit table for /api/demo/session
--
-- Serverless memory is not shared across invocations, so rate limiting must
-- live in Postgres. This table records each demo session creation attempt.
-- The route counts rows for the same IP in the last hour; if >= 5 it returns 429.
-- Rows older than 2 hours are cleaned up on each write (cheap, no cron needed).
--
-- Idempotent: safe to run more than once.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.demo_rate_limit (
  id         UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  ip         TEXT        NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS demo_rate_limit_ip_created_at_idx
  ON public.demo_rate_limit (ip, created_at);

-- No direct client access; the demo session route uses the service role.
ALTER TABLE public.demo_rate_limit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.demo_rate_limit FROM PUBLIC, anon, authenticated;
