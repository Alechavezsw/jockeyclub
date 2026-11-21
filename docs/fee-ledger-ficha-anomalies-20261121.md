# Fee ledger vs ficha — candidatos (2026-11-21)

Reporte **solo lectura**. No se mutaron saldos ni se cerró pending masivo.

## Baseline

| Métrica | Valor |
|--------|------:|
| Socios activos con ficha ≤ $0 y `fee_ledger_lines.pending` > 0 | **645** |
| Pending contable agregado | **$ 43.039.067** |
| Líneas con `source` liquidación (en el set) | 645 socios |
| Con pago verificable mismo mes (aprox.) | 36 |
| Sin pago verificable mismo mes (aprox.) | 609 |

Fuente: consulta directa a `members` + `fee_ledger_lines` (proyecto `papdsxgcvyncdxdvbdaa`).

## Causas probables (PASO 1)

Corte vía `member_financial_integrity_v1` (`ficha_zero_ledger_pending`):

| Causa probable | Filas |
|----------------|------:|
| `ficha_cero_con_ledger_pendiente` | 387 |
| `liquidacion_o_import_sin_cerrar_ledger` | 287 |
| Miembros abiertos (excl. Natalia) | 645 |
| Filas abiertas | 674 |

1. **Liquidación post-pago / sin cerrar ledger** — la liquidación abre `pending` aunque la ficha ya estaba al día (`post_fee_ledger_lines` histórico no chequeaba cobertura).
2. **Cobro sin meses en payload** — `registrar_cobro` bajaba ficha pero no siempre alimentaba el loop de cierre de `fee_ledger_lines`.
3. **Import / sync de ficha a $0** — deja el libro contable abierto sin obligación operativa.

Tras la migración `20261121120000_fee_ledger_ficha_integrity` + correctivo `20261121153000_fee_ledger_ficha_integrity_fixes`:

- Detector: `member_financial_integrity_v1` (distingue admin / Lila evidencia pendiente vs deuda)
- Conciliación admin (sin inventar pago ni fecha de cobro): `admin_reconcile_fee_ledger_period`
- Liquidación ya no reabre períodos cubiertos
- Cierre contable único: loop de `registrar_cobro` (sin trigger duplicado en imputaciones)
- `apply_fee_ledger_collection_for_months` sin EXECUTE para `authenticated`

## Comprobante verificable

- **Con** pago/`periodDueOns` alineado al mes: minoría (~36 en el corte).
- **Sin** comprobante local del mismo mes: mayoría (~609) → candidatos a **conciliación administrativa** (PASO 2 / intervención manual), no a cobro automático.

## Natalia Gahona 100827 (excluida de abiertos)

| Campo | Valor |
|-------|--------|
| Ficha | $0 |
| `next_due_date` | 2026-12-10 |
| `duesCoveredThrough` | 2026-11 |
| Octubre ledger | `pending=0`, `collected=70000` |
| Noviembre ledger | `pending=0`, `collected=70000` |
| Meta | `october2026LedgerStatus = conciliado administrativamente…` |
| Flag abierto `ficha_zero_ledger_pending` | **no** |

Caso de referencia: ya conciliado; no forma parte del backlog de intervención.

## Pendientes de intervención admin

Los **645** socios del baseline siguen con pending contable abierto (salvo los que se cierren con cobros reales o `admin_reconcile_fee_ledger_period` caso a caso). **PASO 1 no los toca.**

## Criterio operativo

- Fuente de deuda exigible: **ficha** + períodos / imputaciones / cobros.
- Nunca cobrar automáticamente un pending de ledger si la ficha está en $0.
- Estados: `pagado` · `pendiente` · `conciliado_administrativamente` · `en_revision`.
