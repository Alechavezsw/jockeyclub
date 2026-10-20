-- Descuentos y gastos fijos de Lila: reglas editables, no un recorte.
create table if not exists public.discount_rules (
  id uuid primary key default gen_random_uuid(),
  rule_key text not null unique,
  category text not null default 'members'
    check (category in ('members', 'fee_category', 'member_fee', 'family', 'general')),
  member_numbers text,
  member_name text,
  fee_categories text,
  family_group text,
  description text not null,
  value_type text not null default 'percent'
    check (value_type in ('percent', 'amount')),
  value numeric(14, 2) not null default 0,
  valid_from date,
  valid_to date,
  is_active boolean not null default true,
  accessin_id integer,
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists discount_rules_active_idx
  on public.discount_rules (is_active, valid_from, valid_to);

alter table public.discount_rules enable row level security;

drop policy if exists discount_rules_access on public.discount_rules;
create policy discount_rules_access on public.discount_rules
  for all
  using (public.has_accounting_access())
  with check (public.has_accounting_access());

grant select, insert, update, delete on public.discount_rules to authenticated;

insert into public.discount_rules (
  rule_key, category, member_numbers, member_name, fee_categories, family_group,
  description, value_type, value, valid_from, valid_to, is_active, accessin_id, source
)
select
  rule->>'id',
  case
    when rule->>'category' in ('members', 'fee_category', 'member_fee', 'family', 'general')
      then rule->>'category'
    else 'members'
  end,
  nullif(btrim(coalesce(
    (
      select string_agg(item, ', ')
      from jsonb_array_elements_text(
        case
          when jsonb_typeof(rule->'memberIds') = 'array' then rule->'memberIds'
          else '[]'::jsonb
        end
      ) as item
    ),
    rule->>'memberNumber',
    ''
  )), ''),
  nullif(rule->>'memberName', ''),
  nullif(btrim(coalesce(
    (
      select string_agg(item, ', ')
      from jsonb_array_elements_text(
        case
          when jsonb_typeof(rule->'feeCategories') = 'array' then rule->'feeCategories'
          else '[]'::jsonb
        end
      ) as item
    ),
    case when rule->>'category' = 'fee_category' then rule->>'appliedTo' else '' end,
    ''
  )), ''),
  nullif(rule->>'familyGroup', ''),
  coalesce(nullif(rule->>'description', ''), 'Descuento'),
  case when rule->>'valueType' = 'amount' then 'amount' else 'percent' end,
  coalesce((nullif(rule->>'value', ''))::numeric, 0),
  nullif(rule->>'validFrom', '')::date,
  nullif(rule->>'validTo', '')::date,
  coalesce((rule->>'isActive')::boolean, true),
  nullif(rule->>'accessinId', '')::integer,
  coalesce(nullif(rule->>'source', ''), 'lila')
from (
  select distinct on (meta->'rule'->>'id') meta->'rule' as rule
  from public.fixed_discounts
  where cadence = 'modifier'
    and coalesce(meta->'rule'->>'id', '') <> ''
  order by meta->'rule'->>'id', created_at desc
) sourced
on conflict (rule_key) do nothing;
