-- Un cobro importado se identifica por clave, no por la hora del click.
-- La segunda importación de la misma fila choca con la unique y no vuelve a bajar el saldo.

alter table public.member_payments
  add column if not exists idempotency_key text;

update public.member_payments
set idempotency_key = nullif(btrim(meta->>'idempotencyKey'), '')
where coalesce(btrim(idempotency_key), '') = ''
  and coalesce(btrim(meta->>'idempotencyKey'), '') <> '';

create unique index if not exists member_payments_idempotency_key_col_idx
  on public.member_payments (idempotency_key)
  where idempotency_key is not null and btrim(idempotency_key) <> '';

comment on column public.member_payments.idempotency_key is
  'Clave estable del cobro. Un reintento o una segunda importación de la misma fila no inserta otro pago.';

create or replace function public.member_payments_stamp_idempotency_key()
returns trigger
language plpgsql
as $$
begin
  if coalesce(btrim(new.idempotency_key), '') = '' then
    new.idempotency_key := nullif(btrim(new.meta->>'idempotencyKey'), '');
  elsif coalesce(btrim(new.meta->>'idempotencyKey'), '') = '' then
    new.meta := coalesce(new.meta, '{}'::jsonb)
      || jsonb_build_object('idempotencyKey', new.idempotency_key);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_member_payments_idempotency_key on public.member_payments;
create trigger trg_member_payments_idempotency_key
  before insert or update on public.member_payments
  for each row
  execute function public.member_payments_stamp_idempotency_key();
