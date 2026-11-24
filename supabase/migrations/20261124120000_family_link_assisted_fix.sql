-- Corrección asistida de vínculos familiares (meta.familyPrincipalNumber).
-- No toca saldos, cuotas, pagos ni asientos.
-- Aplicar solo vía migración revisada; esta copia es el artefacto del PR.

create table if not exists public.family_link_audits (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  actor_id uuid,
  actor_name text,
  actor_email text,
  member_id uuid,
  member_number text not null,
  previous_principal text,
  new_principal text not null,
  reason text not null,
  result text not null default 'applied',
  payload jsonb not null default '{}'::jsonb
);

create index if not exists family_link_audits_member_number_idx
  on public.family_link_audits (member_number, created_at desc);

create index if not exists family_link_audits_created_at_idx
  on public.family_link_audits (created_at desc);

alter table public.family_link_audits enable row level security;

drop policy if exists family_link_audits_select_admin on public.family_link_audits;
create policy family_link_audits_select_admin
  on public.family_link_audits
  for select
  to authenticated
  using (public.has_admin_access());

-- Sin update/delete desde clientes: el historial es append-only vía RPC.

revoke insert, update, delete on public.family_link_audits from anon, authenticated;
grant select on public.family_link_audits to authenticated;
grant all on public.family_link_audits to service_role;

