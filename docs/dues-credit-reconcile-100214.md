# Conciliación saldos a favor / imputación — 100214 y padrón

**Fecha:** 2026-11-20  
**Estado:** caso 100214 corregido en DB; lógica de cobro parchada; **sin merge** hasta verificación humana.

## Causa raíz

1. La ficha (`outstanding_balance`) de Daiana (100214) tenía **$135.000** de capital para octubre+noviembre, mientras la tarifa es **2 × $70.000 = $140.000**.
2. El modal/recibo ofrecía **$154.000** (capital + 10 %).
3. `registrar_cobro` imputaba contra `member_dues_periods` encogidos a la ficha → noviembre **$65.000 + $6.500**.
4. El efectivo sobrante (**$5.500**) se grabó como **`adelanto`**, dejando `outstanding_balance = -5500`.
5. El asiento 356 ya acreditaba **$154.000** a Cuotas Sociales (correcto). La diferencia era solo de imputación/ficha.

**Regla rota:** una brecha ficha &lt; tarifa se convertía automáticamente en saldo a favor.

## Corrección 100214

| Campo | Antes | Después |
|---|---:|---:|
| Imputación nov capital | 65.000 | 70.000 |
| Imputación nov recargo | 6.500 | 7.000 |
| Entry `adelanto` | −5.500 | eliminado |
| `outstanding_balance` | −5.500 | **0** |
| `duesOpenPeriods` | oct/nov abiertos | limpiados |
| `next_due_date` | 10/12/2026 | 10/12/2026 (sin liquidar diciembre) |
| Asiento 356 | $154.000 | intacto |

Migración: `20261120230000_reconcile_100214_fictitious_credit.sql` (aplicada).

## Prevención

- JS `payMemberDues`: con meses marcados, la obligación es la **tarifa**, no el tope de ficha; no inventa `creditLeftover` por esa brecha.
- `cobroSchedule`: schedule a capital de tarifa de los meses elegidos.
- `choicesFromStoredOpenPeriods`: usa tarifa entera salvo parcial real (&lt; 95 %).
- SQL `registrar_cobro`: expande `capital_open` al schedule; `v_payable` usa max(ficha, schedule); clamp `v_should ≥ 0`; limpia `duesOpenPeriods` al saldar.
- Auditoría: `negative_balance_review` en `duesBalanceAudit.js`.

## Otros socios con saldo negativo + entry adelanto (solo lectura)

No se modifican automáticamente. Revisar uno a uno si el adelanto es voluntario o ficticio.

| Nº | Nombre | Saldo | Adelanto |
|---|---|---:|---:|
| 101202 | Franco Leonel Gaitan | −88.000 | −88.000 |
| 101046 | Martin Maximiliano Casas | −77.000 | −77.000 |
| 101612 | Maria Florencia García Amor | −70.000 | −70.000 |
| 111621 | Sol Mariel Gómez lavado | −33.000 | −33.000 |
| 111649 | GARCIA JOSE ANDRES | −33.000 | −33.000 |
| 111628 | GRIMAL LA CRUZ GABRIEL AGUSTIN | −33.000 | −33.000 |
| 10470 | Maria Lina Mereles Cavazzini | −19.800 | −19.800 |
| 9393 | Maria Victoria Becerra | −19.800 | −19.800 |
| 11356 | Maria Celia Ferrer | −13.200 | −13.200 |
| 10508 | Gaston Ruben Puebla Macias | −11.000 | −11.000 |
| 13029 | Gimena Morales | −7.700 | −7.700 |
| 11685 / 10795 / 10018 | (varios) | −4.400 | −4.400 |
| 10389 / 2479 / 11943 | (varios) | −2.200 | −2.200 |
| 9928 | Jorge German Trincado | −900 | −900 |

## Criterio de aceptación

- 100214: cubierta hasta noviembre, saldo 0, sin crédito, diciembre no cobrable aún.
- Cobro marcado de N meses a tarifa + mora no genera adelanto si el efectivo = obligación.
- Tests en `duesCreditReconcile.test.js` en verde.
