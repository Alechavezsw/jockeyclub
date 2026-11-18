-- La migración exempt_members_pay_tennis_abono recreó los triggers sin SECURITY DEFINER.
-- authenticated no tiene EXECUTE sobre member_dues_balance (privacy), así que cualquier
-- UPDATE/INSERT en members fallaba con: permission denied for function member_dues_balance.

create or replace function public.keep_member_dues_balance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Exentos: saldo = deuda en entries (abono tenis). Sin entries → 0.
  new.outstanding_balance := public.member_dues_balance(new.id);
  return new;
end;
$$;

create or replace function public.zero_exempt_member_dues()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.member_is_dues_exempt(new) then
    new.overdue_since := null;
    -- No pisar deuda de tenis: el saldo lo fija keep_member_dues_balance vía entries.
    new.outstanding_balance := public.member_dues_balance(new.id);
  end if;
  return new;
end;
$$;

revoke all on function public.keep_member_dues_balance() from public, anon, authenticated;
revoke all on function public.zero_exempt_member_dues() from public, anon, authenticated;
revoke all on function public.member_dues_balance(uuid) from public, anon, authenticated;
grant execute on function public.member_dues_balance(uuid) to service_role;
