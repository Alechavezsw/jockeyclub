-- Primera cuota social del mes de alta.
-- No es un cargo de inscripción. Una sola obligación, idempotente.
-- No reescribe altas ya conciliadas (meta.altaMonthlyQuotaReconciliation).
-- No aplicar en producción hasta autorización expresa.

create or replace function public.registrar_primera_cuota_alta(
  p_member_id uuid,
  p_join_date date default null,
  p_charge boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
set timezone to 'America/Argentina/Buenos_Aires'
as $$
declare
  v_member public.members%rowtype;
  v_join date;
  v_due date;
  v_next date;
  v_day int := 10;
  v_tier text;
  v_amount numeric := 0;
  v_late numeric := 0;
  v_tennis numeric := 0;
  v_catalog numeric;
  v_account text;
  v_source text;
  v_entry uuid;
  v_line text;
  v_principal text;
  v_self text;
  v_label text;
  v_balance numeric;
  v_month int;
  v_months text[] := array[
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
  ];
begin
  if auth.uid() is null then
    raise exception 'Tenés que estar logueado.';
  end if;
  if not (
    public.has_admin_access()
    or public.user_has_role('accountant')
    or public.user_has_role('superadmin')
  ) then
    raise exception 'Sin permiso para dar de alta la primera cuota.';
  end if;
  if p_member_id is null then
    raise exception 'Socio inválido.';
  end if;

  select * into v_member
  from public.members
  where id = p_member_id
  for update;

  if not found then
    raise exception 'No se encontró el socio.';
  end if;

  if coalesce(p_charge, true) = false then
    return jsonb_build_object('status', 'skipped', 'reason', 'sin_cargo');
  end if;

  if v_member.meta ? 'altaMonthlyQuotaReconciliation' then
    return jsonb_build_object(
      'status', 'already',
      'preserved', true,
      'memberNumber', v_member.member_number
    );
  end if;

  v_principal := nullif(btrim(coalesce(v_member.meta->>'familyPrincipalNumber', '')), '');
  v_self := nullif(btrim(coalesce(v_member.member_number, '')), '');
  if v_principal is not null and v_principal is distinct from v_self then
    return jsonb_build_object('status', 'skipped', 'reason', 'integrante');
  end if;

  v_tier := lower(btrim(coalesce(v_member.tier::text, '')));
  if v_tier like 'grupo_familiar%' then
    return jsonb_build_object('status', 'skipped', 'reason', 'integrante');
  end if;

  v_join := coalesce(p_join_date, v_member.joined_at::date, public.club_today());
  if public.member_is_amet_dues(v_member) then
    v_day := 18;
  end if;
  v_due := (date_trunc('month', v_join)::date + (v_day - 1));
  v_next := ((date_trunc('month', v_join) + interval '1 month')::date + (v_day - 1));
  v_month := extract(month from v_due)::int;
  v_label := 'Primera cuota social — ' || v_months[v_month] || ' de ' || to_char(v_due, 'YYYY');

  if exists (
    select 1
    from public.member_dues_entries e
    where e.member_id = p_member_id
      and e.kind = 'alta'
      and coalesce(e.charge_scope, 'cuota_social') is distinct from 'abono_tenis'
  ) or exists (
    select 1
    from public.member_dues_periods p
    where p.member_id = p_member_id
      and p.due_on = v_due
      and p.capital > 0
  ) then
    return jsonb_build_object(
      'status', 'already',
      'dueOn', to_char(v_due, 'YYYY-MM-DD'),
      'memberNumber', v_member.member_number
    );
  end if;

  if not public.member_is_dues_exempt(v_member) then
    select
      case
        when (elem->>'isActive') = 'false' then null
        when coalesce(elem->>'monthlyDues', '') ~ '^[0-9]+(\.[0-9]+)?$'
          and (elem->>'monthlyDues')::numeric > 0
          then (elem->>'monthlyDues')::numeric
        else null
      end
    into v_catalog
    from public.app_settings settings
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(settings.value) = 'array' then settings.value else '[]'::jsonb end
    ) elem
    where settings.key = 'member_tiers'
      and elem->>'id' = v_tier
    limit 1;

    v_amount := coalesce(v_catalog, case v_tier
      when 'socio_individual' then 40000
      when 'socio_familiar' then 70000
      when 'socio_individual_amet' then 39000
      when 'socio_familiar_amet' then 68250
      else 0
    end);
    v_amount := round(coalesce(v_amount, 0), 2);
    if v_join > v_due or v_tier like '%amet%' then
      v_late := 0;
    elsif v_tier in ('socio_familiar', 'socio_individual') then
      v_late := v_amount;
    else
      v_late := 0;
    end if;
  end if;

  v_account := case v_tier
    when 'socio_familiar' then 'fca-31'
    when 'socio_individual' then 'fca-33'
    when 'socio_familiar_amet' then 'fca-socio_familiar_amet'
    when 'socio_individual_amet' then 'fca-socio_individual_amet'
    else null
  end;

  if v_amount > 0 then
    v_source := 'alta:' || p_member_id::text;
    insert into public.member_dues_entries (member_id, amount, kind, source, charge_scope)
    values (p_member_id, v_amount, 'alta', v_source, 'cuota_social')
    on conflict (source) where source <> '' do nothing
    returning id into v_entry;

    if v_entry is null then
      return jsonb_build_object('status', 'already', 'dueOn', to_char(v_due, 'YYYY-MM-DD'));
    end if;

    insert into public.member_dues_periods (member_id, due_on, capital, capital_open, late_base)
    values (p_member_id, v_due, v_amount, v_amount, v_late)
    on conflict (member_id, due_on) do nothing;

    if v_account is not null then
      insert into public.fee_ledger_lines (
        id, account_id, member_number, member_name, dni,
        line_date, date_label, type_label, description,
        amount, collected, pending, source
      )
      values (
        'alta-cuota-' || p_member_id::text,
        v_account,
        coalesce(v_member.member_number, ''),
        coalesce(v_member.full_name, ''),
        coalesce(v_member.document_number, ''),
        v_join,
        to_char(v_join, 'DD/MM/YYYY'),
        'CUOTA SOCIAL',
        v_label,
        v_amount,
        0,
        v_amount,
        'alta'
      )
      on conflict (id) do nothing
      returning id into v_line;

      if v_line is not null then
        update public.fee_ledger_accounts
        set balance = balance + v_amount
        where id = v_account;
      end if;
    end if;
  end if;

  if v_member.meta::text ~* 'abono[_ ]tenis'
     or exists (
       select 1
       from public.member_adherents a
       where a.member_id = p_member_id
         and a.status::text = 'active'
         and (a.tier::text ~* 'abono_tenis' or coalesce(a.disciplines::text, '') ~* 'tenis')
     ) then
    select
      case
        when coalesce(elem->>'monthlyDues', '') ~ '^[0-9]+(\.[0-9]+)?$'
          and (elem->>'monthlyDues')::numeric > 0
          then (elem->>'monthlyDues')::numeric
        else null
      end
    into v_catalog
    from public.app_settings settings
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(settings.value) = 'array' then settings.value else '[]'::jsonb end
    ) elem
    where settings.key = 'member_tiers'
      and elem->>'id' = 'abono_tenis'
    limit 1;
    v_tennis := round(coalesce(v_catalog, 12000), 2);

    insert into public.member_dues_entries (member_id, amount, kind, source, charge_scope)
    values (
      p_member_id,
      v_tennis,
      'alta',
      'alta:' || p_member_id::text || ':abono_tenis',
      'abono_tenis'
    )
    on conflict (source) where source <> '' do nothing;

    v_line := null;
    insert into public.fee_ledger_lines (
      id, account_id, member_number, member_name, dni,
      line_date, date_label, type_label, description,
      amount, collected, pending, source
    )
    values (
      'alta-tenis-' || p_member_id::text,
      'fca-abono_tenis',
      coalesce(v_member.member_number, ''),
      coalesce(v_member.full_name, ''),
      coalesce(v_member.document_number, ''),
      v_join,
      to_char(v_join, 'DD/MM/YYYY'),
      'ABONO TENIS',
      'Abono tenis',
      v_tennis,
      0,
      v_tennis,
      'alta'
    )
    on conflict (id) do nothing
    returning id into v_line;

    if v_line is not null then
      update public.fee_ledger_accounts
      set balance = balance + v_tennis
      where id = 'fca-abono_tenis';
    end if;
  end if;

  if v_amount <= 0 and v_tennis <= 0 then
    return jsonb_build_object('status', 'skipped', 'reason', 'sin_tarifa');
  end if;

  update public.members
  set
    next_due_date = v_next,
    overdue_since = case when v_join > v_due or public.club_today() <= v_due then null else v_due end,
    meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object(
      'firstSocialQuota', jsonb_build_object(
        'dueOn', to_char(v_due, 'YYYY-MM-DD'),
        'capital', v_amount,
        'lateBase', v_late,
        'label', v_label,
        'chargeScope', 'cuota_social',
        'tennis', v_tennis,
        'source', 'alta:' || p_member_id::text
      )
    ),
    updated_at = now()
  where id = p_member_id;

  v_balance := public.member_dues_balance(p_member_id);

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  values (
    auth.uid(),
    'alta_primera_cuota',
    'members',
    p_member_id,
    jsonb_build_object(
      'dueOn', to_char(v_due, 'YYYY-MM-DD'),
      'capital', v_amount,
      'lateBase', v_late,
      'tennis', v_tennis,
      'label', v_label,
      'joinDate', to_char(v_join, 'YYYY-MM-DD'),
      'nextDueDate', to_char(v_next, 'YYYY-MM-DD'),
      'chargeScope', 'cuota_social'
    )
  );

  return jsonb_build_object(
    'status', 'created',
    'dueOn', to_char(v_due, 'YYYY-MM-DD'),
    'capital', v_amount,
    'lateBase', v_late,
    'tennis', v_tennis,
    'label', v_label,
    'nextDueDate', to_char(v_next, 'YYYY-MM-DD'),
    'balance', v_balance,
    'chargeScope', 'cuota_social'
  );
end;
$$;

revoke all on function public.registrar_primera_cuota_alta(uuid, date, boolean) from public, anon;
grant execute on function public.registrar_primera_cuota_alta(uuid, date, boolean) to authenticated;

comment on function public.registrar_primera_cuota_alta(uuid, date, boolean) is
  'Primera cuota social del mes de ingreso. Una obligación, sin recargo retroactivo si el alta es posterior al vencimiento. No modifica altas ya conciliadas.';
