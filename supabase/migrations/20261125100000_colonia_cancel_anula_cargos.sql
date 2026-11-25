-- Cancelar una inscripción anula sus cargos. No siguen en Cargos ni en el saldo.

create or replace function public.colonia_cancel_enrollment(
  p_enrollment_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enroll public.colonia_enrollments;
begin
  if auth.uid() is null then raise exception 'Tenés que estar logueado.'; end if;
  if not public.colonia_has_cap('colonia.operate') then
    raise exception 'Sin permiso para cancelar inscripciones de Colonia.';
  end if;

  select * into v_enroll from public.colonia_enrollments where id = p_enrollment_id for update;
  if not found then raise exception 'Inscripción no encontrada.'; end if;
  if v_enroll.status = 'cancelada' then
    update public.colonia_charges
    set status = 'void',
        voided_at = coalesce(voided_at, now()),
        void_reason = coalesce(void_reason, 'Inscripción cancelada')
    where enrollment_id = v_enroll.id
      and status = 'posted';
    return jsonb_build_object('ok', true, 'enrollment', to_jsonb(v_enroll), 'already', true);
  end if;

  update public.colonia_enrollments
  set status = 'cancelada',
      observations = nullif(btrim(concat_ws(' · ', coalesce(observations, ''), coalesce(p_reason, 'Cancelada'))), ''),
      updated_at = now()
  where id = v_enroll.id
  returning * into v_enroll;

  update public.colonia_charges
  set status = 'void',
      voided_at = now(),
      void_reason = 'Inscripción cancelada'
  where enrollment_id = v_enroll.id
    and status = 'posted';

  insert into public.colonia_audit_logs (actor_id, action, entity_type, entity_id, payload)
  values (auth.uid(), 'colonia_enrollment_cancelled', 'colonia_enrollments', v_enroll.id,
    jsonb_build_object('reason', p_reason));

  return jsonb_build_object('ok', true, 'enrollment', to_jsonb(v_enroll));
end;
$$;

create or replace function public.colonia_dashboard_stats(p_season_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stats jsonb;
  v_charges numeric;
  v_paid numeric;
begin
  if auth.uid() is null then raise exception 'Tenés que estar logueado.'; end if;
  if not (
    public.colonia_has_cap('colonia.operate')
    or public.colonia_has_cap('colonia.report')
    or public.colonia_has_cap('colonia.collect')
  ) then
    raise exception 'Sin permiso para reportes de Colonia.';
  end if;

  select coalesce(sum(c.amount), 0)
  into v_charges
  from public.colonia_charges c
  join public.colonia_enrollments e on e.id = c.enrollment_id
  where c.season_id = p_season_id
    and c.status = 'posted'
    and e.status <> 'cancelada';

  select coalesce(sum(p.amount), 0)
  into v_paid
  from public.colonia_payments p
  where p.season_id = p_season_id
    and p.status = 'confirmed';

  select jsonb_build_object(
    'enrolled', (select count(*) from public.colonia_enrollments e where e.season_id = p_season_id and e.status <> 'cancelada'),
    'confirmed', (select count(*) from public.colonia_enrollments e where e.season_id = p_season_id and e.status = 'confirmada'),
    'pending', (select count(*) from public.colonia_enrollments e where e.season_id = p_season_id and e.status = 'pendiente'),
    'socio', (
      select count(*) from public.colonia_enrollments e
      join public.colonia_students s on s.id = e.student_id
      where e.season_id = p_season_id and e.status <> 'cancelada' and s.member_kind = 'socio'
    ),
    'no_socio', (
      select count(*) from public.colonia_enrollments e
      join public.colonia_students s on s.id = e.student_id
      where e.season_id = p_season_id and e.status <> 'cancelada' and s.member_kind = 'no_socio'
    ),
    'charges_total', v_charges,
    'payments_confirmed', v_paid,
    'payments_pending', coalesce((select sum(amount) from public.colonia_payments p where p.season_id = p_season_id and p.status = 'pending'), 0),
    'balance_due', v_charges - v_paid,
    'attendance_today', (
      select count(*) from public.colonia_attendance a
      where a.season_id = p_season_id and a.day = (timezone('America/Argentina/Buenos_Aires', now()))::date
        and a.status = 'presente'
    ),
    'sibling_groups', (select count(*) from public.colonia_sibling_groups g where g.season_id = p_season_id)
  ) into v_stats;

  return coalesce(v_stats, '{}'::jsonb);
end;
$$;

update public.colonia_charges c
set status = 'void',
    voided_at = coalesce(c.voided_at, now()),
    void_reason = coalesce(c.void_reason, 'Inscripción cancelada')
from public.colonia_enrollments e
where e.id = c.enrollment_id
  and e.status = 'cancelada'
  and c.status = 'posted';
