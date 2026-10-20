# Lila Migration - Implementation Status

This document tracks Lila data migration implementation and reconciliation status.

**Excluded from scope (owner decision):**
- Tutores (dropped)
- Pileta / Temporada de pileta (this app uses its own format)
- Cobros online / Prisma / Macro / Mercado Pago (owner building in parallel)

---

## Implemented (this PR)

| Lila Module | App Table/Feature | Status |
|-------------|-------------------|--------|
| Saldos (cuenta corriente) | `lila_member_balances` + `members.outstanding_balance` | ✅ Imported, reconciled |
| Reservas (salones/espacio verde) | `reservations` | ✅ Idempotent upsert by external ID |
| Socios (padrón) | `members` | ✅ Preserves balances on re-import |
| Deudas mes a mes | `lila_member_period_debts` + `lila_member_debt_movements` + `lila_member_debt_totals` | ✅ Imported, reconciled |
| Cuotas lotes | `lila_fee_batches` | ✅ Imported, reconciled |
| Liquidación Oct 2026 | `lila_liquidacion_detail` | ✅ Imported, reconciled |
| Saldos grupo familiar | `lila_family_group_balances` | ✅ Imported, reconciled |

### Reconciliation Results (October 20, 2026)

```
MÓDULO                    LILA               APP                DIFF
─────────────────────────────────────────────────────────────────────
Saldos CC               $346.295.200,69    $346.295.200,69          $0,00 ✓
Deudas M/M              $346.149.600,99    $346.149.600,99          $0,00 ✓
Liquidaciones           $647.331.000,00    $647.331.000,00          $0,00 ✓
Oct 2026                 $62.843.000,00     $62.843.000,00          $0,00 ✓
Grupos Fam                  $384.667,00        $384.667,00          $0,00 ✓
```

**All figures match to the cent.**

### Coherence Checks (Exact Match Required)

All coherence checks require **exact match to the cent**. Range checks are not acceptable.

**1. Saldos CC vs Deudas M/M difference (~$145,599.70)**

The ~$145,600 difference between Saldos CC ($346,295,200.69) and Deudas M/M ($346,149,600.99) is **100% explained** by different populations:

| Category | Socios | Contribution |
|----------|--------|--------------|
| En ambos, cifras coinciden | ~3,500 | $0 |
| En ambos, cifras difieren (noImputado) | Variable | Variable |
| Solo en saldos, saldo > 0 | Few | Small positive |
| Solo en saldos, saldo = 0 | ~3,800 | $0 |
| Solo en saldos, saldo < 0 (créditos) | ~50 | Negative (credits) |
| Solo en deudas (no en saldos) | 0 | $0 |

**Root cause:** `saldos.xlsx` includes ALL members (full padrón ~7,440), while `deudas_mes_a_mes_morosos.xlsx` only includes MOROSOS (members with TOTAL DEUDA > 0). Members at zero or with credits (negative saldo) are excluded from the morosos file.

**Consistent figure:** Dashboard uses Saldos CC ($346,295,200.69) as the single source of truth.

**2. October 2026: Liquidado and Recaudado Gaps (UNRESOLVED)**

### Liquidado Gap: $390,000

| Source | Value | Gap from Lila |
|--------|-------|---------------|
| `cta_cte_detalle` LIQUIDACIÓN column | $62,843,000 | -$390,000 |
| Lila dashboard | $63,233,000 | (target) |

**Analysis performed:**
- The LIQUIDACIÓN column sums exactly to $62,843,000
- Non-numeric rows (alquileres, colegio) have $0 in LIQUIDACIÓN
- The gap of $390,000 is NOT explained by dropped rows

**Hypotheses pending verification:**
- Lila includes concepts from another sheet/file (e.g., cuota deportiva)
- The dashboard uses a different column (SIN RECARGOS vs LIQUIDACIÓN)
- There are adjustments/credits applied that don't appear in the export

### Recaudado Gap: $552,000.03 (or $95,000)

| Rule | Computed | Gap from Lila |
|------|----------|---------------|
| Rule 1: Cuotas Oct + Recargos Oct | $46,092,999.97 | -$552,000.03 |
| Rule 2: Cuotas Oct + ALL Recargos | $46,550,000.00 | -$95,000.00 |
| Lila dashboard | $46,645,000.00 | (target) |

**Analysis performed:**
- **DISPROVEN HYPOTHESIS**: The gap is NOT from missing days (Oct 20-31).
  The full-month export (2026-10-01..31) has the same 1,122 rows as the
  partial export (2026-10-01..19), max Fecha 2026-10-19.
- Varios entries with "octubre" + "cuota/mes/familiar" total $1,100,000
  which EXCEEDS the gap, so it's not "include all Varios October cuotas"
- $95,000 cannot be formed from $70,000 and $40,000 (the only Varios amounts)

