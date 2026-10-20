-- Regla de padrón: vitalicio, fundador y comisión no liquidan cuota social.

create or replace function public.member_id_is_dues_exempt(mid uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(public.member_is_dues_exempt(m), false)
  from public.members m
  where m.id = mid;
$$;

create or replace function public.zero_exempt_member_dues()
returns trigger
language plpgsql
as $$
begin
  if public.member_is_dues_exempt(new) then
    new.outstanding_balance := 0;
    new.overdue_since := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_zero_exempt_member_dues on public.members;
create trigger trg_zero_exempt_member_dues
  before insert or update of outstanding_balance, overdue_since, tier, meta
  on public.members
  for each row execute function public.zero_exempt_member_dues();

update public.members
set
  outstanding_balance = 0,
  overdue_since = null,
  updated_at = now()
where public.member_is_dues_exempt(members);

grant execute on function public.member_id_is_dues_exempt(uuid) to service_role, authenticated;

comment on function public.member_id_is_dues_exempt(uuid) is
  'Regla: vitalicio, fundador y comisión no abonan cuota social.';
comment on function public.zero_exempt_member_dues() is
  'Impide guardar mora o saldo de cuota en fichas exentas.';
