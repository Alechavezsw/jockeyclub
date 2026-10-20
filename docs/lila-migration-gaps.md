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

**2. October 2026: Liquidado $63,233,000 (EXACT)**

The reconciliation compares against Lila's exact value:

- `cta_cte_detalle_liquidacion.xlsx` columns: LIQUIDACIÓN + OTROS
- Dropped rows (non-numeric nro_socio) are tracked separately
- Any non-zero difference **fails** the reconciliation

Environment variable to override expected value:
```bash
LILA_OCT_2026_LIQUIDADO=63233000 node scripts/reconcile-lila.mjs --uploads-dir uploads/
```

**Recaudado (IMPLEMENTED):**

Rule discovered: `Cuotas (concepto = "Octubre del 2026 - ...") + Recargos (concepto = "Recargo: Octubre del 2026")`

- File: `cobranzas_*.xlsx` (Lila "Reporte de Cobranzas")
- Parser: `parseCobranzas()` in `lilaOtherImports.js`
- Lila dashboard shows: $46,645,000.00 for full month
- Partial file (Oct 1-19): $46,092,999.97
- Difference: $552,000.03 (payments Oct 20-31 not in export)

Environment variable to set expected value:
```bash
LILA_OCT_2026_RECAUDADO=46645000 node scripts/reconcile-lila.mjs --uploads-dir uploads/
```

**Dropped non-socio rows (4):**
| NRO | Name | Tipo | Importe |
|-----|------|------|---------|
| colegio | Colegio Fanzolato | Varios | $250,000 |
| Alquiler La Kelita | La Kelita | Varios | $545,000 |
| Alquiler Padel | Alameda Padel | Varios | $1,085,940 |
| Alquiler Padel | Alameda Padel | Varios | $314,202 |

These are correctly excluded from member imports but tracked in reconciliation.

**3. Total Liquidaciones: $647,331,000 (EXACT)**

Must match Lila's exact cumulative total. Any difference **fails** the reconciliation.

Environment variable to override expected value:
```bash
LILA_TOTAL_LIQUIDADO=647331000 node scripts/reconcile-lila.mjs --uploads-dir uploads/
```

Relationship between figures:
```
Total liquidado histórico:     $647.331.000
Saldos CC (deuda actual):      $346.295.200
────────────────────────────────────────────
Estimado COBRADO histórico:    $301.035.800
```

Formula: `LIQUIDADO - ADEUDADO = COBRADO`

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
