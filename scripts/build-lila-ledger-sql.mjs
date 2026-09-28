/**
 * Arma SQL de carga a partir de scripts/_lila_ledgers/batch-*.json.
 * Uso: node scripts/build-lila-ledger-sql.mjs
 * Escribe scripts/_lila_ledgers/sql/part-NNNN.sql
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = resolve(dirname(fileURLToPath(import.meta.url)), '_lila_ledgers');
const outDir = resolve(dir, 'sql');
mkdirSync(outDir, { recursive: true });

function dollarQuote(json) {
  let tag = 'jclila';
  while (json.includes(`$${tag}$`)) tag += 'x';
  return `$${tag}$${json}$${tag}$`;
}

function toSql(accounts) {
  const payload = JSON.stringify(accounts);
  return `with incoming as (
  select * from jsonb_to_recordset(${dollarQuote(payload)}::jsonb) as x(
    id text, nro text, opening jsonb, closing jsonb, lines jsonb
  )
), upserted as (
  insert into public.group_accounts (
    lila_group_id, titular_number, opening_on, opening_balance, closing_on, closing_balance
  )
  select x.id, x.nro,
    nullif(x.opening->>'on', '')::date,
    coalesce((x.opening->>'amount')::numeric, 0),
    nullif(x.closing->>'on', '')::date,
    coalesce((x.closing->>'amount')::numeric, 0)
  from incoming x
  on conflict (lila_group_id) do update set
    titular_number = excluded.titular_number,
    opening_on = excluded.opening_on,
    opening_balance = excluded.opening_balance,
    closing_on = excluded.closing_on,
    closing_balance = excluded.closing_balance,
    loaded_at = now()
  returning id, lila_group_id
)
insert into public.group_account_lines (
  group_account_id, lila_line_id, member_number, member_name, line_date, type_label, description, amount
)
select u.id, e->>0, e->>1, e->>2, (e->>3)::date, e->>4, coalesce(e->>5, ''), coalesce((e->>6)::numeric, 0)
from upserted u
join incoming i on i.id = u.lila_group_id
cross join lateral jsonb_array_elements(i.lines) e
on conflict (group_account_id, lila_line_id) do update set
  member_number = excluded.member_number,
  member_name = excluded.member_name,
  line_date = excluded.line_date,
  type_label = excluded.type_label,
  description = excluded.description,
  amount = excluded.amount;
`;
}

const files = readdirSync(dir).filter((name) => /^batch-\d+\.json$/.test(name)).sort();
let parts = 0;
let accounts = 0;
for (const name of files) {
  const body = JSON.parse(readFileSync(resolve(dir, name), 'utf8'));
  const list = body.accounts || [];
  if (!list.length) continue;
  const part = name.replace('batch-', 'part-').replace('.json', '.sql');
  const target = resolve(outDir, part);
  if (!existsSync(target)) writeFileSync(target, toSql(list));
  parts += 1;
  accounts += list.length;
}
console.log(JSON.stringify({ parts, accounts }));
