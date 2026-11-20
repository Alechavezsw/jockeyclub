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
| `member_payments` | $ 70.000 transferencia, cpr **03656347**, período octubre 2026 |
| `member_dues_periods` / `dues_imputations` | vacíos |

**Reconstrucción**

1. Apertura 03/11: $ 77.000 (= capital $ 70.000 + 10 % $ 7.000 embebido en el corte).
2. Pago 01/11 importado: $ 70.000 capital de octubre (sin mora).
3. Remanente real en ficha: **$ 7.000** (entries netean exactamente).
4. `unpaidCapital` quedó en $ 70.000 (stale) → la UI de libro podía mostrar “noviembre $ 70.000”.
5. `collectionPreview` trataba `unpaid − outstanding = $ 63.000` como **crédito absorbido** → crédito ficticio.

Los $ 7.000 **no** son un crédito ni un mes de noviembre: son el remanente de la apertura tras el pago de capital de octubre.

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
