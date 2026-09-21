-- ==============================================================================
-- VakilDesk Phase 9: developer AI-usage report
-- Idempotent. One SECURITY DEFINER function, callable only by the server (service role).
-- Powers the "AI credits and usage" card in the DEVELOPER's Settings.
-- A call counts only if it actually cost something (failed calls that were fully
-- refunded are not counted).
-- ==============================================================================

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
    ), '[]'::jsonb)
  );
$$;

REVOKE ALL ON FUNCTION public.admin_ai_usage_report(TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
