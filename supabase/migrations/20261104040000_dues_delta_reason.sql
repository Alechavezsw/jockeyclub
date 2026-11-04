-- Bajar o ajustar un saldo ya no es un importe libre.
-- Solo superadmin o contador, con motivo y fila de auditoría.
-- El alta de un socio sigue pudiendo cargar deuda positiva.

drop function if exists public.post_member_dues_delta(uuid, numeric, text, text);

create function public.post_member_dues_delta(
  p_member_id uuid,
  p_amount numeric,
  p_kind text default 'ajuste',
  p_source text default '',
  p_reason text default null
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance numeric;
  v_old numeric;
  v_kind text := coalesce(nullif(btrim(p_kind), ''), 'ajuste');
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_amount numeric := round(coalesce(p_amount, 0), 2);
  v_manual boolean;
begin
  if auth.uid() is null then
    raise exception 'Tenés que estar logueado.';
  end if;
  if v_kind in ('surcharge_credit', 'waive')
     or coalesce(p_source, '') like 'surcharge-off:%' then
    raise exception 'El recargo se quita solo con quitar_recargo_cuota.';
  end if;
  if p_member_id is null or v_amount = 0 then
    select public.member_dues_balance(p_member_id) into v_balance;
    return coalesce(v_balance, 0);
  end if;

  v_manual := v_amount < 0 or v_kind = 'ajuste' or v_kind is distinct from 'alta';

  if v_manual then
    if not (
      public.user_has_role('superadmin')
      or public.user_has_role('accountant')
      or public.current_role() in ('superadmin', 'accountant')
    ) then
      raise exception 'Solo un superadmin o el contador puede ajustar el saldo.';
    end if;
    if v_reason is null or char_length(v_reason) < 8 then
      raise exception 'Falta el motivo del ajuste (mínimo 8 caracteres).';
    end if;
  elsif not (
    public.has_admin_access()
    or public.user_has_role('accountant')
    or public.user_has_role('superadmin')
  ) or coalesce(p_source, '') not like 'alta:%' or v_amount < 0 then
    raise exception 'Sin permiso para mover el saldo.';
  end if;

  select outstanding_balance into v_old
  from public.members
  where id = p_member_id
  for update;

  if not found then
    raise exception 'No se encontró el socio.';
  end if;

  insert into public.member_dues_entries (member_id, amount, kind, source)
  values (p_member_id, v_amount, v_kind, coalesce(p_source, ''))
  on conflict (source) where source <> '' do nothing;

  update public.members
  set updated_at = now()
  where id = p_member_id
  returning outstanding_balance into v_balance;

  if v_manual then
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, payload)
    values (
      auth.uid(),
      'ajuste_saldo',
      'members',
      p_member_id,
      jsonb_build_object(
        'old', jsonb_build_object('outstanding_balance', v_old),
        'new', jsonb_build_object('outstanding_balance', v_balance),
        'amount', v_amount,
        'kind', v_kind,
        'source', coalesce(p_source, ''),
        'reason', v_reason,
        'actor_id', auth.uid()
      )
    );
  end if;

  return coalesce(v_balance, 0);
end;
$$;

revoke all on function public.post_member_dues_delta(uuid, numeric, text, text, text) from public, anon;
grant execute on function public.post_member_dues_delta(uuid, numeric, text, text, text) to authenticated;
