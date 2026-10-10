-- Oficio: operario de pileta (puerta y cobro del canon).
do $$ begin
  alter type public.app_role add value if not exists 'pool_operator';
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
    when 'pool_operator' then 30
    when 'admin_employee' then 25
    when 'hr' then 23
    when 'staff' then 20
    when 'teacher' then 15
    when 'member' then 10
    else 0
  end;
$function$;

create or replace function public.has_staff_access()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profile_roles pr
    where pr.profile_id = auth.uid()
      and pr.revoked_at is null
      and lower(pr.role_key) in (
        'staff', 'cashier', 'accountant', 'admin', 'superadmin',
        'gate_operator', 'pool_operator', 'admin_employee', 'hr'
      )
  )
  or exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role::text in (
        'staff', 'cashier', 'accountant', 'admin', 'superadmin',
        'gate_operator', 'pool_operator', 'admin_employee', 'hr'
      )
  );
$$;
