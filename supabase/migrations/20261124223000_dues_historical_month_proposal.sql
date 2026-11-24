-- Propuesta de lectura. No modifica saldos, pagos, líneas ni los 249 ajustes.
-- Asigna meses del historial LILA y muestra tarifa vigente, recargo y diferencia.

create or replace function public.dues_history_period_keys(concept text, line_date text)
returns text[]
language plpgsql
immutable
as $$
declare
  plain text := lower(translate(coalesce(concept, ''), 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN'));
  names text[] := array[
    'septiembre','setiembre','noviembre','diciembre','febrero','octubre','agosto',
    'enero','marzo','abril','junio','julio','mayo',
    'sep','set','nov','dic','feb','oct','ago','ene','mar','abr','jun','jul','may'
  ];
  nums text[] := array[
    '09','09','11','12','02','10','08',
    '01','03','04','06','07','05',
    '09','09','11','12','02','10','08','01','03','04','06','07','05'
  ];
  year text;
  idx integer;
  found text[] := array[]::text[];
  token text;
begin
  select (regexp_match(plain, '(20[0-9]{2})'))[1] into year;
  if year is null then
    year := left(coalesce(line_date, ''), 4);
  end if;
  if year is null or year !~ '^20[0-9]{2}$' then
    return found;
  end if;
  for idx in 1..array_length(names, 1) loop
    plain := replace(plain, names[idx], '§' || nums[idx] || '§');
  end loop;
  for token in select (regexp_matches(plain, '§([0-9]{2})§', 'g'))[1] loop
    if not (year || '-' || token) = any (found) then
      found := found || (year || '-' || token);
    end if;
  end loop;
  return found;
end;
$$;

create or replace function public.dues_historical_month_proposal()
returns table (
  member_number text,
  period_ym text,
  original_capital numeric,
  capital_open numeric,
  historical_surcharge numeric,
  applied numeric
)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  rec record;
  cur_member text := '';
  months jsonb := '{}'::jsonb;
  payments jsonb := '[]'::jsonb;
  periods text[];
  ym text;
  amount numeric;
  kind text;
  bucket jsonb;
  pay jsonb;
  left_amount numeric;
  target text;
  keys text[];
  idx integer;
  share numeric;
  named text[];
begin
  if auth.uid() is not null and coalesce(public.has_staff_access(), false) is not true then
    return;
  end if;
  for rec in
    select
      elem->>0 as member_number,
      left(coalesce(elem->>1, ''), 10) as line_date,
      coalesce(elem->>2, '') as line_type,
      coalesce(elem->>3, '') as concept,
      coalesce((elem->>4)::numeric, 0) as value
    from public.club_snapshots
    cross join lateral jsonb_array_elements(payload->'ACCESSIN_DETAILED_CC_HISTORY') elem
    where name = 'accessinDetailedCurrentAccounts'
    order by elem->>0, left(coalesce(elem->>1, ''), 10),
      case when lower(coalesce(elem->>2, '')) like 'pago%' then 1 else 0 end
  loop
    if cur_member <> '' and rec.member_number is distinct from cur_member then
      for pay in select value from jsonb_array_elements(payments) loop
        left_amount := (pay->>'amount')::numeric;
        named := array(select jsonb_array_elements_text(pay->'periods') order by 1);
        if coalesce(array_length(named, 1), 0) = 0
          and (
            coalesce(pay->>'concept', '') = ''
            or lower(pay->>'concept') = pay->>'date'
          )
        then
          select coalesce(array_agg(k order by k), array[]::text[])
            into keys
          from jsonb_object_keys(months) as t(k)
          where left(k, 7) = left(pay->>'date', 7);
          named := keys;
        end if;
        if named is not null then
          foreach target in array named loop
            exit when left_amount <= 0.009;
            bucket := months->target;
            if bucket is null then
              continue;
            end if;
            share := least(
              left_amount,
              greatest(
                0,
                (bucket->>'capital')::numeric
                + (bucket->>'surcharge')::numeric
                + (bucket->>'extra')::numeric
                - (bucket->>'paid')::numeric
              )
            );
            if share > 0.009 then
              bucket := jsonb_set(bucket, '{paid}', to_jsonb(round(((bucket->>'paid')::numeric + share)::numeric, 2)));
              months := jsonb_set(months, array[target], bucket);
              left_amount := round((left_amount - share)::numeric, 2);
            end if;
          end loop;
        end if;
      end loop;
      for ym, bucket in select key, value from jsonb_each(months) loop
        if (bucket->>'capital')::numeric > 0.009 then
          member_number := cur_member;
          period_ym := ym;
          original_capital := round((bucket->>'capital')::numeric, 2);
          applied := round(least((bucket->>'capital')::numeric, (bucket->>'paid')::numeric), 2);
          capital_open := round(greatest(0, original_capital - applied), 2);
          historical_surcharge := round(greatest(
            0,
            (bucket->>'surcharge')::numeric - greatest(0, (bucket->>'paid')::numeric - (bucket->>'capital')::numeric)
          ), 2);
          return next;
        end if;
      end loop;
      months := '{}'::jsonb;
      payments := '[]'::jsonb;
    end if;

    cur_member := rec.member_number;
    kind := lower(translate(rec.line_type, 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN'));
    periods := public.dues_history_period_keys(rec.concept, rec.line_date);
    amount := round(abs(rec.value), 2);
    if amount <= 0.009 then
      continue;
    end if;
    if lower(rec.line_type || ' ' || rec.concept) ~ '(tenis|pulsera|reserva|salon|espacio verde|cancha)' then
      continue;
    end if;
    if kind like 'saldo anterior%' then
      continue;
    end if;

    if kind like 'cuota%' and rec.value > 0 then
      ym := coalesce(periods[1], left(rec.line_date, 7));
      if ym ~ '^[0-9]{4}-[0-9]{2}$' then
        bucket := coalesce(months->ym, '{"capital":0,"surcharge":0,"extra":0,"paid":0}'::jsonb);
        bucket := jsonb_set(bucket, '{capital}', to_jsonb(round(((bucket->>'capital')::numeric + amount)::numeric, 2)));
        months := jsonb_set(months, array[ym], bucket);
      end if;
    elsif kind like '%recargo%' and rec.value > 0 then
      ym := coalesce(periods[1], left(rec.line_date, 7));
      if ym ~ '^[0-9]{4}-[0-9]{2}$' then
        bucket := coalesce(months->ym, '{"capital":0,"surcharge":0,"extra":0,"paid":0}'::jsonb);
        bucket := jsonb_set(bucket, '{surcharge}', to_jsonb(round(((bucket->>'surcharge')::numeric + amount)::numeric, 2)));
        months := jsonb_set(months, array[ym], bucket);
      end if;
    elsif lower(rec.concept) like '%actualizacion%' and rec.value > 0 and coalesce(array_length(periods, 1), 0) > 0 then
      left_amount := amount;
      for idx in 1..array_length(periods, 1) loop
        ym := periods[idx];
        share := case
          when idx = array_length(periods, 1) then left_amount
          else round((amount / array_length(periods, 1))::numeric, 2)
        end;
        bucket := coalesce(months->ym, '{"capital":0,"surcharge":0,"extra":0,"paid":0}'::jsonb);
        bucket := jsonb_set(bucket, '{extra}', to_jsonb(round(((bucket->>'extra')::numeric + share)::numeric, 2)));
        months := jsonb_set(months, array[ym], bucket);
        left_amount := round((left_amount - share)::numeric, 2);
      end loop;
    elsif rec.value < 0 and (kind like 'pago%' or kind like '%bonific%' or lower(rec.concept) like '%bonific%') then
      payments := payments || jsonb_build_array(jsonb_build_object(
        'date', rec.line_date,
        'concept', rec.concept,
        'amount', amount,
        'periods', to_jsonb(periods)
      ));
    end if;
  end loop;

  if cur_member <> '' then
    for pay in select value from jsonb_array_elements(payments) loop
      left_amount := (pay->>'amount')::numeric;
      named := array(select jsonb_array_elements_text(pay->'periods') order by 1);
      if coalesce(array_length(named, 1), 0) = 0
        and (
          coalesce(pay->>'concept', '') = ''
          or lower(pay->>'concept') = pay->>'date'
        )
      then
        select coalesce(array_agg(k order by k), array[]::text[])
          into keys
        from jsonb_object_keys(months) as t(k)
        where left(k, 7) = left(pay->>'date', 7);
        named := keys;
      end if;
      if named is not null then
        foreach target in array named loop
          exit when left_amount <= 0.009;
          bucket := months->target;
          if bucket is null then
            continue;
          end if;
          share := least(
            left_amount,
            greatest(
              0,
              (bucket->>'capital')::numeric
              + (bucket->>'surcharge')::numeric
              + (bucket->>'extra')::numeric
              - (bucket->>'paid')::numeric
            )
          );
          if share > 0.009 then
            bucket := jsonb_set(bucket, '{paid}', to_jsonb(round(((bucket->>'paid')::numeric + share)::numeric, 2)));
            months := jsonb_set(months, array[target], bucket);
            left_amount := round((left_amount - share)::numeric, 2);
          end if;
        end loop;
      end if;
    end loop;
    for ym, bucket in select key, value from jsonb_each(months) loop
      if (bucket->>'capital')::numeric > 0.009 then
        member_number := cur_member;
        period_ym := ym;
        original_capital := round((bucket->>'capital')::numeric, 2);
        applied := round(least((bucket->>'capital')::numeric, (bucket->>'paid')::numeric), 2);
        capital_open := round(greatest(0, original_capital - applied), 2);
        historical_surcharge := round(greatest(
          0,
          (bucket->>'surcharge')::numeric - greatest(0, (bucket->>'paid')::numeric - (bucket->>'capital')::numeric)
        ), 2);
        return next;
      end if;
    end loop;
  end if;
end;
$$;

drop view if exists public.dues_historical_reconciliation_proposal;

create view public.dues_historical_reconciliation_proposal
with (security_invoker = true) as
with proposal as (
  select * from public.dues_historical_month_proposal()
),
adjustment as (
  select member_number, coalesce(sum(pending), 0)::numeric as unassigned_adjustment
  from public.fee_ledger_lines
  where source = 'connect_admin_reconciliation_20261123'
    and line_date is null
    and pending > 0
  group by member_number
),
ledger as (
  select
    member_number,
    left(line_date::text, 7) as period_ym,
    coalesce(sum(pending) filter (
      where lower(coalesce(type_label, '')) like '%cuota%'
        and lower(coalesce(type_label, '') || ' ' || coalesce(description, '')) not like '%tenis%'
        and lower(coalesce(type_label, '')) not like '%recargo%'
    ), 0)::numeric as ledger_pending
  from public.fee_ledger_lines
  where line_date is not null
  group by member_number, left(line_date::text, 7)
)
select
  p.member_number,
  p.period_ym,
  (p.period_ym || '-10')::date as due_on,
  p.original_capital,
  p.applied,
  p.capital_open,
  p.historical_surcharge as recorded_surcharge,
  catalog.monthly_dues as current_tariff,
  case
    when catalog.monthly_dues is null then null
    when p.applied > 0.009 and p.capital_open + 0.009 < p.original_capital then 0
    when m.tier in ('socio_familiar', 'socio_individual')
      and (p.period_ym || '-10')::date < current_date
      then round(catalog.monthly_dues * 0.1, 2)
    else 0
  end as current_surcharge,
  coalesce(l.ledger_pending, 0) as ledger_pending,
  coalesce(a.unassigned_adjustment, 0) as unassigned_adjustment,
  coalesce(m.outstanding_balance, 0) as recorded_balance,
  case
    when catalog.monthly_dues is null and p.capital_open > 0.009 then 'revisar'
    when p.capital_open <= 0.009 then 'cubierto'
    when coalesce(l.ledger_pending, 0) > 0.009 then 'abierto_en_libro'
    when coalesce(a.unassigned_adjustment, 0) > 0.009 then 'propuesto'
    else 'revisar'
  end as proposal_status,
  case
    when catalog.monthly_dues is null then null
    else round(catalog.monthly_dues - p.original_capital, 2)
  end as tariff_difference
from proposal p
left join public.members m on m.member_number = p.member_number
left join adjustment a on a.member_number = p.member_number
left join ledger l on l.member_number = p.member_number and l.period_ym = p.period_ym
left join lateral (
  select
    case
      when (elem->>'isActive') = 'false' then null
      when coalesce(elem->>'monthlyDues', '') ~ '^[0-9]+(\.[0-9]+)?$'
        and (elem->>'monthlyDues')::numeric > 0
        then (elem->>'monthlyDues')::numeric
      else null
    end as monthly_dues
  from public.app_settings settings
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(settings.value) = 'array' then settings.value else '[]'::jsonb end
  ) elem
  where settings.key = 'member_tiers'
    and elem->>'id' = m.tier
  limit 1
) catalog on true;

comment on view public.dues_historical_reconciliation_proposal is
  'Propuesta de meses según el historial LILA y el catálogo member_tiers. Solo lectura: no modifica saldos ni ajustes.';

revoke all on function public.dues_history_period_keys(text, text) from public, anon;
revoke all on function public.dues_historical_month_proposal() from public, anon;
grant execute on function public.dues_history_period_keys(text, text) to authenticated, service_role;
grant execute on function public.dues_historical_month_proposal() to authenticated, service_role;
