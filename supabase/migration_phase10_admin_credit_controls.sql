-- ==============================================================================
-- VakilDesk Phase 10: developer controls over AI credits + developer's own usage
-- Idempotent. All functions are SECURITY DEFINER and callable only by the server.
--
--  1. ai_ledger accepts two new kinds: 'admin_adjustment' (developer adds/removes
--     credits for a lawyer) and 'internal_usage' (the developer's OWN AI use, which is
--     logged for cost tracking but never touches any wallet; bucket 'internal').
--  2. admin_adjust_credits(): add or remove credits in a lawyer's Included or
--     Recharged bucket, with a required note.
--  3. admin_ai_usage_report(): now also returns the developer's internal usage.
-- ==============================================================================

ALTER TABLE public.ai_ledger DROP CONSTRAINT IF EXISTS ai_ledger_kind_check;
ALTER TABLE public.ai_ledger ADD CONSTRAINT ai_ledger_kind_check
  CHECK (kind IN ('grant_included','recharge','usage','adjustment','refund','admin_adjustment','internal_usage'));

ALTER TABLE public.ai_ledger DROP CONSTRAINT IF EXISTS ai_ledger_bucket_check;
ALTER TABLE public.ai_ledger ADD CONSTRAINT ai_ledger_bucket_check
  CHECK (bucket IN ('included','purchased','internal'));

