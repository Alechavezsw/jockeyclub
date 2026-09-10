-- Ocupación de canchas sin PII. QR de credencial por token. RLS de reservas.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS credential_token text;

UPDATE public.members
SET credential_token = encode(gen_random_bytes(16), 'hex')
WHERE credential_token IS NULL OR btrim(credential_token) = '';

ALTER TABLE public.members
  ALTER COLUMN credential_token SET DEFAULT encode(gen_random_bytes(16), 'hex');

CREATE UNIQUE INDEX IF NOT EXISTS members_credential_token_uidx
  ON public.members (credential_token)
  WHERE credential_token IS NOT NULL;

DROP VIEW IF EXISTS public.reservation_occupancy;
CREATE VIEW public.reservation_occupancy
WITH (security_invoker = false)
AS
SELECT
  id,
  facility_id,
  reservation_date,
  time_slot,
  status,
  guests,
  created_at
FROM public.reservations
WHERE coalesce(status, '') IS DISTINCT FROM 'cancelled';

GRANT SELECT ON public.reservation_occupancy TO authenticated;

DROP POLICY IF EXISTS reservations_select ON public.reservations;
CREATE POLICY reservations_select ON public.reservations
  FOR SELECT
  USING (
    has_staff_access()
    OR EXISTS (
      SELECT 1 FROM public.members m
      WHERE m.id = reservations.member_id AND m.profile_id = auth.uid()
    )
    OR member_number IN (
      SELECT members.member_number FROM public.members WHERE members.profile_id = auth.uid()
    )
  );

NOTIFY pgrst, 'reload schema';
