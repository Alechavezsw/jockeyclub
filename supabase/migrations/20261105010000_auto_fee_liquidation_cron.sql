-- Liquidación automática: edge auto-fee-liquidation + pg_cron (00:05 AR = 03:05 UTC).
-- El service_role debe poder imputar saldos sin dues.liquidate (auth.uid() es null).

create or replace function public.apply_member_balance_deltas(p_deltas jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not (
    coalesce(auth.role(), '') = 'service_role'
    or public.has_capability('dues.liquidate')
    or public.has_admin_access()
  ) then
    raise exception 'Sin permiso para imputar cuotas';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_deltas, '[]'::jsonb)) e
    where coalesce((e->>'amount')::numeric, 0) < 0
  ) then
    raise exception 'Un crédito de cuota es una nota de crédito, no un importe libre.';
  end if;

  insert into public.member_dues_entries (member_id, amount, kind, source)
  select m.id, round(d.amount, 2), 'debt', ''
  from (
    select
      e->>'memberId' as member_number,
      sum(coalesce((e->>'amount')::numeric, 0)) as amount
    from jsonb_array_elements(coalesce(p_deltas, '[]'::jsonb)) e
    where coalesce(e->>'memberId', '') <> ''
    group by e->>'memberId'
  ) d
  join public.members m on m.member_number::text = d.member_number
  where d.amount <> 0
    and not public.member_is_dues_exempt(m);

  insert into public.member_dues_periods (member_id, due_on, capital, capital_open, late_base)
  select
    m.id,
    p.due_on,
    p.capital,
    greatest(0, round(p.capital - coalesce(pre.prepaid, 0), 2)),
    p.late_base
  from (
    select
      e->>'memberId' as member_number,
      (per->>'dueOn')::date as due_on,
      round(coalesce((per->>'capital')::numeric, 0), 2) as capital,
      round(coalesce((per->>'lateBase')::numeric, 0), 2) as late_base
    from jsonb_array_elements(coalesce(p_deltas, '[]'::jsonb)) e
    cross join lateral jsonb_array_elements(coalesce(e->'periods', '[]'::jsonb)) per
    where coalesce(e->>'memberId', '') <> ''
      and (per->>'dueOn') ~ '^\d{4}-\d{2}-\d{2}$'
  ) p
  join public.members m on m.member_number::text = p.member_number
  left join lateral (
    select coalesce(sum(i.capital), 0) as prepaid
    from public.dues_imputations i
    where i.member_id = m.id
      and i.due_on = p.due_on
      and i.voided_at is null
      and i.kind = 'adelanto'
  ) pre on true
  where p.capital > 0
    and not public.member_is_dues_exempt(m)
  on conflict (member_id, due_on) do update
  set capital = public.member_dues_periods.capital + excluded.capital,
      capital_open = greatest(0, round(
        public.member_dues_periods.capital_open
        + excluded.capital
        - least(
            excluded.capital,
            greatest(0, coalesce((
              select sum(i.capital)
              from public.dues_imputations i
              where i.member_id = public.member_dues_periods.member_id
                and i.due_on = public.member_dues_periods.due_on
                and i.voided_at is null
                and i.kind = 'adelanto'
            ), 0) - (public.member_dues_periods.capital - public.member_dues_periods.capital_open))
          )
      , 2)),
      late_base = public.member_dues_periods.late_base + excluded.late_base;

  update public.members m
  set updated_at = now()
  from (
    select e->>'memberId' as member_number
    from jsonb_array_elements(coalesce(p_deltas, '[]'::jsonb)) e
    where coalesce(e->>'memberId', '') <> ''
    group by e->>'memberId'
  ) d
  where m.member_number::text = d.member_number;
end;
$function$;

revoke all on function public.apply_member_balance_deltas(jsonb) from public, anon;
grant execute on function public.apply_member_balance_deltas(jsonb) to authenticated, service_role;

do $$
begin
  if to_regclass('cron.job') is null then
    return;
  end if;
  if not exists (select 1 from public.dues_cron_config where id = 1) then
    return;
  end if;

  perform cron.unschedule(j.jobid)
  from cron.job j
  where j.jobname in ('auto-fee-liquidation', 'auto-fee-liquidation-retry');

  -- 00:05 America/Argentina/San_Juan (= 03:05 UTC)
  perform cron.schedule(
    'auto-fee-liquidation',
    '5 3 * * *',
    $job$
    select net.http_post(
      url := 'https://papdsxgcvyncdxdvbdaa.supabase.co/functions/v1/auto-fee-liquidation',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select token from public.dues_cron_config where id = 1)
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 300000
    );
    $job$
  );

  -- Reintento al mediodía AR (15:05 UTC) por si falló el de la madrugada
  perform cron.schedule(
    'auto-fee-liquidation-retry',
    '5 15 * * *',
    $job$
    select net.http_post(
      url := 'https://papdsxgcvyncdxdvbdaa.supabase.co/functions/v1/auto-fee-liquidation',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select token from public.dues_cron_config where id = 1)
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 300000
    );
    $job$
  );
end $$;
