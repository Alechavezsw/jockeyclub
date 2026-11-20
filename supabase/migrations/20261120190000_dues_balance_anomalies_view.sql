-- Auditoría de desync saldo ficha vs unpaidCapital.
-- Solo detección: no corrige importes automáticamente.

create or replace view public.dues_balance_anomalies as
select
  m.id as member_id,
  m.member_number,
  m.full_name,
  m.tier,
  m.status,
  round(coalesce(m.outstanding_balance, 0), 2) as outstanding_balance,
  round(coalesce(nullif(m.meta->>'unpaidCapital', '')::numeric, 0), 2) as unpaid_capital,
  round(
    coalesce(nullif(m.meta->>'unpaidCapital', '')::numeric, 0)
    - coalesce(m.outstanding_balance, 0),
    2
  ) as gap,
  case
    when coalesce(m.outstanding_balance, 0) <= 0.01
      and coalesce(nullif(m.meta->>'unpaidCapital', '')::numeric, 0) > 0.01
      then 'stale_unpaid_while_clear'
    when coalesce(nullif(m.meta->>'unpaidCapital', '')::numeric, 0)
      > coalesce(m.outstanding_balance, 0) + 0.01
      then 'unpaid_above_outstanding'
    when coalesce(m.outstanding_balance, 0) > 0.01
      and coalesce(nullif(m.meta->>'unpaidCapital', '')::numeric, 0)
        < coalesce(m.outstanding_balance, 0) - 0.01
      and m.meta ? 'unpaidCapital'
      then 'unpaid_below_outstanding'
    else 'other'
  end as anomaly_code,
  case
    when abs(
      coalesce(nullif(m.meta->>'unpaidCapital', '')::numeric, 0)
      - coalesce(m.outstanding_balance, 0)
    ) >= 1000 then 'high'
    else 'medium'
  end as severity,
  m.next_due_date,
  m.meta->>'lastPaymentDate' as last_payment_date,
  round(coalesce(nullif(m.meta->>'creditBalance', '')::numeric, 0), 2) as credit_balance,
  'Revisar movimientos; no imputar la diferencia como saldo a favor'::text as recommended_action
from public.members m
where m.status = 'active'
  and m.meta ? 'unpaidCapital'
  and abs(
    coalesce(nullif(m.meta->>'unpaidCapital', '')::numeric, 0)
    - coalesce(m.outstanding_balance, 0)
  ) > 0.01
  and not (
    coalesce(m.outstanding_balance, 0) > 0.01
    and coalesce(nullif(m.meta->>'unpaidCapital', '')::numeric, 0) <= 0.01
  );

comment on view public.dues_balance_anomalies is
  'Socios con unpaidCapital desincronizado del outstanding_balance. Solo lectura / conciliación.';

grant select on public.dues_balance_anomalies to authenticated;
