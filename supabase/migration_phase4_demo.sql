-- VakilDesk Phase 4: anonymous demo workspaces, preferences, and OCR audit.
-- Apply after complete_setup.sql / phases 2 and 3.

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

-- SECURITY DEFINER is limited to the caller's anonymous UUID. It never reads
-- or writes any other workspace and never touches approved_users.
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
  DELETE FROM public.payments WHERE owner_id = demo_id;
  DELETE FROM public.invoices WHERE owner_id = demo_id;
  DELETE FROM public.matters WHERE owner_id = demo_id;
  DELETE FROM public.clients WHERE owner_id = demo_id;
  DELETE FROM public.profiles WHERE user_id = demo_id;

  INSERT INTO public.profiles(user_id, display_name, preferred_language, timezone)
    VALUES (demo_id, 'Demo Advocate', 'en', 'Asia/Kolkata');
  INSERT INTO public.clients(id, owner_id, name, phone, email, case_reference, notes)
    VALUES (sample_client, demo_id, 'Asha Rao (Sample)', '9000000001', 'asha@example.test', 'DEMO-001', 'Fictional demo client.');
  INSERT INTO public.matters(id, owner_id, client_id, matter_number, title, court_name, matter_type, case_type, status, next_hearing_date)
    VALUES (sample_matter, demo_id, sample_client, 'DEMO 12/2026', 'Sample Consumer Matter', 'Demo District Court', 'Consumer', 'Consumer Complaint', 'Active', now() + interval '7 days');
  INSERT INTO public.bookings(owner_id, client_id, matter_id, start_at, end_at, timezone, purpose, status, notes)
    VALUES (demo_id, sample_client, sample_matter, now() + interval '7 days', now() + interval '7 days 1 hour', 'Asia/Kolkata', 'Sample court hearing', 'scheduled', 'Fictional demo event.');
  INSERT INTO public.diary_entries(owner_id, client_id, matter_id, transcript, transcription_status, language)
    VALUES (demo_id, sample_client, sample_matter, 'Sample note: review fictional consumer matter before hearing.', 'completed', 'en');
  INSERT INTO public.reminder_preferences(owner_id) VALUES (demo_id)
    ON CONFLICT (owner_id) DO UPDATE SET offsets_minutes = ARRAY[1440,120], in_app_enabled = true, updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.reset_demo_workspace() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reset_demo_workspace() TO authenticated;
