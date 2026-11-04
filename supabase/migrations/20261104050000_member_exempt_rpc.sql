-- Portero, contador y admin no pueden pasar un socio a vitalicio por la API.
-- Ese PATCH dispara zero_exempt_member_dues y deja el saldo en 0.
-- tier, status y meta solo se escriben por RPC. La exención, solo un superadmin con motivo.

create or replace function public.reject_member_privileged_columns()
returns trigger
language plpgsql
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if new.tier is distinct from old.tier
       or new.status is distinct from old.status
       or new.meta is distinct from old.meta then
      raise exception 'tier, status y meta no se editan por la API.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_reject_member_privileged_columns on public.members;
create trigger trg_reject_member_privileged_columns
before update of tier, status, meta on public.members
for each row
execute function public.reject_member_privileged_columns();

revoke update on table public.members from authenticated, anon, public;

grant update (
  id,
  profile_id,
  member_number,
  card_number,
  full_name,
  phone,
  email,
  outstanding_balance,
  years_active,
  joined_at,
  next_due_date,
  overdue_since,
  disciplines,
  document_number,
  address,
  city,
  province,
  notes,
  created_at,
  updated_at,
  phone_alt,
  postal_code,
  document_type,
  birth_date,
  gender,
  marital_status,
  nationality,
  emergency_contact,
  emergency_phone,
  payment_method,
  billing_name,
  cuit_cuil,
  tax_condition,
  photo_url,
  credential_token
) on table public.members to authenticated;