-- ------------------------------------------------------------------------------
-- admin_adjust_credits
--   p_amount_paise > 0 adds credit, < 0 removes it (never below zero).
--   Max Rs 10,000 per action (typo guard). A note of at least 3 characters is required.
--   Errors: invalid_bucket, invalid_amount, amount_out_of_range, note_required,
--           owner_not_found, not_a_lawyer, insufficient_balance.
--   If the lawyer's Included credits have already expired, the expired amount is written
--   off first (with a ledger row) so it cannot come back to life with a new expiry date.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_adjust_credits(
  p_owner_id      UUID,
  p_bucket        TEXT,
  p_amount_paise  NUMERIC,
  p_note          TEXT,
  p_developer_id  UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role       TEXT;
  v_wallet     RECORD;
  v_valid_days INT;
  v_expires_at TIMESTAMPTZ;
  v_note       TEXT;
BEGIN
  IF p_bucket IS NULL OR p_bucket NOT IN ('included', 'purchased') THEN
    RAISE EXCEPTION 'invalid_bucket';
  END IF;
  IF p_amount_paise IS NULL OR p_amount_paise = 0 THEN
    RAISE EXCEPTION 'invalid_amount';
  END IF;
  IF abs(p_amount_paise) > 1000000 THEN
    RAISE EXCEPTION 'amount_out_of_range';
  END IF;
  v_note := left(btrim(COALESCE(p_note, '')), 200);
  IF length(v_note) < 3 THEN
    RAISE EXCEPTION 'note_required';
  END IF;

  SELECT role INTO v_role
  FROM public.approved_users
  WHERE auth_user_id = p_owner_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'owner_not_found: this lawyer has not signed in yet';
  END IF;
  IF v_role <> 'lawyer' THEN
    RAISE EXCEPTION 'not_a_lawyer';
  END IF;

  SELECT (value::text)::int INTO v_valid_days
  FROM public.app_config WHERE key = 'included_valid_days';
  v_valid_days := COALESCE(v_valid_days, 365);
  v_expires_at := now() + (v_valid_days || ' days')::interval;

  INSERT INTO public.ai_wallets (owner_id) VALUES (p_owner_id)
  ON CONFLICT (owner_id) DO NOTHING;

  SELECT * INTO v_wallet FROM public.ai_wallets WHERE owner_id = p_owner_id FOR UPDATE;

  IF p_bucket = 'included' THEN
    -- Write off expired included credit before adding new included credit.
    IF p_amount_paise > 0
       AND v_wallet.included_expires_at IS NOT NULL
       AND v_wallet.included_expires_at <= now()
       AND v_wallet.included_paise > 0 THEN
      INSERT INTO public.ai_ledger (owner_id, actor_user_id, kind, bucket, amount_paise, request_ref)
      VALUES (p_owner_id, p_developer_id, 'admin_adjustment', 'included',
              -v_wallet.included_paise, 'expired included credits written off');
      UPDATE public.ai_wallets SET included_paise = 0 WHERE owner_id = p_owner_id;
      v_wallet.included_paise := 0;
    END IF;

    IF p_amount_paise < 0 AND v_wallet.included_paise + p_amount_paise < 0 THEN
      RAISE EXCEPTION 'insufficient_balance';
    END IF;

    UPDATE public.ai_wallets
    SET included_paise = included_paise + p_amount_paise,
        included_expires_at = CASE
          WHEN p_amount_paise > 0
           AND (included_expires_at IS NULL OR included_expires_at <= now())
          THEN v_expires_at
          ELSE included_expires_at
        END
    WHERE owner_id = p_owner_id;
  ELSE
    IF p_amount_paise < 0 AND v_wallet.purchased_paise + p_amount_paise < 0 THEN
      RAISE EXCEPTION 'insufficient_balance';
    END IF;

    UPDATE public.ai_wallets
    SET purchased_paise = purchased_paise + p_amount_paise
    WHERE owner_id = p_owner_id;
  END IF;

  INSERT INTO public.ai_ledger (owner_id, actor_user_id, kind, bucket, amount_paise, request_ref)
  VALUES (p_owner_id, p_developer_id, 'admin_adjustment', p_bucket, p_amount_paise, v_note);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_adjust_credits(UUID, TEXT, NUMERIC, TEXT, UUID)
  FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------------------------
-- admin_ai_usage_report: same as before plus 'internal' (developer's own usage).
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_ai_usage_report(p_since TIMESTAMPTZ DEFAULT NULL)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH per_reserve AS (
    SELECT owner_id,
           COALESCE(feature, 'unknown') AS feature,
           reserve_id,
           SUM(-amount_paise) AS spent_paise,
           COALESCE(SUM(units) FILTER (WHERE kind = 'usage'), 0) AS units
    FROM public.ai_ledger
    WHERE kind IN ('usage', 'adjustment', 'refund')
      AND (p_since IS NULL OR created_at >= p_since)
    GROUP BY owner_id, COALESCE(feature, 'unknown'), reserve_id
    HAVING SUM(-amount_paise) > 0
  ),
  per_feature AS (
    SELECT owner_id, feature,
           SUM(spent_paise) AS spent_paise,
           SUM(units)       AS units,
           COUNT(*)         AS calls
    FROM per_reserve
    GROUP BY owner_id, feature
  ),
  per_owner AS (
    SELECT owner_id,
           SUM(spent_paise) AS spent_paise,
           SUM(calls)       AS calls,
           jsonb_object_agg(
             feature,
             jsonb_build_object('spent_paise', spent_paise, 'units', units, 'calls', calls)
           ) AS by_feature
    FROM per_feature
    GROUP BY owner_id
  ),
  last_use AS (
    SELECT owner_id, MAX(created_at) AS last_used_at
    FROM public.ai_ledger
    WHERE kind = 'usage'
    GROUP BY owner_id
  ),
  internal_feature AS (
    SELECT COALESCE(feature, 'unknown') AS feature,
           SUM(-amount_paise) AS spent_paise,
           COALESCE(SUM(units), 0) AS units,
           COUNT(*) AS calls
    FROM public.ai_ledger
    WHERE kind = 'internal_usage'
      AND (p_since IS NULL OR created_at >= p_since)
    GROUP BY COALESCE(feature, 'unknown')
  )
  SELECT jsonb_build_object(
    'generated_at', now(),
    'since', p_since,
    'wallets', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'owner_id',            w.owner_id,
          'included_paise',      w.included_paise,
          'included_expires_at', w.included_expires_at,
          'purchased_paise',     w.purchased_paise,
          'status',              w.status,
          'daily_cap_paise',     w.daily_cap_paise,
          'spent_paise',         COALESCE(po.spent_paise, 0),
          'calls',               COALESCE(po.calls, 0),
          'by_feature',          COALESCE(po.by_feature, '{}'::jsonb),
          'last_used_at',        lu.last_used_at
        )
        ORDER BY COALESCE(po.spent_paise, 0) DESC
      )
      FROM public.ai_wallets w
      LEFT JOIN per_owner po ON po.owner_id = w.owner_id
      LEFT JOIN last_use  lu ON lu.owner_id = w.owner_id
    ), '[]'::jsonb),
    'internal', COALESCE((
      SELECT jsonb_object_agg(
        feature,
        jsonb_build_object('spent_paise', spent_paise, 'units', units, 'calls', calls)
      )
      FROM internal_feature
    ), '{}'::jsonb)
  );
$$;

REVOKE ALL ON FUNCTION public.admin_ai_usage_report(TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
