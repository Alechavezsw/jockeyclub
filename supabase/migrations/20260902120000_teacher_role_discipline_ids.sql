-- Rol profesor en el portal
do $$ begin
  alter type public.app_role add value if not exists 'teacher';
exception
  when duplicate_object then null;
end $$;

create or replace function public.role_rank(role_key text)
returns integer
language sql
immutable
as $function$
  select case lower(coalesce(role_key, 'member'))
    when 'superadmin' then 60
    when 'admin' then 50
    when 'accountant' then 40
    when 'cashier' then 32
    when 'gate_operator' then 31
    when 'admin_employee' then 25
    when 'hr' then 23
    when 'staff' then 20
    when 'teacher' then 15
    when 'member' then 10
    else 0
  end;
$function$;

alter table public.profiles
  add column if not exists discipline_ids text[] not null default '{}'::text[];

comment on column public.profiles.discipline_ids is
  'IDs de disciplinas del catálogo que dicta el profesor.';