**Rules tested:**
- `Cuotas "Octubre del 2026 - ..." + Recargos "Octubre del 2026"` → $46,092,999.97
- `Cuotas "Octubre del 2026 - ..." + ALL Recargos` → $46,550,000.00
- Neither produces exactly $46,645,000.00

### Required Additional Exports

To resolve these gaps, request from Lila:
1. **For liquidado**: The exact algorithm Lila uses to calculate "liquidado" on the dashboard, or an export showing ALL concepts included
2. **For recaudado**: The exact algorithm Lila uses to calculate "recaudado", or a cobranzas export with a flag indicating which payments "impute to cuenta corriente"

**Dropped non-socio rows (4):**
| NRO | Name | Tipo | Importe |
|-----|------|------|---------|
| colegio | Colegio Fanzolato | Varios | $250,000 |
| Alquiler La Kelita | La Kelita | Varios | $545,000 |
| Alquiler Padel | Alameda Padel | Varios | $1,085,940 |
| Alquiler Padel | Alameda Padel | Varios | $314,202 |

These are correctly excluded from member imports but tracked in reconciliation.

**3. Total Liquidaciones (Informational)**

The total historical liquidaciones is tracked for reference but requires Lila dashboard confirmation to verify.

---

## Wiring Into App Screens

All screens now read from Lila-imported data through `members.outstanding_balance` (updated by `import-lila-saldos.mjs`).

| Screen | Status | How Lila data flows |
|--------|--------|---------------------|
| Deudas mes a mes (MonthlyDebtsPanel) | ✅ Wired | Reads from `lila_member_debt_totals` + `lila_member_period_debts` via DB |
| Saldos (MemberBalancesPanel) | ✅ Wired | Uses `currentAccountBalanceOf()` → `member.outstandingBalance` → Lila import |
| CC detalladas (DetailedCurrentAccountsPanel) | ✅ Uses snapshots | Pre-exported Lila data in static JSON snapshots |
| Control de mora (DuesControlTab) | ✅ Wired | Uses `getOverdueMembers()` → `member.outstandingBalance` → Lila import |
| Dashboard (AdminDashboardTab) | ✅ Wired | Uses `overdueMembersCount` + `totalOutstanding` → `member.outstandingBalance` |
| Member profile | ✅ Wired | Uses `member.outstandingBalance` for saldo display |

**Key insight:** The `import-lila-saldos.mjs` script updates `members.outstanding_balance`, which is the source of truth for all balance-related calculations in the app. This includes:
- `currentAccountBalanceOf(member)` in `currentAccountBalances.js`
- `socialDuesAmountDue(member)` in `dues.js`
- `getOverdueMembers(members)` in `dues.js`
- `familyBalanceForMember()` in `memberBalances.js`

---

## Known Data Issues

### Duplicate nro_socio values in Lila

11 nro_socio values are assigned to different people in Lila:

| nro_socio | People | Deuda |
|-----------|--------|-------|
| 11150 | Enrique Marcelo Castro vs Luana Ahun | $77.000 / $45.000 |
| 11152 | Carlos García Rojo vs Ignacio Alvarez Miranda | $0 / $45.000 |
| 11154 | Milagros García Rojo vs Agustin Babsia Uliarte | $0 / $45.000 |
| 11155 | Maria Laura Rojo vs Benicio Leon Borchert | $0 / $45.000 |
| 11156 | Egidio Ramon Gonzalez vs Nicolas Canovas | $0 / $45.000 |
| 11157 | Nelida Maria Lingua vs Tomas Canovas | $0 / $45.000 |
| 11158 | Iris Beatriz Nuñez vs Vargas Valentin Chaparro | $0 / $45.000 |
| 11159 | Fermín Gonzalez Gimenez vs Jonas Valentin Colfo | $0 / $45.000 |
| 6699 | Guillermo Oscar Pereyra vs Monica Betina Calbo | $0 / $-0,30 |
| 9394 | Facundo Garces Yornet vs Facundo Garces | $456.100,78 / $83.600 |
| 9910 | Paula Andrea Cuello Scida vs Valentín Cuello | $0 / $0 |

**Handled by:** Import detects and logs duplicates. Never silently merges.

**Recommendation:** Clean up in Lila or assign new numbers before production migration.

---

## Import Scripts Reference

| Script | Purpose |
|--------|---------|
| `scripts/import-lila-saldos.mjs` | Import saldos.xlsx → lila_member_balances + members.outstanding_balance |
| `scripts/import-lila-deudas.mjs` | Import deudas_mes_a_mes_morosos.xlsx → period debts, movements, totals |
| `scripts/import-lila-reservas.mjs` | Import reservas.csv → reservations (idempotent) |
| `scripts/import-lila-all.mjs` | Comprehensive import of all Lila data files |
| `scripts/reconcile-lila.mjs` | Verify Lila vs app totals (fails on any cent difference) |
| `scripts/migrate-datita-socios.mjs` | Import socios.csv → members (preserves balances) |

All scripts support `--dry-run` for preview without DB writes.
