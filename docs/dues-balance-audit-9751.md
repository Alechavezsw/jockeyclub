# Auditoría saldos / crédito — caso 9751 y corrección general

Fecha: 2026-11-20  
Rama: `fix/dues-credit-source-of-truth`

## Diagnóstico — socio 9751 Jorge Maximilia Calderón Luna

| Fuente | Valor |
|---|---|
| `outstanding_balance` | $ 7.000 |
| `meta.unpaidCapital` (antes) | $ 70.000 |
| `next_due_date` | 2026-12-10 |
| `member_dues_entries` | opening +77.000 (2026-11-03) + payment −70.000 (pago 2026-11-01) |
| `member_payments` | $ 70.000 **débito** (import LILA; estaba mal como transferencia), cpr **03656347**, período octubre 2026 |
| `member_dues_periods` / `dues_imputations` | vacíos |

**Reconstrucción**

1. Apertura 03/11: $ 77.000 (= capital $ 70.000 + 10 % $ 7.000 embebido en el corte).
2. Pago 01/11 importado: $ 70.000 capital de octubre por **débito** (el débito no cobra el 10 %; `surcharge: 0` en meta). El import lo guardó mal como `transferencia`; corregido a `debito`.
3. Tras el débito, la ficha **no debe** quedar en $ 7.000: el débito no genera mora. Se cargó un ajuste auditado −$ 7.000 y `outstanding_balance` / `unpaidCapital` = **0**.
4. `unpaidCapital` había quedado en $ 70.000 (stale) y podía mostrar “noviembre $ 70.000”.
5. `collectionPreview` trataba `unpaid − outstanding = $ 63.000` como **crédito absorbido** → crédito ficticio (corregido en código).

Regla: cobro por débito que cubre el capital de los meses abiertos **no deja** el 10 % embebido en la apertura.

`next_due_date` 10/12 indica próximo vencimiento de quien ya pasó noviembre en ficha; **no** es deuda de diciembre.

## Causa raíz (sistema)

En `collectionPreview`, la variable `absorbed` convertía cualquier desync `unpaidCapital > outstandingBalance` en saldo a favor imputable. No había ledger de créditos: solo outstanding negativo (real) o ese hueco inventado.

## Corrección general

1. Eliminado el crédito absorbido por desync.
2. Crédito válido = `outstandingBalance < 0` o `creditBalance` explícito (acarreo al liquidar).
3. `socialDuesStoredBalance` no infla la deuda con unpaid stale.
4. `capitalOwedForChoices` distingue lift de tarifa (hueco chico) vs desync grave (hueco ≥ media cuota → manda ficha).
5. Vista SQL `dues_balance_anomalies` + helpers JS `duesBalanceDesync` / `detectMemberDuesAnomalies`.
6. Liquidación (`applyFeeChargeDeltasToMembers`) acarrea crédito en `creditBalance` sin usar unpaid−outstanding.

## Caso 9751 — corrección de datos

- **No** se modifica `outstanding_balance` ($ 7.000 respaldado por entries).
- Alinear `meta.unpaidCapital` → $ 7.000 con nota de conciliación (requiere aprobación admin en producción).
- No se borran pagos ni asientos.

## Anomalías detectadas (muestra)

Vista `public.dues_balance_anomalies`. Casos similares a 9751 (`unpaid_above_outstanding` alto): 10639, 9394, 8740, 9751, etc. Quedan para revisión administrativa; **no** se auto-corrigen importes.

## Pruebas

```bash
npm test -- --run src/domain/members/memberPayments.test.js \
  src/domain/members/dues.test.js \
  src/domain/members/duesBalanceAudit.test.js
```

Cubre: 9751 sin crédito ficticio, crédito real, no doble uso, liquidación con `creditBalance`, alerta de desync.
