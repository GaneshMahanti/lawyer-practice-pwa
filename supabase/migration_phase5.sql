-- VakilDesk Phase 5: demo isolation, reminder prefs, OCR audit, hearing bookings,
-- practice-active clients, diary transcript provenance, privileged-table locks.
-- Idempotent. Apply after complete_setup.sql.

CREATE TABLE IF NOT EXISTS public.demo_workspaces (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    reset_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.reminder_preferences (
    owner_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    offsets_minutes INTEGER[] NOT NULL DEFAULT ARRAY[1440, 120],
    in_app_enabled BOOLEAN NOT NULL DEFAULT true,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT reminder_offsets_valid CHECK (
      cardinality(offsets_minutes) > 0
      AND cardinality(offsets_minutes) <= 5
      AND offsets_minutes <@ ARRAY[15,30,60,120,1440,2880,10080]
    )
);

CREATE TABLE IF NOT EXISTS public.external_ocr_audit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    matter_id UUID REFERENCES public.matters(id) ON DELETE SET NULL,
    provider TEXT NOT NULL,
    outcome TEXT NOT NULL CHECK (outcome IN ('success', 'failure')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS is_practice_active BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE public.diary_entries
  ADD COLUMN IF NOT EXISTS original_transcript TEXT,
  ADD COLUMN IF NOT EXISTS edited_transcript TEXT,
  ADD COLUMN IF NOT EXISTS transcript_edited_at TIMESTAMPTZ;

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS original_text TEXT,
  ADD COLUMN IF NOT EXISTS translated_text TEXT,
  ADD COLUMN IF NOT EXISTS image_url TEXT;

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';

DO $$ BEGIN
  ALTER TABLE public.bookings
    ADD CONSTRAINT bookings_source_check CHECK (source IN ('manual', 'matter_hearing'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_matter_hearing
  ON public.bookings(owner_id, matter_id)
  WHERE source = 'matter_hearing' AND matter_id IS NOT NULL;

ALTER TABLE public.demo_workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reminder_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.external_ocr_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "demo_workspace_owner_access" ON public.demo_workspaces;
CREATE POLICY "demo_workspace_owner_access" ON public.demo_workspaces
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "reminder_preferences_owner_access" ON public.reminder_preferences;
CREATE POLICY "reminder_preferences_owner_access" ON public.reminder_preferences
  FOR ALL USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "external_ocr_audit_owner_access" ON public.external_ocr_audit;
CREATE POLICY "external_ocr_audit_owner_access" ON public.external_ocr_audit
  FOR SELECT USING (auth.uid() = owner_id);

-- Anonymous sessions may never touch portal, payments, or the allowlist.
DROP POLICY IF EXISTS "portal_invites_owner_policy" ON public.portal_invites;
CREATE POLICY "portal_invites_owner_policy" ON public.portal_invites
  FOR ALL
  USING (auth.uid() = owner_id AND COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false) IS NOT TRUE)
  WITH CHECK (auth.uid() = owner_id AND COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false) IS NOT TRUE);

DROP POLICY IF EXISTS "portal_submissions_owner_policy" ON public.portal_submissions;
CREATE POLICY "portal_submissions_owner_policy" ON public.portal_submissions
  FOR SELECT
  USING (auth.uid() = owner_id AND COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false) IS NOT TRUE);

DROP POLICY IF EXISTS "invoices_owner_access" ON public.invoices;
CREATE POLICY "invoices_owner_access" ON public.invoices
  FOR ALL
  USING (auth.uid() = owner_id AND COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false) IS NOT TRUE)
  WITH CHECK (auth.uid() = owner_id AND COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false) IS NOT TRUE);

DROP POLICY IF EXISTS "payments_owner_access" ON public.payments;
CREATE POLICY "payments_owner_access" ON public.payments
  FOR ALL
  USING (auth.uid() = owner_id AND COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false) IS NOT TRUE)
  WITH CHECK (auth.uid() = owner_id AND COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false) IS NOT TRUE);

REVOKE ALL ON public.approved_users FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.prevent_demo_whatsapp_reminders()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false) IS TRUE AND NEW.channel = 'whatsapp' THEN
    RAISE EXCEPTION 'whatsapp reminders are not available in demo mode';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_demo_whatsapp ON public.reminders;
CREATE TRIGGER trg_prevent_demo_whatsapp
BEFORE INSERT OR UPDATE ON public.reminders
FOR EACH ROW EXECUTE FUNCTION public.prevent_demo_whatsapp_reminders();