-- Camina la cadena de titulares con tope de profundidad y nodos visitados.
-- Simula member -> proposed y detecta ciclos (A->A, A<->B, A->B->C->A, ...) y cadenas rotas.
create or replace function public.family_link_chain_probe(
  p_member_number text,
  p_proposed_principal text,
  p_max_depth integer default 16
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_member text := nullif(regexp_replace(coalesce(p_member_number, ''), '\D', '', 'g'), '');
  v_proposed text := nullif(regexp_replace(coalesce(p_proposed_principal, ''), '\D', '', 'g'), '');
  v_max integer := greatest(1, least(coalesce(p_max_depth, 16), 32));
  v_current text;
  v_next text;
  v_self text;
  v_visited text[] := array[]::text[];
  v_depth integer := 0;
  v_row public.members;
begin
  if v_member is null or v_proposed is null then
    return jsonb_build_object('cycle', false, 'incomplete', false, 'path', '[]'::jsonb);
  end if;
  if v_member = v_proposed then
    return jsonb_build_object(
      'cycle', true,
      'incomplete', false,
      'self', true,
      'path', jsonb_build_array(v_member),
      'cycleAt', v_member
    );
  end if;

  -- Tras el cambio, el socio apunta al propuesto: seed visitado = socio.
  v_visited := array[v_member];
  v_current := v_proposed;

  while v_current is not null and v_depth < v_max loop
    if v_current = any (v_visited) then
      return jsonb_build_object(
        'cycle', true,
        'incomplete', false,
        'self', false,
        'path', to_jsonb(v_visited),
        'cycleAt', v_current
      );
    end if;

    v_visited := v_visited || v_current;

    select * into v_row
    from public.members
    where member_number = v_current;

    if not found then
      return jsonb_build_object(
        'cycle', false,
        'incomplete', true,
        'path', to_jsonb(v_visited),
        'missing', v_current
      );
    end if;

    v_self := v_row.member_number;
    v_next := nullif(btrim(coalesce(v_row.meta ->> 'familyPrincipalNumber', '')), '');
    if v_next is null or v_next = v_self then
      return jsonb_build_object(
        'cycle', false,
        'incomplete', false,
        'path', to_jsonb(v_visited)
      );
    end if;

    v_current := v_next;
    v_depth := v_depth + 1;
  end loop;

  return jsonb_build_object(
    'cycle', true,
    'incomplete', false,
    'path', to_jsonb(v_visited),
    'cycleAt', v_current,
    'maxDepth', true
  );
end;
$$;

revoke all on function public.family_link_chain_probe(text, text, integer) from public, anon;
grant execute on function public.family_link_chain_probe(text, text, integer) to authenticated;

create or replace function public.preview_family_link_change(
  p_member_number text,
  p_proposed_principal text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member public.members;
  v_proposed public.members;
  v_member_number text := nullif(regexp_replace(coalesce(p_member_number, ''), '\D', '', 'g'), '');
  v_proposed_number text := nullif(regexp_replace(coalesce(p_proposed_principal, ''), '\D', '', 'g'), '');
  v_current text;
  v_proposed_points_to text;
  v_origin jsonb := '[]'::jsonb;
  v_destination jsonb := '[]'::jsonb;
  v_errors jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_probe jsonb;
  v_path_label text;
begin
  if auth.uid() is null then
    raise exception 'Tenés que estar logueado.';
  end if;
  if not public.has_admin_access() then
    raise exception 'Sin permiso para revisar vínculos familiares.';
  end if;
  if v_member_number is null then
    raise exception 'Falta el número de socio.';
  end if;

  select * into v_member
  from public.members
  where member_number = v_member_number;

  if not found then
    raise exception 'No se encontró el socio Nº %.', v_member_number;
  end if;

  v_current := nullif(btrim(coalesce(v_member.meta ->> 'familyPrincipalNumber', '')), '');
  if v_current is null then
    v_current := v_member.member_number;
  end if;

  if v_proposed_number is null then
    v_errors := v_errors || jsonb_build_array(jsonb_build_object(
      'code', 'missing_proposed',
      'message', 'Indicá el Nº del nuevo titular.'
    ));
  elsif v_proposed_number = v_member_number then
    v_errors := v_errors || jsonb_build_array(jsonb_build_object(
      'code', 'self_principal',
      'message', 'Un socio no puede quedar como titular de sí mismo por esta vía.'
    ));
  else
    select * into v_proposed
    from public.members
    where member_number = v_proposed_number;

    if not found then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'code', 'proposed_missing',
        'message', format('No existe el titular Nº %s en el padrón.', v_proposed_number)
      ));
    else
      v_proposed_points_to := nullif(btrim(coalesce(v_proposed.meta ->> 'familyPrincipalNumber', '')), '');
      if v_proposed_points_to is not null and v_proposed_points_to is distinct from v_proposed_number then
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'code', 'proposed_is_dependent',
          'message', format(
            'El Nº %s es integrante del hogar de Nº %s. Indicá el titular real de ese hogar, no un integrante.',
            v_proposed_number, v_proposed_points_to
          )
        ));
      end if;

      v_probe := public.family_link_chain_probe(v_member_number, v_proposed_number, 16);
      if coalesce((v_probe ->> 'cycle')::boolean, false) then
        select string_agg(x, ' -> ')
        into v_path_label
        from jsonb_array_elements_text(coalesce(v_probe -> 'path', '[]'::jsonb)) as t(x);
        if v_probe ? 'cycleAt' then
          v_path_label := coalesce(v_path_label, '') || ' -> ' || (v_probe ->> 'cycleAt');
        end if;
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'code', 'circular_link',
          'message', format('Ese vínculo formaría un ciclo familiar (%s).', coalesce(v_path_label, v_proposed_number))
        ));
      elsif coalesce((v_probe ->> 'incomplete')::boolean, false) then
        v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
          'code', 'incomplete_chain',
          'message', 'Hay una referencia histórica incompleta en la cadena del titular propuesto (Nº ausente en el padrón).'
        ));
      end if;

      if v_proposed.status is distinct from 'active' then
        v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
          'code', 'proposed_inactive',
          'message', format('El titular Nº %s no está operativo. No se reactiva solo.', v_proposed_number)
        ));
      end if;
    end if;
  end if;

  if v_proposed_number is not null and v_proposed_number = v_current then
    v_errors := v_errors || jsonb_build_array(jsonb_build_object(
      'code', 'no_change',
      'message', 'El titular propuesto es el mismo que el actual.'
    ));
  end if;

  v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
    'code', 'admin_link_only',
    'message', 'Este cambio modifica el vínculo administrativo del hogar. No altera saldos, cuotas, pagos ni reservas. Los cobros futuros del integrante siguen mirando la cuenta del titular apuntado (modelo de hogar).'
  ));

  select coalesce(jsonb_agg(jsonb_build_object(
    'memberNumber', m.member_number,
    'fullName', m.full_name,
    'status', m.status::text,
    'role', case when m.member_number = v_current then 'Titular' else 'Integrante' end
  ) order by m.member_number), '[]'::jsonb)
  into v_origin
  from public.members m
  where m.member_number = v_current
     or nullif(btrim(coalesce(m.meta ->> 'familyPrincipalNumber', '')), '') = v_current;

  if v_proposed_number is not null and v_proposed is not null then
    select coalesce(jsonb_agg(jsonb_build_object(
      'memberNumber', m.member_number,
      'fullName', m.full_name,
      'status', m.status::text,
      'role', case when m.member_number = v_proposed_number then 'Titular' else 'Integrante' end
    ) order by m.member_number), '[]'::jsonb)
    into v_destination
    from public.members m
    where m.member_number = v_proposed_number
       or nullif(btrim(coalesce(m.meta ->> 'familyPrincipalNumber', '')), '') = v_proposed_number;
  end if;

  return jsonb_build_object(
    'ok', jsonb_array_length(v_errors) = 0,
    'memberNumber', v_member.member_number,
    'memberName', v_member.full_name,
    'memberStatus', v_member.status::text,
    'expectedPrincipal', v_current,
    'proposedPrincipal', v_proposed_number,
    'proposedName', v_proposed.full_name,
    'proposedStatus', v_proposed.status::text,
    'originHousehold', v_origin,
    'destinationHousehold', v_destination,
    'errors', v_errors,
    'warnings', v_warnings,
    'financialNote', 'Sin impacto financiero directo: no se tocan saldos, cuotas, asientos ni reservas. No se reasignan débitos ni cargos históricos.',
    'chainProbe', coalesce(v_probe, '{}'::jsonb)
  );
