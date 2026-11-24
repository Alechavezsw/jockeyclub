-- Colonia: readiness produccion — caps profesor, RLS financiera vs operativa, salud menores.
-- No aplicar en produccion sin autorizacion.

-- Profesor / staff: asistencia Colonia (sin cobranza).
insert into public.role_capabilities (capability, role_key)
select *
from (values
  ('colonia.attend', 'teacher'),
  ('colonia.attend', 'staff')
) as v(capability, role_key)
where exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'role_capabilities')
on conflict do nothing;

-- Datos sensibles de salud de menores: tabla aparte, solo operate.
create table if not exists public.colonia_student_health (
  student_id uuid primary key references public.colonia_students(id) on delete cascade,
  health_notes text,
  allergies text,
  medications text,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

alter table public.colonia_student_health enable row level security;

drop policy if exists colonia_student_health_all on public.colonia_student_health;
create policy colonia_student_health_all on public.colonia_student_health
  for all to authenticated
  using (public.colonia_has_cap('colonia.operate'))
  with check (public.colonia_has_cap('colonia.operate'));

revoke all on table public.colonia_student_health from public, anon;
grant select, insert, update, delete on table public.colonia_student_health to authenticated;

-- RLS financiera: attend NO lee cargos/pagos/tarifas/auditoria.
drop policy if exists colonia_charges_all on public.colonia_charges;
drop policy if exists colonia_charges_select on public.colonia_charges;
drop policy if exists colonia_charges_write on public.colonia_charges;
create policy colonia_charges_select on public.colonia_charges for select to authenticated
  using (
    public.colonia_has_cap('colonia.operate')
    or public.colonia_has_cap('colonia.report')
    or public.colonia_has_cap('colonia.collect')
  );
create policy colonia_charges_write on public.colonia_charges for all to authenticated
  using (public.colonia_has_cap('colonia.operate') or public.colonia_has_cap('colonia.collect'))
  with check (public.colonia_has_cap('colonia.operate') or public.colonia_has_cap('colonia.collect'));

drop policy if exists colonia_payments_all on public.colonia_payments;
drop policy if exists colonia_payments_select on public.colonia_payments;
drop policy if exists colonia_payments_write on public.colonia_payments;
create policy colonia_payments_select on public.colonia_payments for select to authenticated
  using (
    public.colonia_has_cap('colonia.operate')
    or public.colonia_has_cap('colonia.report')
    or public.colonia_has_cap('colonia.collect')
  );
create policy colonia_payments_write on public.colonia_payments for all to authenticated
  using (public.colonia_has_cap('colonia.operate') or public.colonia_has_cap('colonia.collect'))
  with check (public.colonia_has_cap('colonia.operate') or public.colonia_has_cap('colonia.collect'));

drop policy if exists colonia_tariffs_all on public.colonia_tariffs;
drop policy if exists colonia_tariffs_select on public.colonia_tariffs;
drop policy if exists colonia_tariffs_write on public.colonia_tariffs;
create policy colonia_tariffs_select on public.colonia_tariffs for select to authenticated
  using (
    public.colonia_has_cap('colonia.operate')
    or public.colonia_has_cap('colonia.report')
    or public.colonia_has_cap('colonia.collect')
  );
create policy colonia_tariffs_write on public.colonia_tariffs for all to authenticated
  using (public.colonia_has_cap('colonia.operate'))
  with check (public.colonia_has_cap('colonia.operate'));

drop policy if exists colonia_audit_logs_all on public.colonia_audit_logs;
drop policy if exists colonia_audit_logs_select on public.colonia_audit_logs;
create policy colonia_audit_logs_select on public.colonia_audit_logs for select to authenticated
  using (public.colonia_has_cap('colonia.operate') or public.colonia_has_cap('colonia.report'));

-- Asistencia: attend lee; escritura via RPC security definer.
drop policy if exists colonia_attendance_all on public.colonia_attendance;
drop policy if exists colonia_attendance_select on public.colonia_attendance;
create policy colonia_attendance_select on public.colonia_attendance for select to authenticated
  using (
    public.colonia_has_cap('colonia.operate')
    or public.colonia_has_cap('colonia.attend')
    or public.colonia_has_cap('colonia.report')
  );

-- Operativas: attend puede leer roster; escritura de filas solo operate (RPC definer para attend).
drop policy if exists colonia_students_all on public.colonia_students;
drop policy if exists colonia_students_select on public.colonia_students;
create policy colonia_students_select on public.colonia_students for select to authenticated
  using (
    public.colonia_has_cap('colonia.operate')
    or public.colonia_has_cap('colonia.attend')
    or public.colonia_has_cap('colonia.collect')
    or public.colonia_has_cap('colonia.report')
  );
create policy colonia_students_write on public.colonia_students for all to authenticated
  using (public.colonia_has_cap('colonia.operate'))
  with check (public.colonia_has_cap('colonia.operate'));

drop policy if exists colonia_guardians_all on public.colonia_guardians;
drop policy if exists colonia_guardians_select on public.colonia_guardians;
create policy colonia_guardians_select on public.colonia_guardians for select to authenticated
  using (
    public.colonia_has_cap('colonia.operate')
    or public.colonia_has_cap('colonia.attend')
    or public.colonia_has_cap('colonia.collect')
    or public.colonia_has_cap('colonia.report')
  );
create policy colonia_guardians_write on public.colonia_guardians for all to authenticated
  using (public.colonia_has_cap('colonia.operate'))
  with check (public.colonia_has_cap('colonia.operate'));

drop policy if exists colonia_enrollments_all on public.colonia_enrollments;
drop policy if exists colonia_enrollments_select on public.colonia_enrollments;
create policy colonia_enrollments_select on public.colonia_enrollments for select to authenticated
  using (
    public.colonia_has_cap('colonia.operate')
    or public.colonia_has_cap('colonia.attend')
    or public.colonia_has_cap('colonia.collect')
    or public.colonia_has_cap('colonia.report')
  );
create policy colonia_enrollments_write on public.colonia_enrollments for all to authenticated
  using (public.colonia_has_cap('colonia.operate'))
  with check (public.colonia_has_cap('colonia.operate'));

-- Upsert salud (solo operate).
create or replace function public.colonia_upsert_student_health(
  p_student_id uuid,
  p_health_notes text default null,
  p_allergies text default null,
  p_medications text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.colonia_student_health;
begin
  if auth.uid() is null then raise exception 'Tenés que estar logueado.'; end if;
  if not public.colonia_has_cap('colonia.operate') then
    raise exception 'Sin permiso para datos de salud de menores en Colonia.';
  end if;
  if not exists (select 1 from public.colonia_students where id = p_student_id) then
    raise exception 'Alumno no encontrado.';
  end if;

  insert into public.colonia_student_health (student_id, health_notes, allergies, medications, updated_by, updated_at)
  values (p_student_id, p_health_notes, p_allergies, p_medications, auth.uid(), now())
  on conflict (student_id) do update
  set health_notes = excluded.health_notes,
      allergies = excluded.allergies,
      medications = excluded.medications,
      updated_by = auth.uid(),
      updated_at = now()
  returning * into v_row;

  insert into public.colonia_audit_logs (actor_id, action, entity_type, entity_id, payload)
  values (auth.uid(), 'colonia_health_upserted', 'colonia_student_health', p_student_id,
    jsonb_build_object('has_notes', p_health_notes is not null, 'has_allergies', p_allergies is not null));

  return jsonb_build_object('ok', true, 'health', to_jsonb(v_row));
end;
$$;

revoke all on function public.colonia_upsert_student_health(uuid, text, text, text) from public, anon;
grant execute on function public.colonia_upsert_student_health(uuid, text, text, text) to authenticated;

notify pgrst, 'reload schema';
