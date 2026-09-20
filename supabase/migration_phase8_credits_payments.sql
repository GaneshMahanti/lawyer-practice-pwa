-- ==============================================================================
-- VakilDesk Phase C1: AI credits, wallets, ledger, payment requests
--
-- Idempotent: safe to run more than once.
-- Do NOT add UPI VPA, payee name, or QR image to this file (repo is public).
-- The developer sets upi_vpa and upi_payee_name directly in the live database.
--
-- Reviewed and corrected after the first draft. Changes vs the draft:
--   * payment_requests: NO client INSERT policy (a lawyer could have inserted a fake
--     "approved" row and inflated the developer's payment records). Server only.
--   * Table privileges revoked as well as RLS (defence in depth).
--   * Policies made re-runnable (DROP POLICY IF EXISTS first).
--   * ai_reserve: rejects NULL/negative estimates (a negative estimate would have
--     CREDITED the wallet); the default daily cap from app_config now really applies;
--     daily spend is net of refunds.
--   * ai_settle: always records units; refunds go back to the buckets they were taken
--     from (previously everything became never-expiring "purchased" credit); extra
--     charges take included credit first and the ledger now matches the wallet exactly.
--   * grant_included_credits: raises when the lawyer has never signed in (before, it
--     could grant repeatedly), locks the row, and stamps app_fee_paid_at itself.
--   * approve_payment_request: rejects zero/negative or absurd (>10x) amounts.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. app_config  (developer-editable settings; server-side access only)
-- ------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.app_config (
  key        TEXT PRIMARY KEY,
  value      JSONB        NOT NULL,
  updated_at TIMESTAMPTZ  DEFAULT now()
);

ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_config FROM PUBLIC, anon, authenticated;

-- ON CONFLICT DO NOTHING so a value the developer already set is never overwritten.
INSERT INTO public.app_config (key, value) VALUES
  ('recharge_credit_percent', '90'::jsonb),
  ('min_recharge_paise',      '10000'::jsonb),
  ('included_credit_paise',   '100000'::jsonb),
  ('included_valid_days',     '365'::jsonb),
  ('seat_price_paise',        '500000'::jsonb),
  ('seat_renewal_paise',      '100000'::jsonb),
  ('low_balance_paise',       '2000'::jsonb),
  ('daily_ai_cap_paise',      '20000'::jsonb),
  ('upi_vpa',                 '""'::jsonb),
  ('upi_payee_name',          '""'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ------------------------------------------------------------------------------
-- 2. ai_rate_card  (Sarvam list prices in paise per unit)
--    stt: Rs 30/hour = 3000p / 3600s; translate + transliterate: Rs 20 per 10,000
--    characters = 0.2p/char (confirmed by the developer); ocr: Rs 0.5/page = 50p.
-- ------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.ai_rate_card (
  feature        TEXT        PRIMARY KEY,
  unit           TEXT        NOT NULL,
  paise_per_unit NUMERIC     NOT NULL CHECK (paise_per_unit >= 0),
  updated_at     TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.ai_rate_card ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_rate_card_lawyer_select ON public.ai_rate_card;
CREATE POLICY ai_rate_card_lawyer_select
  ON public.ai_rate_card FOR SELECT
  TO authenticated
  USING (true);

INSERT INTO public.ai_rate_card (feature, unit, paise_per_unit) VALUES
  ('stt',           'second',    0.8333333333),
  ('translate',     'character', 0.2),
  ('transliterate', 'character', 0.2),
  ('ocr',           'page',      50)
ON CONFLICT (feature) DO NOTHING;

-- ------------------------------------------------------------------------------
-- 3. ai_wallets  (one row per workspace owner; lawyers can only READ their own)
-- ------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.ai_wallets (
  owner_id            UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  included_paise      NUMERIC     NOT NULL DEFAULT 0 CHECK (included_paise >= 0),
  included_expires_at TIMESTAMPTZ,
  purchased_paise     NUMERIC     NOT NULL DEFAULT 0 CHECK (purchased_paise >= 0),
  status              TEXT        NOT NULL DEFAULT 'active'
                                    CHECK (status IN ('active', 'paused')),
  daily_cap_paise     NUMERIC     CHECK (daily_cap_paise IS NULL OR daily_cap_paise > 0),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_wallets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_wallets_owner_select ON public.ai_wallets;
CREATE POLICY ai_wallets_owner_select
  ON public.ai_wallets FOR SELECT
  TO authenticated
  USING (owner_id = auth.uid());

-- ------------------------------------------------------------------------------
-- 4. ai_ledger  (append-only log: negative = debit, positive = credit)
--    reserve_id ties a reservation to its later refund/adjustment rows.
-- ------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.ai_ledger (
  id                 UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id           UUID        NOT NULL,
  actor_user_id      UUID,
  kind               TEXT        NOT NULL
                       CHECK (kind IN ('grant_included','recharge','usage','adjustment','refund')),
  bucket             TEXT        NOT NULL
                       CHECK (bucket IN ('included','purchased')),
  amount_paise       NUMERIC     NOT NULL,
  feature            TEXT,
  units              NUMERIC,
  request_ref        TEXT,
  payment_request_id UUID,
  reserve_id         UUID,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_ledger_owner_select ON public.ai_ledger;
CREATE POLICY ai_ledger_owner_select
  ON public.ai_ledger FOR SELECT
  TO authenticated
  USING (owner_id = auth.uid());

CREATE INDEX IF NOT EXISTS ai_ledger_owner_created_idx
  ON public.ai_ledger (owner_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ai_ledger_reserve_id_idx
  ON public.ai_ledger (reserve_id)
  WHERE reserve_id IS NOT NULL;

-- ------------------------------------------------------------------------------
-- 5. payment_requests  (recharge / seat / seat_renewal)
--    The developer's share is DERIVED (received - credited); it is not stored.
--    Rows are created and changed ONLY by the server (service role) and by the
--    SECURITY DEFINER functions below. Lawyers can read their own rows.
-- ------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.payment_requests (
  id                    UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id              UUID        NOT NULL,
  requested_by          UUID        NOT NULL,
  kind                  TEXT        NOT NULL
                          CHECK (kind IN ('recharge', 'seat', 'seat_renewal')),
  amount_expected_paise NUMERIC     NOT NULL CHECK (amount_expected_paise > 0),
  ref_code              TEXT        NOT NULL UNIQUE,
  status                TEXT        NOT NULL DEFAULT 'created'
                          CHECK (status IN ('created','submitted','approved','rejected','expired')),
  utr                   TEXT        UNIQUE,
  amount_received_paise NUMERIC,
  credited_paise        NUMERIC,
  meta                  JSONB,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at          TIMESTAMPTZ,
  decided_by            UUID,
  decided_at            TIMESTAMPTZ,
  decision_note         TEXT
);

ALTER TABLE public.payment_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payment_requests_owner_select ON public.payment_requests;
CREATE POLICY payment_requests_owner_select
  ON public.payment_requests FOR SELECT
  TO authenticated
  USING (owner_id = auth.uid());

-- Deliberately NO insert / update / delete policy for authenticated users.
DROP POLICY IF EXISTS payment_requests_owner_insert ON public.payment_requests;

CREATE INDEX IF NOT EXISTS payment_requests_owner_status_idx
  ON public.payment_requests (owner_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS payment_requests_status_idx
  ON public.payment_requests (status, created_at DESC);

-- ------------------------------------------------------------------------------
-- 6. Sarvam balance tracking (developer only, service role)
-- ------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.sarvam_balance_snapshots (
  id            UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  balance_paise NUMERIC     NOT NULL,
  note          TEXT,
  recorded_by   UUID        NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.sarvam_balance_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sarvam_balance_snapshots FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.sarvam_topups (
  id           UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  amount_paise NUMERIC     NOT NULL CHECK (amount_paise > 0),
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.sarvam_topups ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sarvam_topups FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------------------------
-- 7. approved_users: app-fee and credit-grant tracking
-- ------------------------------------------------------------------------------

ALTER TABLE public.approved_users
  ADD COLUMN IF NOT EXISTS app_fee_paid_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS included_granted_at TIMESTAMPTZ;

COMMENT ON COLUMN public.approved_users.app_fee_paid_at
  IS 'When the developer marked the one-time app fee as received. Null = not yet paid.';
COMMENT ON COLUMN public.approved_users.included_granted_at
  IS 'When the Rs 1,000 included credits were granted. Set by grant_included_credits; prevents a second grant.';

-- ------------------------------------------------------------------------------
-- 8. SECURITY DEFINER money functions (server-side use only)
--    search_path is empty, so every object is schema-qualified.
-- ------------------------------------------------------------------------------

-- 8a. ai_reserve: atomically reserve credits before a Sarvam call.
--     Returns the reserve id for ai_settle / ai_release.
--     Errors: invalid_estimate, no_wallet, wallet_paused, daily_cap_exceeded,
--             insufficient_credits.
CREATE OR REPLACE FUNCTION public.ai_reserve(
  p_owner_id      UUID,
  p_actor_user_id UUID,
  p_feature       TEXT,
  p_est_paise     NUMERIC
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_wallet          RECORD;
  v_cap             NUMERIC;
  v_daily_used      NUMERIC;
  v_included_avail  NUMERIC;
  v_included_debit  NUMERIC;
  v_purchased_debit NUMERIC;
  v_reserve_id      UUID := gen_random_uuid();
  v_now             TIMESTAMPTZ := now();
  v_day_start       TIMESTAMPTZ;
BEGIN
  IF p_est_paise IS NULL OR p_est_paise < 0 THEN
    RAISE EXCEPTION 'invalid_estimate';
  END IF;

  SELECT * INTO v_wallet
  FROM public.ai_wallets
  WHERE owner_id = p_owner_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'no_wallet';
  END IF;

  IF v_wallet.status = 'paused' THEN
    RAISE EXCEPTION 'wallet_paused';
  END IF;

  -- Daily cap: this wallet's own cap, else the global default from app_config.
  v_cap := v_wallet.daily_cap_paise;
  IF v_cap IS NULL THEN
    SELECT (value::text)::numeric INTO v_cap
    FROM public.app_config WHERE key = 'daily_ai_cap_paise';
  END IF;

  IF v_cap IS NOT NULL THEN
    v_day_start := date_trunc('day', v_now AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata';

    -- Net spend today (IST): usage and adjustments are negative, refunds positive.
    SELECT COALESCE(SUM(-amount_paise), 0) INTO v_daily_used
    FROM public.ai_ledger
    WHERE owner_id = p_owner_id
      AND kind IN ('usage', 'adjustment', 'refund')
      AND created_at >= v_day_start;

    IF v_daily_used + p_est_paise > v_cap THEN
      RAISE EXCEPTION 'daily_cap_exceeded';
    END IF;
  END IF;

  -- Included credits count as 0 once expired.
  v_included_avail := CASE
    WHEN v_wallet.included_expires_at IS NOT NULL
     AND v_wallet.included_expires_at <= v_now THEN 0
    ELSE v_wallet.included_paise
  END;

  IF v_included_avail + v_wallet.purchased_paise < p_est_paise THEN
    RAISE EXCEPTION 'insufficient_credits';
  END IF;

  -- Included first, then purchased.
  v_included_debit  := LEAST(v_included_avail, p_est_paise);
  v_purchased_debit := p_est_paise - v_included_debit;

  UPDATE public.ai_wallets
  SET included_paise  = included_paise  - v_included_debit,
      purchased_paise = purchased_paise - v_purchased_debit
  WHERE owner_id = p_owner_id;

  IF v_included_debit > 0 THEN
    INSERT INTO public.ai_ledger
      (owner_id, actor_user_id, kind, bucket, amount_paise, feature, reserve_id)
    VALUES
      (p_owner_id, p_actor_user_id, 'usage', 'included', -v_included_debit, p_feature, v_reserve_id);
  END IF;

  IF v_purchased_debit > 0 THEN
    INSERT INTO public.ai_ledger
      (owner_id, actor_user_id, kind, bucket, amount_paise, feature, reserve_id)
    VALUES
      (p_owner_id, p_actor_user_id, 'usage', 'purchased', -v_purchased_debit, p_feature, v_reserve_id);
  END IF;

  RETURN v_reserve_id;
END;
$$;

-- 8b. ai_settle: reconcile the reservation with the real Sarvam cost.
--     Over-reserved  -> refund, returned to the buckets it came from (purchased first,
--                       then included: the reverse of the debit order).
--     Under-reserved -> extra charge, included credit first then purchased, limited to
--                       what is available; the ledger records exactly what was taken.
--     Records the real units on the usage rows. Idempotent.
CREATE OR REPLACE FUNCTION public.ai_settle(
  p_reserve_id   UUID,
  p_actual_paise NUMERIC,
  p_units        NUMERIC DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_owner_id     UUID;
  v_actor        UUID;
  v_feature      TEXT;
  v_inc_reserved NUMERIC;
  v_pur_reserved NUMERIC;
  v_reserved     NUMERIC;
  v_diff         NUMERIC;
  v_wallet       RECORD;
  v_inc_avail    NUMERIC;
  v_refund_pur   NUMERIC;
  v_refund_inc   NUMERIC;
  v_extra        NUMERIC;
  v_charge_inc   NUMERIC;
  v_charge_pur   NUMERIC;
BEGIN
  IF p_actual_paise IS NULL OR p_actual_paise < 0 THEN
    RAISE EXCEPTION 'invalid_actual';
  END IF;

  -- Already refunded/adjusted (or released): nothing more to do.
  IF EXISTS (
    SELECT 1 FROM public.ai_ledger
    WHERE reserve_id = p_reserve_id AND kind IN ('adjustment', 'refund')
  ) THEN
    RETURN;
  END IF;

  SELECT owner_id, actor_user_id, feature
  INTO v_owner_id, v_actor, v_feature
  FROM public.ai_ledger
  WHERE reserve_id = p_reserve_id AND kind = 'usage'
  LIMIT 1;

  IF v_owner_id IS NULL THEN
    RETURN; -- unknown or zero-cost reservation
  END IF;

  SELECT COALESCE(SUM(-amount_paise) FILTER (WHERE bucket = 'included'), 0),
         COALESCE(SUM(-amount_paise) FILTER (WHERE bucket = 'purchased'), 0)
  INTO v_inc_reserved, v_pur_reserved
  FROM public.ai_ledger
  WHERE reserve_id = p_reserve_id AND kind = 'usage';

  v_reserved := v_inc_reserved + v_pur_reserved;

  -- Record the real units on the usage rows, split in proportion to each bucket's share.
  IF p_units IS NOT NULL AND v_reserved > 0 THEN
    UPDATE public.ai_ledger
    SET units = p_units * (-amount_paise / v_reserved)
    WHERE reserve_id = p_reserve_id AND kind = 'usage';
  END IF;

  v_diff := v_reserved - p_actual_paise; -- > 0: over-reserved, < 0: under-reserved
  IF v_diff = 0 THEN
    RETURN;
  END IF;

  SELECT * INTO v_wallet
  FROM public.ai_wallets
  WHERE owner_id = v_owner_id
  FOR UPDATE;

  IF v_diff > 0 THEN
    v_refund_pur := LEAST(v_diff, v_pur_reserved);
    v_refund_inc := v_diff - v_refund_pur; -- never exceeds what was reserved from included

    UPDATE public.ai_wallets
    SET purchased_paise = purchased_paise + v_refund_pur,
        included_paise  = included_paise  + v_refund_inc
    WHERE owner_id = v_owner_id;

    IF v_refund_pur > 0 THEN
      INSERT INTO public.ai_ledger
        (owner_id, actor_user_id, kind, bucket, amount_paise, feature, reserve_id)
      VALUES
        (v_owner_id, v_actor, 'refund', 'purchased', v_refund_pur, v_feature, p_reserve_id);
    END IF;
    IF v_refund_inc > 0 THEN
      INSERT INTO public.ai_ledger
        (owner_id, actor_user_id, kind, bucket, amount_paise, feature, reserve_id)
      VALUES
        (v_owner_id, v_actor, 'refund', 'included', v_refund_inc, v_feature, p_reserve_id);
    END IF;
  ELSE
    v_extra := -v_diff;
    v_inc_avail := CASE
      WHEN v_wallet.included_expires_at IS NOT NULL
       AND v_wallet.included_expires_at <= now() THEN 0
      ELSE v_wallet.included_paise
    END;
    v_charge_inc := LEAST(v_inc_avail, v_extra);
    v_charge_pur := LEAST(v_wallet.purchased_paise, v_extra - v_charge_inc);

    UPDATE public.ai_wallets
    SET included_paise  = included_paise  - v_charge_inc,
        purchased_paise = purchased_paise - v_charge_pur
    WHERE owner_id = v_owner_id;

    IF v_charge_inc > 0 THEN
      INSERT INTO public.ai_ledger
        (owner_id, actor_user_id, kind, bucket, amount_paise, feature, reserve_id)
      VALUES
        (v_owner_id, v_actor, 'adjustment', 'included', -v_charge_inc, v_feature, p_reserve_id);
    END IF;
    IF v_charge_pur > 0 THEN
      INSERT INTO public.ai_ledger
        (owner_id, actor_user_id, kind, bucket, amount_paise, feature, reserve_id)
      VALUES
        (v_owner_id, v_actor, 'adjustment', 'purchased', -v_charge_pur, v_feature, p_reserve_id);
    END IF;
  END IF;
END;
$$;

-- 8c. ai_release: full refund of a reservation (call when the Sarvam call fails).
--     Each bucket is refunded to itself. Idempotent.
CREATE OR REPLACE FUNCTION public.ai_release(
  p_reserve_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  rec RECORD;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.ai_ledger
    WHERE reserve_id = p_reserve_id AND kind IN ('adjustment', 'refund')
  ) THEN
    RETURN;
  END IF;

  FOR rec IN
    SELECT owner_id, actor_user_id, bucket, amount_paise, feature
    FROM public.ai_ledger
    WHERE reserve_id = p_reserve_id AND kind = 'usage'
  LOOP
    IF rec.bucket = 'included' THEN
      UPDATE public.ai_wallets
      SET included_paise = included_paise + (-rec.amount_paise)
      WHERE owner_id = rec.owner_id;
    ELSE
      UPDATE public.ai_wallets
      SET purchased_paise = purchased_paise + (-rec.amount_paise)
      WHERE owner_id = rec.owner_id;
    END IF;

    INSERT INTO public.ai_ledger
      (owner_id, actor_user_id, kind, bucket, amount_paise, feature, reserve_id)
    VALUES
      (rec.owner_id, rec.actor_user_id, 'refund', rec.bucket, -rec.amount_paise, rec.feature, p_reserve_id);
  END LOOP;
END;
$$;

-- 8d. grant_included_credits: the one-time Rs 1,000 grant.
--     Calling it IS the developer's confirmation that the app fee was received
--     (it stamps app_fee_paid_at). Only once per lawyer. The lawyer must have signed
--     in at least once (p_owner_id is their auth user id, stored in auth_user_id).
CREATE OR REPLACE FUNCTION public.grant_included_credits(
  p_owner_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_granted_at TIMESTAMPTZ;
  v_role       TEXT;
  v_credit     NUMERIC;
  v_valid_days INT;
  v_expires_at TIMESTAMPTZ;
BEGIN
  SELECT included_granted_at, role
  INTO v_granted_at, v_role
  FROM public.approved_users
  WHERE auth_user_id = p_owner_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'owner_not_found: this lawyer has not signed in yet';
  END IF;

  IF v_role <> 'lawyer' THEN
    RAISE EXCEPTION 'not_a_lawyer';
  END IF;

  IF v_granted_at IS NOT NULL THEN
    RETURN; -- already granted: idempotent
  END IF;

  SELECT (value::text)::numeric INTO v_credit
  FROM public.app_config WHERE key = 'included_credit_paise';
  SELECT (value::text)::int INTO v_valid_days
  FROM public.app_config WHERE key = 'included_valid_days';

  v_credit     := COALESCE(v_credit, 100000);
  v_valid_days := COALESCE(v_valid_days, 365);
  v_expires_at := now() + (v_valid_days || ' days')::interval;

  INSERT INTO public.ai_wallets (owner_id, included_paise, included_expires_at)
  VALUES (p_owner_id, v_credit, v_expires_at)
  ON CONFLICT (owner_id) DO UPDATE
    SET included_paise      = public.ai_wallets.included_paise + v_credit,
        included_expires_at = v_expires_at;

  INSERT INTO public.ai_ledger
    (owner_id, kind, bucket, amount_paise, request_ref)
  VALUES
    (p_owner_id, 'grant_included', 'included', v_credit, 'app_fee_grant');

  UPDATE public.approved_users
  SET included_granted_at = now(),
      app_fee_paid_at     = COALESCE(app_fee_paid_at, now())
  WHERE auth_user_id = p_owner_id;
END;
$$;

-- 8e. approve_payment_request: the developer approves a submitted request.
--     Atomic and idempotent (row lock; status must be 'submitted').
--     Recharge: credits = FLOOR(received * percent / 100) into the purchased bucket.
--     Seat / seat renewal: only stamps the request; activation is built in Phase D.
CREATE OR REPLACE FUNCTION public.approve_payment_request(
  p_request_id     UUID,
  p_received_paise NUMERIC,
  p_developer_id   UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_req            RECORD;
  v_credit_percent NUMERIC;
  v_credited       NUMERIC;
BEGIN
  IF p_received_paise IS NULL OR p_received_paise <= 0 THEN
    RAISE EXCEPTION 'invalid_amount';
  END IF;

  SELECT * INTO v_req
  FROM public.payment_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'request_not_found';
  END IF;

  IF v_req.status <> 'submitted' THEN
    RAISE EXCEPTION 'request_not_submitted: current status is %', v_req.status;
  END IF;

  -- Guard against a typing slip (e.g. extra zeros): at most 10x what was requested.
  IF p_received_paise > v_req.amount_expected_paise * 10 THEN
    RAISE EXCEPTION 'amount_out_of_range: received amount is more than 10x the requested amount';
  END IF;

  IF v_req.kind = 'recharge' THEN
    SELECT (value::text)::numeric INTO v_credit_percent
    FROM public.app_config WHERE key = 'recharge_credit_percent';
    v_credit_percent := COALESCE(v_credit_percent, 90);

    v_credited := FLOOR(p_received_paise * v_credit_percent / 100);

    INSERT INTO public.ai_wallets (owner_id, purchased_paise)
    VALUES (v_req.owner_id, v_credited)
    ON CONFLICT (owner_id) DO UPDATE
      SET purchased_paise = public.ai_wallets.purchased_paise + v_credited;

    INSERT INTO public.ai_ledger
      (owner_id, kind, bucket, amount_paise, payment_request_id, request_ref)
    VALUES
      (v_req.owner_id, 'recharge', 'purchased', v_credited, p_request_id, v_req.ref_code);
  ELSE
    v_credited := 0;
  END IF;

  UPDATE public.payment_requests
  SET status                = 'approved',
      amount_received_paise = p_received_paise,
      credited_paise        = v_credited,
      decided_by            = p_developer_id,
      decided_at            = now()
  WHERE id = p_request_id;
END;
$$;

-- 8f. reject_payment_request
CREATE OR REPLACE FUNCTION public.reject_payment_request(
  p_request_id   UUID,
  p_note         TEXT,
  p_developer_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_status TEXT;
BEGIN
  SELECT status INTO v_status
  FROM public.payment_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'request_not_found';
  END IF;

  IF v_status NOT IN ('created', 'submitted') THEN
    RAISE EXCEPTION 'request_already_decided: current status is %', v_status;
  END IF;

  UPDATE public.payment_requests
  SET status        = 'rejected',
      decision_note = p_note,
      decided_by    = p_developer_id,
      decided_at    = now()
  WHERE id = p_request_id;
END;
$$;

-- ------------------------------------------------------------------------------
-- 9. Privileges
--    Functions: only the server (service role) may run them.
--    Tables: lawyers may only SELECT (RLS limits which rows); anon gets nothing.
-- ------------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.ai_reserve(UUID, UUID, TEXT, NUMERIC)        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ai_settle(UUID, NUMERIC, NUMERIC)            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ai_release(UUID)                             FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.grant_included_credits(UUID)                 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.approve_payment_request(UUID, NUMERIC, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reject_payment_request(UUID, TEXT, UUID)     FROM PUBLIC, anon, authenticated;

REVOKE ALL ON public.ai_rate_card, public.ai_wallets, public.ai_ledger, public.payment_requests
  FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.ai_rate_card, public.ai_wallets, public.ai_ledger, public.payment_requests
  FROM authenticated;

NOTIFY pgrst, 'reload schema';
