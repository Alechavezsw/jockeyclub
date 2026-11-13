-- El número de tarjeta queda guardado completo, pero solo lo leen
-- contabilidad y superadmin. El resto del personal ve los últimos 4.

create or replace function public.can_read_member_cards()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_role() in ('accountant', 'superadmin')
    or public.user_has_role('accountant')
    or public.user_has_role('superadmin');
$$;

revoke all on function public.can_read_member_cards() from public, anon;
grant execute on function public.can_read_member_cards() to authenticated;

create or replace function public.redact_card_edits(p_edits jsonb)
returns jsonb
language sql
immutable
as $$
  select case
    when jsonb_typeof(p_edits) is distinct from 'array' then '[]'::jsonb
    else coalesce((
      select jsonb_agg(
        case
          when jsonb_typeof(e) = 'object' then
            (e - 'from' - 'to') || jsonb_build_object(
              'from', case
                when length(regexp_replace(coalesce(e->>'from', ''), '\D', '', 'g')) >= 4
                  then right(regexp_replace(e->>'from', '\D', '', 'g'), 4)
                else e->>'from'
              end,
              'to', case
                when length(regexp_replace(coalesce(e->>'to', ''), '\D', '', 'g')) >= 4
                  then right(regexp_replace(e->>'to', '\D', '', 'g'), 4)
                else e->>'to'
              end
            )
          else e
        end
      )
      from jsonb_array_elements(p_edits) e
    ), '[]'::jsonb)
  end;
$$;

revoke all on function public.redact_card_edits(jsonb) from public, anon;
grant execute on function public.redact_card_edits(jsonb) to authenticated;

