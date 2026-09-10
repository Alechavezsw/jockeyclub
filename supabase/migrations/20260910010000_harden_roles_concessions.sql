-- Roles: el alta no toma el rol del metadata. Solo superadmin puede
-- asignar admin/superadmin. Concesiones y documentos dejan de ser públicos.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  fname text := coalesce(meta->>'first_name', split_part(coalesce(meta->>'full_name', ''), ' ', 1));
  lname text := coalesce(
    meta->>'last_name',
    nullif(trim(substring(coalesce(meta->>'full_name', '') from length(split_part(coalesce(meta->>'full_name', ''), ' ', 1)) + 1)), '')
  );
  display text := coalesce(
    nullif(trim(concat_ws(' ', fname, lname)), ''),
    meta->>'full_name',
    split_part(new.email, '@', 1)
  );
BEGIN
  INSERT INTO public.profiles (
    id, email, full_name, first_name, last_name, role, phone, avatar_url,
    document_type, document_number, gender, birth_date,
    blood_type, health_insurance, emergency_phone, emergency_clinic, address, prisma_id, meta
  )
  VALUES (
    new.id,
    new.email,
    display,
    nullif(fname, ''),
    nullif(lname, ''),
    'member'::public.app_role,
    meta->>'phone',
    meta->>'avatar_url',
    meta->>'document_type',
    meta->>'document_number',
    meta->>'gender',
    nullif(meta->>'birth_date', '')::date,
    meta->>'blood_type',
    meta->>'health_insurance',
    meta->>'emergency_phone',
    meta->>'emergency_clinic',
    meta->>'address',
    meta->>'prisma_id',
    coalesce(meta->'profile_meta', '{}'::jsonb)
  )
  ON CONFLICT (id) DO UPDATE SET
    email = excluded.email,
    full_name = excluded.full_name,
    first_name = coalesce(excluded.first_name, public.profiles.first_name),
    last_name = coalesce(excluded.last_name, public.profiles.last_name),
    updated_at = now();
  RETURN new;
END;
$function$;

CREATE OR REPLACE FUNCTION public.protect_privileged_profile_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.role IS DISTINCT FROM OLD.role
     AND NEW.role::text IN ('admin', 'superadmin')
     AND NOT public.user_has_role('superadmin') THEN
    RAISE EXCEPTION 'Solo un superadmin puede asignar el rol %', NEW.role;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_protect_privileged_profile_role ON public.profiles;
CREATE TRIGGER trg_protect_privileged_profile_role
  BEFORE UPDATE OF role ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_privileged_profile_role();

CREATE OR REPLACE FUNCTION public.protect_privileged_profile_roles()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;
  IF NEW.revoked_at IS NULL
     AND lower(NEW.role_key) IN ('admin', 'superadmin')
     AND NOT public.user_has_role('superadmin') THEN
    RAISE EXCEPTION 'Solo un superadmin puede asignar el rol %', NEW.role_key;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_protect_privileged_profile_roles ON public.profile_roles;
CREATE TRIGGER trg_protect_privileged_profile_roles
  BEFORE INSERT OR UPDATE ON public.profile_roles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_privileged_profile_roles();

DROP POLICY IF EXISTS concessions_select ON public.concessions;
CREATE POLICY concessions_select ON public.concessions
  FOR SELECT
  USING (has_staff_access() OR has_accounting_access() OR has_admin_access());

CREATE OR REPLACE FUNCTION public.concession_portal_by_code(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  c public.concessions;
  pays jsonb;
  code text := upper(trim(coalesce(p_code, '')));
BEGIN
  IF length(code) < 6 THEN
    RETURN NULL;
  END IF;

  SELECT * INTO c
  FROM public.concessions
  WHERE upper(trim(portal_code)) = code
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.paid_at DESC NULLS LAST), '[]'::jsonb)
    INTO pays
  FROM public.canon_payments p
  WHERE p.concession_id = c.id;

  RETURN jsonb_build_object('concession', to_jsonb(c), 'payments', pays);
END;
$function$;

REVOKE ALL ON FUNCTION public.concession_portal_by_code(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.concession_portal_by_code(text) TO anon, authenticated;

DROP POLICY IF EXISTS waitlist_select ON public.reservation_waitlist;
CREATE POLICY waitlist_select ON public.reservation_waitlist
  FOR SELECT
  USING (
    has_staff_access()
    OR EXISTS (
      SELECT 1 FROM public.members m
      WHERE m.id = reservation_waitlist.member_id AND m.profile_id = auth.uid()
    )
    OR member_number IN (
      SELECT members.member_number FROM public.members WHERE members.profile_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS concession_docs_public_read ON storage.objects;
CREATE POLICY concession_docs_staff_read ON storage.objects
  FOR SELECT
  TO public
  USING (
    bucket_id = 'concession-docs'
    AND (has_staff_access() OR has_admin_access() OR has_accounting_access())
  );

UPDATE storage.buckets SET public = false WHERE id = 'concession-docs';

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_profile_primary_role(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trace_profile_changes() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trace_profile_role_changes() FROM PUBLIC, anon, authenticated;
