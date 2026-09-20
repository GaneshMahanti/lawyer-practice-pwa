-- Migration: single-device session enforcement + per-lawyer feature flags
-- Run this against your Supabase project (SQL editor or CLI).

ALTER TABLE public.approved_users
  ADD COLUMN IF NOT EXISTS ai_enabled        BOOLEAN      NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notes_enabled     BOOLEAN      NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS session_nonce     TEXT,
  ADD COLUMN IF NOT EXISTS session_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS auth_user_id      UUID;

COMMENT ON COLUMN public.approved_users.ai_enabled
  IS 'When false the lawyer cannot use AI features (transcription, OCR, translation).';

COMMENT ON COLUMN public.approved_users.notes_enabled
  IS 'When false the lawyer cannot access the Diary / Notes section.';

COMMENT ON COLUMN public.approved_users.session_nonce
  IS 'Random token set on login; enforces single-device access. NULL means no active session.';

COMMENT ON COLUMN public.approved_users.session_started_at
  IS 'Timestamp of the most recent login; used to auto-expire old nonces after 90 days.';

COMMENT ON COLUMN public.approved_users.auth_user_id
  IS 'Supabase auth.users.id for this lawyer; populated on first login to allow admin force-logout.';
