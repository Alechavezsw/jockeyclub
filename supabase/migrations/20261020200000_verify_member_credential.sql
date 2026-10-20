-- Verifica la firma del QR de un socio sin mandar el secreto al navegador del portero.
-- Antes el molinete bajaba la ficha entera (con credential_token) en cada lectura; ahora
-- le pregunta al servidor "¿esta firma es la de este socio?" y recibe solo sí o no.
-- Solo personal con acceso (portería, caja, administración).

create or replace function public.verify_member_credential(p_member_number text, p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  stored text;
  clean text := lower(btrim(coalesce(p_token, '')));
begin
  if not (select public.has_staff_access()) then
    return jsonb_build_object('found', false, 'valid', false, 'reason', 'forbidden');
  end if;

  select lower(btrim(coalesce(m.credential_token, '')))
    into stored
  from public.members m
  where m.member_number::text = btrim(coalesce(p_member_number, ''))
  limit 1;

  if not found then
    return jsonb_build_object('found', false, 'valid', false);
  end if;

  return jsonb_build_object(
    'found', true,
    'valid', clean <> '' and stored <> '' and stored = clean
  );
end;
$$;

revoke all on function public.verify_member_credential(text, text) from public;
grant execute on function public.verify_member_credential(text, text) to authenticated;
