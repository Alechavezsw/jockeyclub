-- Backfill de meta.periodDueOns en solicitudes de pago históricas.
-- No modifica member_payments, outstanding_balance ni fechas de operación.
-- PREPARE ONLY — no aplicar en producción sin autorización.
--
-- Regla: el vencimiento de la solicitud NO es members.next_due_date.
-- Se reconstruye el período desde fee_ledger_lines.pending (remanente real).

do $$
declare
  v_updated int := 0;
begin
  with open_reqs as (
    select m.id,
           m.meta,
           regexp_replace(
             coalesce(m.sender_key, m.meta->>'memberId', m.meta->>'member_number', ''),
             '\D',
             '',
             'g'
           ) as member_digits
    from public.messages m
    where coalesce(m.meta->>'kind', '') = 'dues_payment'
      and coalesce((m.meta->>'paymentRequest')::boolean, false) = true
      and coalesce((m.meta->>'paymentHandled')::boolean, false) = false
      and (
        m.meta->'periodDueOns' is null
        or jsonb_typeof(m.meta->'periodDueOns') <> 'array'
        or jsonb_array_length(coalesce(m.meta->'periodDueOns', '[]'::jsonb)) = 0
      )
  ),
  periods as (
    select
      r.id as message_id,
      mem.next_due_date,
      (
        select coalesce(
          jsonb_agg(to_jsonb(to_char(fl.line_date, 'YYYY-MM') || '-10') order by fl.line_date),
          '[]'::jsonb
        )
        from (
          select distinct on (to_char(fl2.line_date, 'YYYY-MM')) fl2.line_date
          from public.fee_ledger_lines fl2
          where fl2.member_number = mem.member_number
            and coalesce(fl2.pending, 0) > 0.009
            and coalesce(fl2.type_label, '') not ilike '%reclasific%'
          order by to_char(fl2.line_date, 'YYYY-MM'), fl2.line_date
        ) fl
      ) as period_due_ons
    from open_reqs r
    join public.members mem
      on regexp_replace(mem.member_number, '\D', '', 'g') = r.member_digits
    where r.member_digits <> ''
  )
  update public.messages msg
  set meta = coalesce(msg.meta, '{}'::jsonb)
    || jsonb_build_object(
      'periodDueOns', p.period_due_ons,
      'nextAccountDueDate', to_char(p.next_due_date, 'YYYY-MM-DD'),
      'periodMetaBackfill', 'dues_payment_request_period_meta_20261124'
    )
  from periods p
  where msg.id = p.message_id
    and jsonb_array_length(p.period_due_ons) > 0;

  get diagnostics v_updated = row_count;
  raise notice 'dues payment request period meta backfilled: %', v_updated;
end $$;

notify pgrst, 'reload schema';
