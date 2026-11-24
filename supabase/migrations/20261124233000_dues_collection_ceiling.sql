-- Impide acreditar una cuota social por encima del saldo más la diferencia autorizada.
-- No modifica saldos, pagos ni los 249 ajustes. El adelanto de quien está al día sigue permitido.

create or replace function public.enforce_dues_collection_ceiling()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member public.members%rowtype;
  v_outstanding numeric;
  v_authorized numeric := 0;
  v_auth jsonb;
  v_concept text;
  v_tennis boolean;
  v_adelanto boolean;
begin
  if tg_op <> 'INSERT' then
    return new;
  end if;
  v_concept := lower(coalesce(new.concept, ''));
  v_tennis := v_concept like '%tenis%' and v_concept not like '%cuota social%';
  if v_tennis or v_concept !~ 'cuota' then
    return new;
  end if;

  select * into v_member from public.members where id = new.member_id;
  if not found then
    return new;
  end if;

  v_outstanding := coalesce(v_member.outstanding_balance, 0);
  v_auth := v_member.meta->'duesTariffAuthorization';
  v_adelanto := coalesce(new.meta->>'adelanto', '') in ('true', 't', '1');
  if jsonb_typeof(v_auth) = 'object'
    and lower(coalesce(v_auth->>'status', '')) = 'authorized'
    and (
      coalesce(v_auth->>'authorizedAt', '') <> ''
      or coalesce(v_auth->>'authorizedBy', '') <> ''
    )
    and coalesce(v_auth->>'difference', v_auth->>'amount', '') ~ '^[0-9]+(\.[0-9]+)?$'
  then
    v_authorized := (coalesce(v_auth->>'difference', v_auth->>'amount'))::numeric;
  end if;

  -- Quien está al día puede adelantar el mes que sigue. Quien debe no acredita
  -- por encima del saldo más el 10 % de mora y la diferencia ya autorizada.
  if v_outstanding <= 0.01 and v_adelanto then
    return new;
  end if;

  if coalesce(new.amount, 0) > (v_outstanding * 1.1) + v_authorized + 0.01 then
    raise exception 'Cobro pendiente de conciliación administrativa. El importe supera el saldo autorizado.'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_dues_collection_ceiling() from public, anon, authenticated;

drop trigger if exists trg_dues_collection_ceiling on public.member_payments;
create trigger trg_dues_collection_ceiling
  before insert on public.member_payments
  for each row execute function public.enforce_dues_collection_ceiling();

comment on function public.enforce_dues_collection_ceiling() is
  'Rechaza una cuota social mayor al saldo más la diferencia de tarifa autorizada en la ficha. No escribe saldos.';