-- Bookings remain the calendar source of truth for hearing dates.
CREATE OR REPLACE FUNCTION public.sync_matter_hearing_booking()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NEW.owner_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'owner mismatch';
  END IF;

  IF NEW.status = 'Disposed/Closed' OR NEW.next_hearing_date IS NULL THEN
    UPDATE public.bookings
      SET status = 'cancelled', updated_at = now()
      WHERE owner_id = NEW.owner_id
        AND matter_id = NEW.id
        AND source = 'matter_hearing'
        AND status = 'scheduled';
  ELSE
    UPDATE public.bookings
      SET
        client_id = NEW.client_id,
        start_at = NEW.next_hearing_date,
        end_at = NEW.next_hearing_date + interval '1 hour',
        purpose = COALESCE(NULLIF(NEW.title, ''), 'Court hearing'),
        status = 'scheduled',
        notes = 'Hearing derived from matter next court date',
        updated_at = now()
      WHERE owner_id = NEW.owner_id
        AND matter_id = NEW.id
        AND source = 'matter_hearing';

    IF NOT FOUND THEN
      INSERT INTO public.bookings (
        owner_id, client_id, matter_id, start_at, end_at, timezone, purpose, status, notes, source
      ) VALUES (
        NEW.owner_id,
        NEW.client_id,
        NEW.id,
        NEW.next_hearing_date,
        NEW.next_hearing_date + interval '1 hour',
        'Asia/Kolkata',
        COALESCE(NULLIF(NEW.title, ''), 'Court hearing'),
        'scheduled',
        'Hearing derived from matter next court date',
        'matter_hearing'
      );
    END IF;
  END IF;

  UPDATE public.clients
    SET
      case_reference = NEW.matter_number,
      is_practice_active = CASE
        WHEN NEW.status = 'Disposed/Closed' AND NOT EXISTS (
          SELECT 1 FROM public.matters m
          WHERE m.client_id = NEW.client_id
            AND m.owner_id = NEW.owner_id
            AND m.id IS DISTINCT FROM NEW.id
            AND m.status IS DISTINCT FROM 'Disposed/Closed'
        ) THEN false
        ELSE true
      END,
      updated_at = now()
    WHERE id = NEW.client_id AND owner_id = NEW.owner_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_matter_hearing_booking ON public.matters;
CREATE TRIGGER trg_sync_matter_hearing_booking
AFTER INSERT OR UPDATE OF next_hearing_date, status, title, client_id, matter_number
ON public.matters
FOR EACH ROW EXECUTE FUNCTION public.sync_matter_hearing_booking();

CREATE OR REPLACE FUNCTION public.reset_demo_workspace()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  demo_id UUID := auth.uid();
  sample_client UUID := gen_random_uuid();
  sample_matter UUID := gen_random_uuid();
BEGIN
  IF demo_id IS NULL OR COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'demo access required';
  END IF;

  INSERT INTO public.demo_workspaces(user_id) VALUES (demo_id)
  ON CONFLICT (user_id) DO UPDATE SET reset_at = now();

  DELETE FROM public.reminders WHERE owner_id = demo_id;
  DELETE FROM public.bookings WHERE owner_id = demo_id;
  DELETE FROM public.diary_entries WHERE owner_id = demo_id;
  DELETE FROM public.documents WHERE owner_id = demo_id;
  DELETE FROM public.court_lookups WHERE owner_id = demo_id;
  DELETE FROM public.client_fees WHERE owner_id = demo_id;
  DELETE FROM public.matters WHERE owner_id = demo_id;
  DELETE FROM public.clients WHERE owner_id = demo_id;
  DELETE FROM public.profiles WHERE user_id = demo_id;
  DELETE FROM public.reminder_preferences WHERE owner_id = demo_id;

  INSERT INTO public.profiles(user_id, display_name, preferred_language, timezone, onboarding_completed)
    VALUES (demo_id, 'Demo Advocate', 'en', 'Asia/Kolkata', true);
  INSERT INTO public.clients(id, owner_id, name, phone, email, case_reference, notes, status, is_practice_active, preferred_language)
    VALUES (sample_client, demo_id, 'Asha Rao (Sample)', '9000000001', 'asha@example.test', 'DEMO 12/2026', 'Fictional demo client.', 'active', true, 'en');
  INSERT INTO public.matters(
    id, owner_id, client_id, matter_number, title, court_name, matter_type, case_type, category, status, next_hearing_date, state, district, court_complex, case_year
  ) VALUES (
    sample_matter, demo_id, sample_client, 'CC 12/2026', 'Sample Consumer Matter',
    'Demo District Court Complex, Visakhapatnam', 'Consumer', 'Consumer Complaint', 'Consumer', 'Active',
    now() + interval '7 days', 'Andhra Pradesh', 'Visakhapatnam', 'Visakhapatnam District Court Complex', EXTRACT(YEAR FROM now())::int
  );
  INSERT INTO public.diary_entries(owner_id, client_id, matter_id, entry_type, title, content, transcript, transcription_status, language)
    VALUES (demo_id, sample_client, sample_matter, 'text', 'Sample diary note', 'Review fictional consumer matter before hearing.', 'Review fictional consumer matter before hearing.', 'completed', 'en');
  INSERT INTO public.reminder_preferences(owner_id) VALUES (demo_id)
    ON CONFLICT (owner_id) DO UPDATE SET offsets_minutes = ARRAY[1440,120], in_app_enabled = true, updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.seed_demo_workspace()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  demo_id UUID := auth.uid();
BEGIN
  IF demo_id IS NULL OR COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'demo access required';
  END IF;

  IF EXISTS (SELECT 1 FROM public.demo_workspaces WHERE user_id = demo_id) THEN
    RETURN;
  END IF;

  PERFORM public.reset_demo_workspace();
END;
$$;

REVOKE ALL ON FUNCTION public.reset_demo_workspace() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.seed_demo_workspace() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reset_demo_workspace() TO authenticated;
GRANT EXECUTE ON FUNCTION public.seed_demo_workspace() TO authenticated;
