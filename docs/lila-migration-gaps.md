# Lila Migration Gap Analysis

This document lists Lila modules/data that are **not yet mapped** to this app's data model.

**Excluded from scope (owner decision):**
- Tutores (dropped)
- Pileta / Temporada de pileta (this app uses its own format)
- Cobros online / Prisma / Macro / Mercado Pago (owner building in parallel)

---

## Implemented (this PR)

| Lila Module | App Table/Feature | Notes |
|-------------|-------------------|-------|
| Saldos (cuenta corriente) | `lila_member_balances` + `members.outstanding_balance` | Per-socio: capital, recargos, intereses, saldo no imputado, saldo resultante |
| Reservas (salones/espacio verde) | `reservations` | Idempotent by external ID; upsert on re-import |
| Socios (padrón) | `members` | Already implemented; now preserves balances on re-import |

---

## Remaining Gaps (future work)

### 1. Deudas mes a mes (period-level debt)

**Lila export:** `deudas_mes_a_mes_morosos.xlsx` with sheets:
- DEUDA POR MES: per-period per-socio breakdown
- DEUDA POR SOCIO: movement-level detail (tipo, descripción, fecha, monto)
- TOTALES: summary per socio

**Current state:** Not imported. The app has `group_accounts` / `group_account_lines` for family group ledgers, but no per-period individual debt tracking.

**Proposal:** Create `member_period_debts` table to track period-by-period debt (Enero 2026, Febrero 2026, etc.) for mora tracking and historical queries.

### 2. Cuotas lotes (monthly fee batches)

**Lila export:** `cuotas_lotes.csv` - fee liquidation batches with period, monto, fecha_generacion, estado.

**Current state:** The app has `fee_period_closures` for period closes but doesn't import Lila's historical liquidación batches.

**Proposal:** Import as reference data or reconcile with existing `fee_period_closures`.

### 3. Saldos grupo familiar (family group balances)

**Lila export:** `saldos_grupo_familiar.xlsx` - per-family-group per-period balances.

**Current state:** `group_accounts` exists but is populated via browser script (`ingest-lila-ledgers.mjs`), not xlsx import.

**Proposal:** Add xlsx import path for family group balances if needed.

### 4. Cta Cte detalle cuotas liquidación

**Lila export:** `cta_cte_detalle_cuotas_liquidacion.xlsx` - October 2026 liquidación breakdown per socio.

**Current state:** Not imported.

**Proposal:** Could be used to verify liquidación totals match after import.

---

## Known Data Issues

### Duplicate nro_socio values in Lila

11 nro_socio values are assigned to different people in Lila:
- 11150, 11152, 11154-11159: different people sharing same number
- 6699, 9394, 9910: same person duplicated OR different people

**Handled by:** Import takes the entry with non-zero balance; flags duplicates in import log.

**Recommendation:** Clean up in Lila or assign new numbers before final migration.

---

## Import Scripts Reference

| Script | Purpose |
|--------|---------|
| `scripts/import-lila-saldos.mjs` | Import saldos.xlsx → lila_member_balances + members.outstanding_balance |
| `scripts/import-lila-reservas.mjs` | Import reservas.csv → reservations (idempotent) |
| `scripts/migrate-datita-socios.mjs` | Import socios.csv → members (preserves balances) |

All scripts support `--dry-run` for preview without DB writes.