create table if not exists public.member_card_vault (
  member_id uuid primary key references public.members(id) on delete cascade,
  card_number text not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.debit_listing_cards (
  listing_id text primary key references public.debit_listings(id) on delete cascade,
  card_number text,
  card_edits jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.debit_event_cards (
  event_id uuid primary key references public.debit_move_events(id) on delete cascade,
  card_number text not null
);

alter table public.member_card_vault enable row level security;
alter table public.debit_listing_cards enable row level security;
alter table public.debit_event_cards enable row level security;

drop policy if exists member_card_vault_select on public.member_card_vault;
create policy member_card_vault_select
  on public.member_card_vault
  for select
  to authenticated
  using (public.can_read_member_cards());

drop policy if exists debit_listing_cards_select on public.debit_listing_cards;
create policy debit_listing_cards_select
  on public.debit_listing_cards
  for select
  to authenticated
  using (public.can_read_member_cards());

drop policy if exists debit_event_cards_select on public.debit_event_cards;
create policy debit_event_cards_select
  on public.debit_event_cards
  for select
  to authenticated
  using (public.can_read_member_cards());

revoke all on public.member_card_vault from public, anon, authenticated;
revoke all on public.debit_listing_cards from public, anon, authenticated;
revoke all on public.debit_event_cards from public, anon, authenticated;
grant select on public.member_card_vault to authenticated;
grant select on public.debit_listing_cards to authenticated;
grant select on public.debit_event_cards to authenticated;

alter table public.members
  add column if not exists card_last4 text;

comment on column public.members.card_last4 is
  'Últimos 4 de la tarjeta. El número completo está en member_card_vault.';

create or replace function public.stash_member_card_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  digits text := regexp_replace(coalesce(new.card_number, ''), '\D', '', 'g');
begin
  if length(digits) >= 13 then
    if auth.uid() is not null
       and coalesce(current_setting('jockey.card_write', true), '') is distinct from '1'
       and not public.can_read_member_cards() then
      raise exception 'Sin permiso para ver el número de tarjeta.' using errcode = '42501';
    end if;
    insert into public.member_card_vault (member_id, card_number)
    values (new.id, digits)
    on conflict (member_id) do update
      set card_number = excluded.card_number,
          updated_at = now();
    new.card_last4 := right(digits, 4);
    new.card_number := null;
    return new;
  end if;

  if length(digits) > 0 then
    new.card_number := null;
    if new.card_last4 is null or new.card_last4 = '' then
      new.card_last4 := right(digits, 4);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_stash_member_card_number on public.members;
create trigger trg_stash_member_card_number
  before insert or update of card_number on public.members
  for each row execute function public.stash_member_card_number();

create or replace function public.stash_debit_listing_card()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  digits text := regexp_replace(coalesce(new.card_number, ''), '\D', '', 'g');
  edits_have_pan boolean := coalesce(new.card_edits::text, '') ~ '\d{13,19}';
  full_edits jsonb := new.card_edits;
begin
  if length(digits) >= 13 or edits_have_pan then
    if auth.uid() is not null
       and coalesce(current_setting('jockey.card_write', true), '') is distinct from '1'
       and not public.can_read_member_cards() then
      raise exception 'Sin permiso para ver el número de tarjeta.' using errcode = '42501';
    end if;
    insert into public.debit_listing_cards (listing_id, card_number, card_edits)
    values (
      new.id,
      case when length(digits) >= 13 then digits else null end,
      case when edits_have_pan then full_edits else '[]'::jsonb end
    )
    on conflict (listing_id) do update
      set card_number = coalesce(excluded.card_number, public.debit_listing_cards.card_number),
          card_edits = case
            when edits_have_pan then excluded.card_edits
            else public.debit_listing_cards.card_edits
          end,
          updated_at = now();
  end if;

  if length(digits) >= 13 then
    new.card_number := right(digits, 4);
  end if;
  new.card_edits := public.redact_card_edits(new.card_edits);
  return new;
end;
$$;

drop trigger if exists trg_stash_debit_listing_card on public.debit_listings;
create trigger trg_stash_debit_listing_card
  before insert or update of card_number, card_edits on public.debit_listings
  for each row execute function public.stash_debit_listing_card();

create or replace function public.stash_debit_event_card()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  digits text := regexp_replace(coalesce(new.card_number, ''), '\D', '', 'g');
begin
  if length(digits) >= 13 then
    if auth.uid() is not null
       and coalesce(current_setting('jockey.card_write', true), '') is distinct from '1'
       and not public.can_read_member_cards() then
      raise exception 'Sin permiso para ver el número de tarjeta.' using errcode = '42501';
    end if;
    insert into public.debit_event_cards (event_id, card_number)
    values (new.id, digits)
    on conflict (event_id) do update
      set card_number = excluded.card_number;
    new.card_number := right(digits, 4);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_stash_debit_event_card on public.debit_move_events;
create trigger trg_stash_debit_event_card
  before insert or update of card_number on public.debit_move_events
  for each row execute function public.stash_debit_event_card();

update public.members
set card_number = card_number
where length(regexp_replace(coalesce(card_number, ''), '\D', '', 'g')) >= 13;

update public.debit_listings
set card_number = card_number
where length(regexp_replace(coalesce(card_number, ''), '\D', '', 'g')) >= 13
   or coalesce(card_edits::text, '') ~ '\d{13,19}';

update public.debit_move_events
set card_number = card_number
where length(regexp_replace(coalesce(card_number, ''), '\D', '', 'g')) >= 13;

update public.debit_listings
set note = regexp_replace(note, '\d{13,19}', '••••', 'g')
where note ~ '\d{13,19}';

update public.members
set notes = regexp_replace(notes, '\d{13,19}', '••••', 'g')
where notes ~ '\d{13,19}';

update public.members
set meta = meta - 'cardNumber'
where meta ? 'cardNumber';

update public.members
set meta = jsonb_set(
  meta,
  '{debitMoves}',
  (
    select coalesce(jsonb_agg((e - 'cardNumber') - 'card_number'), '[]'::jsonb)
    from jsonb_array_elements(meta->'debitMoves') e
  )
)
where jsonb_typeof(meta->'debitMoves') = 'array';

update public.audit_logs
set payload = payload
  || case
    when coalesce(payload->>'cardNumber', '') ~ '\d{13,19}' then
      jsonb_build_object('cardNumber', right(regexp_replace(payload->>'cardNumber', '\D', '', 'g'), 4))
    else '{}'::jsonb
  end
  || case
    when coalesce(payload->>'from', '') ~ '\d{13,19}' then
      jsonb_build_object('from', right(regexp_replace(payload->>'from', '\D', '', 'g'), 4))
    else '{}'::jsonb
  end
  || case
    when coalesce(payload->>'to', '') ~ '\d{13,19}' then
      jsonb_build_object('to', right(regexp_replace(payload->>'to', '\D', '', 'g'), 4))
    else '{}'::jsonb
  end
where entity_type in ('debit_listing', 'debit_move_event')
  and (
    coalesce(payload->>'cardNumber', '') ~ '\d{13,19}'
    or coalesce(payload->>'from', '') ~ '\d{13,19}'
    or coalesce(payload->>'to', '') ~ '\d{13,19}'
  );

create or replace function public.list_members_padron(p_scope text default 'active')
returns table (
  id uuid,
  profile_id uuid,
  member_number text,
  card_number text,
  full_name text,
  phone text,
  email text,
  tier text,
  status text,
  outstanding_balance numeric,
  next_due_date date,
  overdue_since date,
  document_number text,
  document_type text,
  last_payment_date text,
  family_principal text,
  family_group_name text,
  cuota_categories jsonb,
  current_account_as_of text,
  baja_motivo text,
  baja_fecha text,
  baja_actor text,
  baja_registrada text,
  reactivate_actor text,
  reactivate_registrada text,
  has_portal boolean,
  joined_at date
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  want_inactive boolean := lower(coalesce(p_scope, 'active')) = 'inactive';
begin
  if auth.uid() is null or not public.has_staff_access() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  return query
  select
    m.id,
    m.profile_id,
    m.member_number,
    m.card_last4,
    m.full_name,
    m.phone,
    m.email,
    m.tier,
    m.status::text,
    m.outstanding_balance,
    m.next_due_date,
    m.overdue_since,
    m.document_number,
    m.document_type,
    m.meta->>'lastPaymentDate',
    m.meta->>'familyPrincipalNumber',
    m.meta->>'familyGroupName',
    m.meta->'cuotaCategories',
    m.meta->>'currentAccountAsOf',
    case when want_inactive then m.meta->>'bajaMotivo' else null end,
    case when want_inactive then m.meta->>'bajaFecha' else null end,
    case when want_inactive then m.meta->>'bajaActorName' else null end,
    case when want_inactive then m.meta->>'bajaRegistradaAt' else null end,
    case when want_inactive then m.meta->>'reactivateActorName' else null end,
    case when want_inactive then m.meta->>'reactivateRegistradaAt' else null end,
    (
      m.profile_id is not null
      or coalesce(m.meta->>'portalProvisionedAt', '') <> ''
      or coalesce(m.meta->>'portalUsername', '') <> ''
      or exists (
        select 1
        from public.profiles p
        where (
          length(regexp_replace(coalesce(m.document_number, ''), '\D', '', 'g')) >= 7
          and regexp_replace(coalesce(p.document_number, ''), '\D', '', 'g')
            = regexp_replace(coalesce(m.document_number, ''), '\D', '', 'g')
        )
        or (
          coalesce(m.email, '') <> ''
          and lower(p.email) = lower(m.email)
        )
      )
    ) as has_portal,
    case
      when m.joined_at is not null and m.joined_at > date '1900-01-01' then m.joined_at
      when coalesce(m.meta->>'fechaAltaRaw', '') ~ '^\d{4}-\d{2}-\d{2}'
        and (left(m.meta->>'fechaAltaRaw', 10))::date > date '1900-01-01'
        then (left(m.meta->>'fechaAltaRaw', 10))::date
      else m.joined_at
    end as joined_at
  from public.members m
  where case
    when want_inactive then m.status is distinct from 'active'::public.member_status
    else m.status = 'active'::public.member_status
  end
  order by m.id;
end;
$$;

revoke all on function public.list_members_padron(text) from public;
grant execute on function public.list_members_padron(text) to authenticated;

comment on function public.list_members_padron(text) is
  'Padrón staff. card_number del resultado son solo los últimos 4.';

create or replace function public.copy_debit_listings_from_previous_month(
  p_year integer,
  p_month integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prev_year integer;
  v_prev_month integer;
  v_count integer := 0;
begin
  if auth.uid() is null or not public.has_staff_access() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_year is null or p_month is null or p_month < 1 or p_month > 12 then
    raise exception 'Falta el período destino.';
  end if;
  if p_month = 1 then
    v_prev_year := p_year - 1;
    v_prev_month := 12;
  else
    v_prev_year := p_year;
    v_prev_month := p_month - 1;
  end if;

  if not exists (
    select 1
    from public.debit_listings
    where year = v_prev_year
      and month = v_prev_month
      and section <> 'bajas'
  ) then
    raise exception 'No hay planilla en el mes anterior para copiar.';
  end if;

  perform set_config('jockey.card_write', '1', true);

  delete from public.debit_listings d
  where d.year = p_year
    and d.month = p_month
    and exists (
      select 1
      from public.debit_listings s
      where s.year = v_prev_year
        and s.month = v_prev_month
        and s.sheet_kind = d.sheet_kind
        and s.section <> 'bajas'
    );

  insert into public.debit_listings (
    id, year, month, sheet_kind, brand, section, sort_order,
    card_number, receipt, due_date, dues_amount, abono_amount, total_amount,
    member_id, status_code, holder_name, note, source_sheet, card_edits
  )
  select
    format(
      'dl-%s%s-%s-%s',
      p_year,
      lpad(p_month::text, 2, '0'),
      d.sheet_kind,
      row_number() over (partition by d.sheet_kind order by d.sort_order, d.id)
    ),
    p_year,
    p_month,
    d.sheet_kind,
    d.brand,
    case
      when d.section in ('altas', 'cambios') then 'padron'
      when d.section = 'debitos_aplicacion' then 'debitos_aplicacion'
      else 'padron'
    end,
    d.sort_order,
    coalesce(v.card_number, d.card_number),
    p_month::text || p_year::text,
    make_date(p_year, p_month, 10),
    d.dues_amount,
    d.abono_amount,
    d.total_amount,
    d.member_id,
    d.status_code,
    d.holder_name,
    case when d.section in ('altas', 'cambios') then '' else d.note end,
    d.source_sheet,
    '[]'::jsonb
  from public.debit_listings d
  left join public.debit_listing_cards v on v.listing_id = d.id
  where d.year = v_prev_year
    and d.month = v_prev_month
    and d.section <> 'bajas';

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.copy_debit_listings_from_previous_month(integer, integer) from public, anon;
grant execute on function public.copy_debit_listings_from_previous_month(integer, integer) to authenticated;
