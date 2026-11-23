/**
 * Verificación aislada (solo lectura) de anclas de
 * 20261123013000_fix_advance_credit_no_double_count.sql vs prod.
 * No aplica migraciones ni muta saldos.
 *
 * Uso: node scripts/_verify-advance-mig-anchors.mjs
 * (o pegar el SQL de comparación vía MCP execute_sql)
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const migPath = join(
  root,
  'supabase/migrations/20261123013000_fix_advance_credit_no_double_count.sql',
);
const sql = readFileSync(migPath, 'utf8');

const checks = [
  {
    name: 'marcador v2 presente en migración',
    ok: sql.includes('allocate_advance_cash_chunks_v2'),
  },
  {
    name: 'WHILE acotado a 24',
    ok: /v_advance_loops < 24/.test(sql),
  },
  {
    name: 'helper cobro_social_advance_tariff',
    ok: sql.includes('create or replace function public.cobro_social_advance_tariff'),
  },
  {
    name: 'salta períodos ya cubiertos',
    ok: sql.includes('if v_advance_take + 0.01 >= v_tariff then'),
  },
  {
    name: 'no re-aplica ajustes históricos 20261122',
    ok: !/audit:advance-future-double-credit:20261122/.test(sql)
      && !/nota_ajuste_cuota/.test(sql),
  },
  {
    name: 'ancla v_old coincide con prod post-20261123002137',
    ok: sql.includes('Si se imputó el anticipo a un período, no registrar un segundo crédito libre.')
      && sql.includes('if v_advance_due > public.cobro_current_month_due(v_today) then'),
  },
  {
    name: 'descuento no infla sobrante',
    ok: sql.includes('Un descuento administrativo no es efectivo ni puede generar saldo a favor.'),
  },
  {
    name: 'adelanto sin surcharge',
    ok: /v_advance_take, 0, 0, 0, 0, 'adelanto'/.test(sql),
  },
];

let failed = 0;
for (const row of checks) {
  const mark = row.ok ? 'OK' : 'FAIL';
  if (!row.ok) failed += 1;
  console.log(`${mark}  ${row.name}`);
}

console.log('');
console.log('Prod (MCP, solo lectura):');
console.log('  - 20261123002137 aplicada (histórico reconciliado)');
console.log('  - 20261123013000 NO aplicada');
console.log('  - registrar_cobro aún sin allocate_advance_cash_chunks_v2');
console.log('  - bloque adelanto prod = ancla v_old de esta migración');
console.log('');
process.exit(failed ? 1 : 0);
