-- Cambio de categoría: además del tier, permite un ajuste de capital abierto
-- (meses impagos) en la misma transacción. No reescribe pagosos ni pagos.
-- Idempotencia por source en member_dues_entries.

drop function if exists public.cambiar_categoria_socio(uuid, text);

create or replace function public.cambiar_categoria_socio(
  p_member_id uuid,
  p_tier text,
  p_adjust_amount numeric default 0,
  p_reason text default null,
  p_periods jsonb default '[]'::jsonb,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.members;
  v_new public.members;
  v_tier text := nullif(btrim(coalesce(p_tier, '')), '');
  v_adjust numeric := round(coalesce(p_adjust_amount, 0), 2);
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_source text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_balance numeric;
  v_old_balance numeric;
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

  if abs(v_adjust) > 0.009 then
    if v_reason is null or char_length(v_reason) < 8 then
      raise exception 'Falta el motivo del ajuste de cuota (mínimo 8 caracteres).';
    end if;
    if v_source is null then
      v_source := format(
        'categoria:%s:%s->%s:%s',
        p_member_id::text,
        coalesce(v_old.tier::text, ''),
        v_tier,
        to_char(now() at time zone 'America/Argentina/Buenos_Aires', 'YYYYMMDDHH24MISS')
      );
    end if;
  end if;

  v_old_balance := coalesce(v_old.outstanding_balance, 0);

  update public.members
  set tier = v_tier,
      updated_at = now()
  where id = p_member_id;

  if abs(v_adjust) > 0.009 then
    insert into public.member_dues_entries (member_id, amount, kind, source)
    values (p_member_id, v_adjust, 'ajuste_categoria', v_source)
    on conflict (source) where source <> '' do nothing;
  end if;

  -- Forzar refresh del trigger de saldo.
  update public.members
  set updated_at = now()
  where id = p_member_id
  returning outstanding_balance into v_balance;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  values (
    auth.uid(),
    'cambiar_categoria',
    'members',
    p_member_id,
    jsonb_build_object(
      'old', jsonb_build_object(
        'tier', v_old.tier,
        'outstanding_balance', v_old_balance
      ),
      'new', jsonb_build_object(
        'tier', v_tier,
        'outstanding_balance', coalesce(v_balance, v_old_balance)
      ),
      'adjust_amount', v_adjust,
      'periods', coalesce(p_periods, '[]'::jsonb),
      'reason', v_reason,
      'idempotency_key', v_source,
      'actor_id', auth.uid(),
      'member_number', v_old.member_number
    )
  );

  return jsonb_build_object(
    'tier', v_tier,
    'adjust_amount', v_adjust,
    'outstanding_balance', coalesce(v_balance, v_old_balance),
    'idempotency_key', v_source
  );
end;
$$;

revoke all on function public.cambiar_categoria_socio(uuid, text, numeric, text, jsonb, text)
  from public, anon;
grant execute on function public.cambiar_categoria_socio(uuid, text, numeric, text, jsonb, text)
  to authenticated;