create or replace function public.eximir_cuota_socio(
  p_member_id uuid,
  p_tier text,
  p_reason text
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.members;
  v_tier text := nullif(lower(btrim(coalesce(p_tier, ''))), '');
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_label text;
  v_balance numeric;
begin
  if auth.uid() is null then
    raise exception 'Tenés que estar logueado.';
  end if;
  if not (
    public.user_has_role('superadmin')
    or public.current_role() = 'superadmin'
  ) then
    raise exception 'Solo un superadmin puede eximir la cuota.';
  end if;
  if v_reason is null or char_length(v_reason) < 8 then
    raise exception 'Falta el motivo de la exención (mínimo 8 caracteres).';
  end if;
  if v_tier is null or v_tier !~ '(vitalicio|fundador|^comision$)' then
    raise exception 'La categoría no exime la cuota.';
  end if;

  select * into v_old
  from public.members
  where id = p_member_id
  for update;

  if not found then
    raise exception 'No se encontró el socio.';
  end if;

  v_label := case
    when v_tier ~ 'fundador' then 'FUNDADOR'
    when v_tier ~ '^comision$' then 'COMISION'
    else 'VITALICIO'
  end;

  update public.members
  set tier = v_tier,
      meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object('cuotaCategories', jsonb_build_array(v_label)),
      updated_at = now()
  where id = p_member_id
  returning outstanding_balance into v_balance;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  values (
    auth.uid(),
    'eximir_cuota',
    'members',
    p_member_id,
    jsonb_build_object(
      'old', jsonb_build_object(
        'tier', v_old.tier,
        'outstanding_balance', v_old.outstanding_balance,
        'cuotaCategories', v_old.meta->'cuotaCategories'
      ),
      'new', jsonb_build_object(
        'tier', v_tier,
        'outstanding_balance', v_balance,
        'cuotaCategories', jsonb_build_array(v_label)
      ),
      'reason', v_reason,
      'actor_id', auth.uid()
    )
  );

  return coalesce(v_balance, 0);
end;
$$;

create or replace function public.cambiar_categoria_socio(
  p_member_id uuid,
  p_tier text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.members;
  v_new public.members;
  v_tier text := nullif(btrim(coalesce(p_tier, '')), '');
begin
  if auth.uid() is null then
    raise exception 'Tenés que estar logueado.';
  end if;
  if not public.has_admin_access() then
    raise exception 'Sin permiso para cambiar la categoría.';
  end if;
  if v_tier is null then
    raise exception 'Falta la categoría.';
  end if;

  select * into v_old
  from public.members
  where id = p_member_id
  for update;

  if not found then
    raise exception 'No se encontró el socio.';
  end if;

  v_new := v_old;
  v_new.tier := v_tier;
  if public.member_is_dues_exempt(v_old) or public.member_is_dues_exempt(v_new) then
    raise exception 'La exención de cuota solo la hace un superadmin, con motivo.';
  end if;

  update public.members
  set tier = v_tier,
      updated_at = now()
  where id = p_member_id;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  values (
    auth.uid(),
    'cambiar_categoria',
    'members',
    p_member_id,
    jsonb_build_object(
      'old', jsonb_build_object('tier', v_old.tier),
      'new', jsonb_build_object('tier', v_tier),
      'actor_id', auth.uid()
    )
  );

  return v_tier;
end;
$$;

create or replace function public.guardar_meta_socio(
  p_member_id uuid,
  p_meta jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.members;
  v_new public.members;
begin
  if auth.uid() is null then
    raise exception 'Tenés que estar logueado.';
  end if;
  if not (
    public.has_admin_access()
    or public.user_has_role('accountant')
    or public.current_role() = 'accountant'
    or exists (
      select 1
      from public.members m
      where m.id = p_member_id
        and m.profile_id = auth.uid()
    )
  ) then
    raise exception 'Sin permiso para editar la ficha.';
  end if;

  select * into v_old
  from public.members
  where id = p_member_id
  for update;

  if not found then
    raise exception 'No se encontró el socio.';
  end if;

  v_new := v_old;
  v_new.meta := coalesce(p_meta, '{}'::jsonb);
  if public.member_is_dues_exempt(v_new) and not public.member_is_dues_exempt(v_old) then
    raise exception 'La exención de cuota solo la hace un superadmin, con motivo.';
  end if;

  update public.members
  set meta = v_new.meta,
      updated_at = now()
  where id = p_member_id;

  return v_new.meta;
end;
$$;

create or replace function public.cambiar_estado_socio(
  p_member_id uuid,
  p_status text,
  p_reason text,
  p_meta jsonb default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.members;
  v_new public.members;
  v_status public.member_status;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if auth.uid() is null then
    raise exception 'Tenés que estar logueado.';
  end if;
  if not public.has_admin_access() then
    raise exception 'Sin permiso para cambiar el estado.';
  end if;
  if v_reason is null or char_length(v_reason) < 8 then
    raise exception 'Falta el motivo (mínimo 8 caracteres).';
  end if;

  begin
    v_status := p_status::public.member_status;
  exception when invalid_text_representation then
    raise exception 'Estado inválido.';
  end;

  select * into v_old
  from public.members
  where id = p_member_id
  for update;

  if not found then
    raise exception 'No se encontró el socio.';
  end if;

  v_new := v_old;
  v_new.status := v_status;
  if p_meta is not null then
    v_new.meta := p_meta;
  end if;
  if public.member_is_dues_exempt(v_new) and not public.member_is_dues_exempt(v_old) then
    raise exception 'La exención de cuota solo la hace un superadmin, con motivo.';
  end if;

  update public.members
  set status = v_status,
      meta = case when p_meta is null then meta else p_meta end,
      updated_at = now()
  where id = p_member_id;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  values (
    auth.uid(),
    'cambiar_estado',
    'members',
    p_member_id,
    jsonb_build_object(
      'old', jsonb_build_object('status', v_old.status),
      'new', jsonb_build_object('status', v_status),
      'reason', v_reason,
      'actor_id', auth.uid()
    )
  );

  return v_status::text;
end;
$$;

revoke all on function public.eximir_cuota_socio(uuid, text, text) from public, anon;
revoke all on function public.cambiar_categoria_socio(uuid, text) from public, anon;
revoke all on function public.guardar_meta_socio(uuid, jsonb) from public, anon;
revoke all on function public.cambiar_estado_socio(uuid, text, text, jsonb) from public, anon;

grant execute on function public.eximir_cuota_socio(uuid, text, text) to authenticated;
grant execute on function public.cambiar_categoria_socio(uuid, text) to authenticated;
grant execute on function public.guardar_meta_socio(uuid, jsonb) to authenticated;
grant execute on function public.cambiar_estado_socio(uuid, text, text, jsonb) to authenticated;

notify pgrst, 'reload schema';
