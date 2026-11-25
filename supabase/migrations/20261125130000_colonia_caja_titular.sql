-- El movimiento de caja de Colonia nombra al alumno y al socio titular del grupo.

do $patch$
declare
  def text := pg_get_functiondef('public.colonia_post_treasury(uuid,boolean)'::regprocedure);
  patched text := def;
  lookup text := $new$
  if v_member is not null and not exists (select 1 from public.members m where m.id = v_member) then
    v_member := null;
  end if;

  select t.id, btrim(t.full_name), regexp_replace(coalesce(t.member_number, ''), '^0+', '')
    into v_titular_id, v_titular_name, v_titular_number
  from public.colonia_students s
  left join public.colonia_enrollments e on e.id = v_pay.enrollment_id
  left join public.colonia_guardians g on g.id = e.guardian_id
  left join lateral (
    select m.id
    from public.members m
    where regexp_replace(coalesce(m.member_number, ''), '^0+', '')
        = regexp_replace(coalesce(s.member_number, ''), '^0+', '')
      and regexp_replace(coalesce(s.member_number, ''), '^0+', '') <> ''
    limit 1
  ) kid on true
  left join public.members anchor on anchor.id = coalesce(s.member_id, g.member_id, kid.id)
  left join public.members t
    on regexp_replace(coalesce(t.member_number, ''), '^0+', '')
     = regexp_replace(coalesce(nullif(btrim(anchor.meta->>'familyPrincipalNumber'), ''), anchor.member_number), '^0+', '')
   and regexp_replace(coalesce(nullif(btrim(anchor.meta->>'familyPrincipalNumber'), ''), anchor.member_number), '^0+', '') <> ''
  where s.id = v_pay.student_id
  limit 1;
  if v_titular_id is not null then
    v_member := v_titular_id;
  end if;

  select id into v_income$new$;
  concept_old text := $old$
  v_concept := left(
    'Colonia de Verano'
      || case when nullif(btrim(coalesce(v_student_name, '')), '') is null then '' else ' · ' || btrim(v_student_name) end
      || ' · ' || v_memo,
    240
  );$old$;
  concept_new text := $new$
  v_concept := left(
    'Colonia de Verano'
      || case when nullif(btrim(coalesce(v_student_name, '')), '') is null then '' else ' · ' || btrim(v_student_name) end
      || case
           when nullif(btrim(coalesce(v_titular_name, '')), '') is null then ''
           when lower(btrim(v_titular_name)) = lower(btrim(coalesce(v_student_name, ''))) then ''
           else ' · ' || btrim(v_titular_name)
             || case when nullif(v_titular_number, '') is null then '' else ' Nº ' || v_titular_number end
         end
      || ' · ' || v_memo,
    240
  );$new$;
begin
  if position('v_titular_name text' in patched) = 0 then
    patched := replace(patched, 'v_student_name text;', 'v_student_name text;' || chr(10) || '  v_titular_name text;' || chr(10) || '  v_titular_number text;' || chr(10) || '  v_titular_id uuid;');
  end if;
  if position('v_titular_id, v_titular_name' in patched) = 0 then
    patched := replace(
      patched,
      $old$  if v_member is not null and not exists (select 1 from public.members m where m.id = v_member) then
    v_member := null;
  end if;

  select id into v_income$old$,
      lookup
    );
  end if;
  if position('v_titular_name' in patched) > 0 and position(concept_old in patched) > 0 then
    patched := replace(patched, concept_old, concept_new);
  end if;
  if patched = def then
    return;
  end if;
  execute patched;
end
$patch$;

update public.journal_entries je
set concept = left(
  'Colonia de Verano · ' || btrim(s.full_name)
  || ' · ' || btrim(t.full_name)
  || ' Nº ' || regexp_replace(coalesce(t.member_number, ''), '^0+', '')
  || substring(je.concept from char_length('Colonia de Verano · ' || btrim(s.full_name)) + 1),
  240
)
from public.colonia_payments p
join public.colonia_students s on s.id = p.student_id
join lateral (
  select m.id
  from public.members m
  where regexp_replace(coalesce(m.member_number, ''), '^0+', '')
      = regexp_replace(coalesce(s.member_number, ''), '^0+', '')
    and regexp_replace(coalesce(s.member_number, ''), '^0+', '') <> ''
  limit 1
) kid on true
join public.members anchor on anchor.id = kid.id
join public.members t
  on regexp_replace(coalesce(t.member_number, ''), '^0+', '')
   = regexp_replace(coalesce(nullif(btrim(anchor.meta->>'familyPrincipalNumber'), ''), anchor.member_number), '^0+', '')
where je.source_module = 'colonia'
  and je.source_id = p.id
  and je.concept like 'Colonia de Verano · ' || btrim(s.full_name) || ' · %'
  and lower(btrim(t.full_name)) <> lower(btrim(s.full_name))
  and position(btrim(t.full_name) in je.concept) = 0;

update public.cash_movements cm
set concept = je.concept,
    member_id = coalesce(t.id, cm.member_id)
from public.journal_entries je
join public.colonia_payments p on p.id = je.source_id
join public.colonia_students s on s.id = p.student_id
join lateral (
  select m.id
  from public.members m
  where regexp_replace(coalesce(m.member_number, ''), '^0+', '')
      = regexp_replace(coalesce(s.member_number, ''), '^0+', '')
    and regexp_replace(coalesce(s.member_number, ''), '^0+', '') <> ''
  limit 1
) kid on true
join public.members anchor on anchor.id = kid.id
join public.members t
  on regexp_replace(coalesce(t.member_number, ''), '^0+', '')
   = regexp_replace(coalesce(nullif(btrim(anchor.meta->>'familyPrincipalNumber'), ''), anchor.member_number), '^0+', '')
where cm.journal_entry_id = je.id
  and je.source_module = 'colonia';

notify pgrst, 'reload schema';
