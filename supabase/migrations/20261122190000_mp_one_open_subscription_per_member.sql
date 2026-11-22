-- Una sola adhesión abierta de débito por socio (pending/in_process/authorized/approved).
-- Canceladas o rechazadas no bloquean una nueva adhesión.

-- Cierra duplicados viejos: deja la más reciente abierta por member_id.
with ranked as (
  select
    id,
    row_number() over (
      partition by member_id
      order by created_at desc nulls last, id desc
    ) as rn
  from public.mp_intents
  where kind = 'subscription'
    and member_id is not null
    and lower(coalesce(status, '')) in ('pending', 'in_process', 'authorized', 'approved')
)
update public.mp_intents i
set
  status = 'cancelled',
  updated_at = now(),
  meta = coalesce(i.meta, '{}'::jsonb) || jsonb_build_object(
    'cancelledReason', 'duplicate_open_subscription',
    'cancelledAt', now()
  )
from ranked r
where i.id = r.id
  and r.rn > 1;

create unique index if not exists mp_intents_one_open_subscription_per_member
  on public.mp_intents (member_id)
  where kind = 'subscription'
    and member_id is not null
    and lower(coalesce(status, '')) in ('pending', 'in_process', 'authorized', 'approved');

comment on index public.mp_intents_one_open_subscription_per_member is
  'Impide más de una adhesión abierta de cuota por socio.';
