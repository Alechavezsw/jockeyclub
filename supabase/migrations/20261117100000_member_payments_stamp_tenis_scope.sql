-- Persistir chargeScope (abono tenis) en meta del cobro.
-- Completa meta.chargeScope cuando el concept es Abono tenis.

create or replace function public.member_payments_stamp_tenis_scope()
returns trigger
language plpgsql
as $$
begin
  if new.concept is not null
     and lower(left(btrim(new.concept), 11)) = 'abono tenis'
     and coalesce(new.meta->>'chargeScope', '') = '' then
    new.meta := coalesce(new.meta, '{}'::jsonb) || jsonb_build_object('chargeScope', 'abono_tenis');
  end if;
  if coalesce(new.meta->>'chargeScope', '') in ('abono_tenis', 'tenis')
     and coalesce(new.meta->>'chargeScope', '') <> 'abono_tenis' then
    new.meta := coalesce(new.meta, '{}'::jsonb) || jsonb_build_object('chargeScope', 'abono_tenis');
  end if;
  return new;
end;
$$;

drop trigger if exists member_payments_stamp_tenis_scope on public.member_payments;
create trigger member_payments_stamp_tenis_scope
before insert or update of concept, meta
on public.member_payments
for each row
execute function public.member_payments_stamp_tenis_scope();
