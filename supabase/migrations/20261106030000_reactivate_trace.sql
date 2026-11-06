-- La reactivación firma al usuario logueado y no pisa quién dio la baja.

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
  v_actor_name text;
  v_actor_email text;
  v_registered text;
  v_stamp jsonb;
  v_last int;
  v_action text;
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

  select full_name, email
  into v_actor_name, v_actor_email
  from public.profiles
  where id = auth.uid();

  v_actor_email := coalesce(v_actor_email, nullif(auth.jwt() ->> 'email', ''));
  v_actor_name := coalesce(nullif(btrim(v_actor_name), ''), v_actor_email, 'Usuario');
  v_registered := to_jsonb(clock_timestamp()) #>> '{}';
  v_stamp := jsonb_build_object(
    'actorId', auth.uid(),
    'actorName', v_actor_name,
    'actorEmail', v_actor_email,
    'registeredAt', v_registered
  );

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

  if p_meta is not null then
    if jsonb_typeof(v_new.meta -> 'lifecycleHistory') = 'array'
       and jsonb_array_length(v_new.meta -> 'lifecycleHistory') > 0 then
      v_last := jsonb_array_length(v_new.meta -> 'lifecycleHistory') - 1;
      v_new.meta := jsonb_set(
        v_new.meta,
        array['lifecycleHistory', v_last::text],
        coalesce(v_new.meta -> 'lifecycleHistory' -> v_last, '{}'::jsonb) || v_stamp
      );
    end if;

    v_new.meta := jsonb_set(
      v_new.meta,
      '{lastLifecycle}',
      coalesce(v_new.meta -> 'lastLifecycle', '{}'::jsonb) || v_stamp
    );

    v_action := coalesce(v_new.meta -> 'lastLifecycle' ->> 'action', '');
    if v_action = 'delete'
       and nullif(btrim(coalesce(v_new.meta ->> 'bajaMotivo', '')), '') is not null then
      v_new.meta := v_new.meta || jsonb_build_object(
        'bajaActorId', auth.uid(),
        'bajaActorName', v_actor_name,
        'bajaActorEmail', v_actor_email,
        'bajaRegistradaAt', v_registered
      );
    elsif v_action = 'activate' then
      v_new.meta := v_new.meta || jsonb_build_object(
        'pendingBaja', false,
        'reactivateActorId', auth.uid(),
        'reactivateActorName', v_actor_name,
        'reactivateActorEmail', v_actor_email,
        'reactivateRegistradaAt', v_registered
      );
    end if;
  end if;

  update public.members
  set status = v_status,
      meta = case when p_meta is null then meta else v_new.meta end,
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
      'actor_id', auth.uid(),
      'actor_name', v_actor_name,
      'actor_email', v_actor_email,
      'registered_at', v_registered,
      'baja_kind', v_new.meta ->> 'bajaKind',
      'baja_motivo', v_new.meta ->> 'bajaMotivo',
      'baja_presentada', v_new.meta ->> 'bajaPresentada',
      'baja_fecha', v_new.meta ->> 'bajaFecha',
      'baja_monto', v_new.meta ->> 'bajaMonto',
      'reactivate_motivo', v_new.meta ->> 'reactivateMotivo',
      'reactivate_fecha', v_new.meta ->> 'reactivateFecha'
    )
  );

  return v_status::text;
end;
$$;

revoke all on function public.cambiar_estado_socio(uuid, text, text, jsonb) from public, anon;
grant execute on function public.cambiar_estado_socio(uuid, text, text, jsonb) to authenticated;

notify pgrst, 'reload schema';