end;
$$;

create or replace function public.apply_family_link_change(
  p_member_number text,
  p_expected_principal text,
  p_proposed_principal text,
  p_reason text,
  p_ack_inactive boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member public.members;
  v_proposed public.members;
  v_member_number text := nullif(regexp_replace(coalesce(p_member_number, ''), '\D', '', 'g'), '');
  v_expected text := nullif(regexp_replace(coalesce(p_expected_principal, ''), '\D', '', 'g'), '');
  v_proposed_number text := nullif(regexp_replace(coalesce(p_proposed_principal, ''), '\D', '', 'g'), '');
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_current text;
  v_proposed_points_to text;
  v_group_name text;
  v_actor_name text;
  v_actor_email text;
  v_audit_id uuid;
  v_balance numeric;
  v_probe jsonb;
  v_path_label text;
begin
  if auth.uid() is null then
    raise exception 'Tenés que estar logueado.';
  end if;
  if not public.has_admin_access() then
    raise exception 'Sin permiso para corregir vínculos familiares.';
  end if;
  if v_member_number is null then
    raise exception 'Falta el número de socio.';
  end if;
  if v_proposed_number is null then
    raise exception 'Indicá el Nº del nuevo titular.';
  end if;
  if v_reason is null or char_length(v_reason) < 8 then
    raise exception 'Falta el motivo (mínimo 8 caracteres).';
  end if;
  if v_proposed_number = v_member_number then
    raise exception 'Un socio no puede quedar como titular de sí mismo por esta vía.';
  end if;

  select full_name, email
  into v_actor_name, v_actor_email
  from public.profiles
  where id = auth.uid();

  v_actor_email := coalesce(v_actor_email, nullif(auth.jwt() ->> 'email', ''));
  v_actor_name := coalesce(nullif(btrim(v_actor_name), ''), v_actor_email, 'Usuario');

  select * into v_member
  from public.members
  where member_number = v_member_number
  for update;

  if not found then
    raise exception 'No se encontró el socio Nº %.', v_member_number;
  end if;

  v_balance := coalesce(v_member.outstanding_balance, 0);
  v_current := nullif(btrim(coalesce(v_member.meta ->> 'familyPrincipalNumber', '')), '');
  if v_current is null then
    v_current := v_member.member_number;
  end if;

  if v_expected is null then
    raise exception 'Falta el titular esperado para controlar concurrencia.';
  end if;
  if v_current is distinct from v_expected then
    raise exception 'El vínculo cambió desde la revisión (era %, ahora %). Volvé a revisar.', v_expected, v_current;
  end if;
  if v_proposed_number = v_current then
    raise exception 'El titular propuesto es el mismo que el actual.';
  end if;

  select * into v_proposed
  from public.members
  where member_number = v_proposed_number
  for share;

  if not found then
    raise exception 'No existe el titular Nº % en el padrón.', v_proposed_number;
  end if;

  v_proposed_points_to := nullif(btrim(coalesce(v_proposed.meta ->> 'familyPrincipalNumber', '')), '');
  if v_proposed_points_to is not null and v_proposed_points_to is distinct from v_proposed_number then
    raise exception
      'El Nº % es integrante del hogar de Nº %. Indicá el titular real de ese hogar, no un integrante.',
      v_proposed_number, v_proposed_points_to;
  end if;

  v_probe := public.family_link_chain_probe(v_member_number, v_proposed_number, 16);
  if coalesce((v_probe ->> 'cycle')::boolean, false) then
    select string_agg(x, ' -> ')
    into v_path_label
    from jsonb_array_elements_text(coalesce(v_probe -> 'path', '[]'::jsonb)) as t(x);
    raise exception 'Ese vínculo formaría un ciclo familiar (%).',
      coalesce(v_path_label, v_proposed_number);
  end if;

  if v_proposed.status is distinct from 'active' and not coalesce(p_ack_inactive, false) then
    raise exception 'El titular Nº % no está operativo. Confirmá expresamente si igual querés vincular.', v_proposed_number;
  end if;

  v_group_name := nullif(btrim(coalesce(v_proposed.meta ->> 'familyGroupName', '')), '');
  if v_group_name is null then
    v_group_name := nullif(btrim(coalesce(v_proposed.full_name, '')), '');
  end if;

  update public.members
  set meta = coalesce(meta, '{}'::jsonb)
      || jsonb_build_object(
        'familyPrincipalNumber', v_proposed_number,
        'familyGroupName', v_group_name
      )
      || jsonb_build_object(
        'lastFamilyLinkChange', jsonb_build_object(
          'at', to_jsonb(clock_timestamp()) #>> '{}',
          'actorId', auth.uid(),
          'actorName', v_actor_name,
          'from', v_current,
          'to', v_proposed_number,
          'reason', v_reason
        )
      ),
      updated_at = now()
  where id = v_member.id
    and coalesce(outstanding_balance, 0) = v_balance;

  if not found then
    raise exception 'No se pudo aplicar el vínculo (posible cambio concurrente de ficha).';
  end if;

  -- Defensa: el saldo no debe haberse tocado.
  if exists (
    select 1 from public.members
    where id = v_member.id and coalesce(outstanding_balance, 0) is distinct from v_balance
  ) then
    raise exception 'Abortado: el saldo no puede cambiar en una corrección de vínculo.';
  end if;

  insert into public.family_link_audits (
    actor_id, actor_name, actor_email,
    member_id, member_number,
    previous_principal, new_principal,
    reason, result, payload
  ) values (
    auth.uid(), v_actor_name, v_actor_email,
    v_member.id, v_member.member_number,
    v_current, v_proposed_number,
    v_reason, 'applied',
    jsonb_build_object(
      'familyGroupName', v_group_name,
      'proposedStatus', v_proposed.status::text,
      'ackInactive', coalesce(p_ack_inactive, false),
      'outstandingBalanceUnchanged', v_balance,
      'chainPath', coalesce(v_probe -> 'path', '[]'::jsonb)
    )
  )
  returning id into v_audit_id;

  -- Si falla el audit general, toda la función hace rollback (incluye el update de meta).
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  values (
    auth.uid(),
    'family_link_change',
    'members',
    v_member.id,
    jsonb_build_object(
      'member_number', v_member.member_number,
      'previous_principal', v_current,
      'new_principal', v_proposed_number,
      'reason', v_reason,
      'audit_id', v_audit_id,
      'actor_name', v_actor_name,
      'actor_email', v_actor_email
    )
  );

  return jsonb_build_object(
    'ok', true,
    'auditId', v_audit_id,
    'memberNumber', v_member.member_number,
    'previousPrincipal', v_current,
    'newPrincipal', v_proposed_number,
    'familyGroupName', v_group_name,
    'outstandingBalance', v_balance
  );
end;
$$;

create or replace function public.list_family_link_audits(
  p_member_number text default null,
  p_limit integer default 50
)
returns setof public.family_link_audits
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 200));
  v_number text := nullif(regexp_replace(coalesce(p_member_number, ''), '\D', '', 'g'), '');
begin
  if auth.uid() is null then
    raise exception 'Tenés que estar logueado.';
  end if;
  if not public.has_admin_access() then
    raise exception 'Sin permiso para ver la auditoría de vínculos.';
  end if;

  return query
  select *
  from public.family_link_audits a
  where v_number is null or a.member_number = v_number
  order by a.created_at desc
  limit v_limit;
end;
$$;

revoke all on function public.preview_family_link_change(text, text) from public, anon;
revoke all on function public.apply_family_link_change(text, text, text, text, boolean) from public, anon;
revoke all on function public.list_family_link_audits(text, integer) from public, anon;

grant execute on function public.preview_family_link_change(text, text) to authenticated;
grant execute on function public.apply_family_link_change(text, text, text, text, boolean) to authenticated;
grant execute on function public.list_family_link_audits(text, integer) to authenticated;

notify pgrst, 'reload schema';

