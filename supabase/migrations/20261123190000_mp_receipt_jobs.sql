-- Cola de comprobantes de Mercado Pago.
-- No toca pagos, imputaciones, saldos ni ajustes de conciliación.

create table if not exists public.mp_receipt_jobs (
  intent_id uuid primary key references public.mp_intents(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'retry', 'sent')),
  attempts integer not null default 0,
  message_id uuid,
  email_id text,
  email_error text,
  ops_notice_id uuid,
  receipt_number text,
  locked_until timestamptz,
  next_attempt_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists mp_receipt_jobs_open_idx
  on public.mp_receipt_jobs (status, next_attempt_at)
  where status <> 'sent';

alter table public.mp_receipt_jobs enable row level security;

drop policy if exists mp_receipt_jobs_staff_select on public.mp_receipt_jobs;
create policy mp_receipt_jobs_staff_select
  on public.mp_receipt_jobs
  for select
  to authenticated
  using (public.has_staff_access());

revoke all on table public.mp_receipt_jobs from public, anon;
grant select on table public.mp_receipt_jobs to authenticated;
grant select, insert, update, delete on table public.mp_receipt_jobs to service_role;

create or replace function public.claim_mp_receipt_job(p_intent_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_row public.mp_receipt_jobs%rowtype;
begin
  insert into public.mp_receipt_jobs (intent_id, status)
  values (p_intent_id, 'pending')
  on conflict (intent_id) do nothing;

  select * into v_row
  from public.mp_receipt_jobs
  where intent_id = p_intent_id
  for update;

  if v_row.status = 'sent' then
    return jsonb_build_object('ok', true, 'claimed', false, 'status', 'sent');
  end if;

  if v_row.locked_until is not null and v_row.locked_until > now() then
    return jsonb_build_object('ok', true, 'claimed', false, 'status', 'locked');
  end if;

  update public.mp_receipt_jobs
  set attempts = attempts + 1,
      status = 'pending',
      locked_until = now() + interval '2 minutes',
      updated_at = now()
  where intent_id = p_intent_id
  returning * into v_row;

  return jsonb_build_object(
    'ok', true,
    'claimed', true,
    'status', v_row.status,
    'attempts', v_row.attempts,
    'message_id', v_row.message_id,
    'email_id', v_row.email_id,
    'ops_notice_id', v_row.ops_notice_id
  );
end;
$function$;

create or replace function public.complete_mp_receipt_job(
  p_intent_id uuid,
  p_message_id uuid,
  p_email_id text,
  p_email_error text,
  p_ops_notice_id uuid,
  p_receipt_number text,
  p_last_error text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_row public.mp_receipt_jobs%rowtype;
  v_sent boolean;
begin
  update public.mp_receipt_jobs
  set message_id = coalesce(p_message_id, message_id),
      email_id = coalesce(nullif(btrim(coalesce(p_email_id, '')), ''), email_id),
      email_error = nullif(btrim(coalesce(p_email_error, '')), ''),
      ops_notice_id = coalesce(p_ops_notice_id, ops_notice_id),
      receipt_number = coalesce(nullif(btrim(coalesce(p_receipt_number, '')), ''), receipt_number),
      last_error = nullif(btrim(coalesce(p_last_error, '')), ''),
      locked_until = null,
      updated_at = now()
  where intent_id = p_intent_id
  returning * into v_row;

  if v_row.intent_id is null then
    raise exception 'No está el comprobante de Mercado Pago.';
  end if;

  v_sent := v_row.message_id is not null
    and nullif(btrim(coalesce(v_row.email_id, '')), '') is not null
    and v_row.ops_notice_id is not null;

  update public.mp_receipt_jobs
  set status = case when v_sent then 'sent' else 'retry' end,
      next_attempt_at = case
        when v_sent then null
        else now() + make_interval(mins => least(power(2, least(v_row.attempts, 6))::int, 60))
      end,
      updated_at = now()
  where intent_id = p_intent_id
  returning * into v_row;

  return jsonb_build_object(
    'ok', true,
    'status', v_row.status,
    'attempts', v_row.attempts,
    'next_attempt_at', v_row.next_attempt_at
  );
end;
$function$;

revoke all on function public.claim_mp_receipt_job(uuid) from public, anon, authenticated;
grant execute on function public.claim_mp_receipt_job(uuid) to service_role;

revoke all on function public.complete_mp_receipt_job(uuid, uuid, text, text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.complete_mp_receipt_job(uuid, uuid, text, text, uuid, text, text) to service_role;
