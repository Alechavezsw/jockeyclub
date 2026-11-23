-- impute_dues_account_payment es security definer y no consulta auth.uid().
-- Con execute para anon o authenticated, la clave pública puede imputar
-- períodos de cualquier socio si conoce un payment_id.
-- La caja no llama esta función: registrar_cobro y el trigger
-- member_payment_posts_dues corren como postgres y conservan el acceso.
--
-- Reversa, solo si hubiera que volver atrás:
-- grant execute on function public.impute_dues_account_payment(uuid, uuid, numeric, jsonb, date)
--   to anon, authenticated;

revoke all on function public.impute_dues_account_payment(uuid, uuid, numeric, jsonb, date) from public;
revoke all on function public.impute_dues_account_payment(uuid, uuid, numeric, jsonb, date) from anon;
revoke all on function public.impute_dues_account_payment(uuid, uuid, numeric, jsonb, date) from authenticated;
grant execute on function public.impute_dues_account_payment(uuid, uuid, numeric, jsonb, date) to service_role;

comment on function public.impute_dues_account_payment(uuid, uuid, numeric, jsonb, date) is
  'Imputa una cuota ya cobrada. Ejecutan service_role y el owner. La caja entra por registrar_cobro o por el trigger member_payment_posts_dues.';
