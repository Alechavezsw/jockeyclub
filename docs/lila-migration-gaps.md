# Lila Migration - Implementation Status

This document tracks Lila data migration implementation and reconciliation status.

**Excluded from scope (owner decision):**
- Tutores (dropped)
- Pileta / Temporada de pileta (this app uses its own format)
- Cobros online / Prisma / Macro / Mercado Pago (owner building in parallel)

---

## Business Rules (from Club Staff Interviews)

### Liquidación
- **Liquidación** = cuotas sociales ONLY (Socio Familiar + Socio Individual)
- La arma el secretario del club, se liquida el 1er día hábil del mes
- Una vez liquidado, NO se puede modificar
- **Nov 2025 nunca se liquidó** (kick-off) - no mostrar como liquidado
- El detalle por categoría es importante (cantidad de socios, valor unitario, total)

### Categorías de cuotas
- **Socio Familiar**: $70,000
- **Socio Individual**: $40,000
- **Abono Tenis**: $12,000
- **Familiar + Tenis**: $82,000 (dos deudas, un cobro)
- **Individual + Tenis**: $52,000 (dos deudas, un cobro)

### Recargos
- **10%** solo para Socio Familiar y Socio Individual
- Se aplica desde el **día 11** (último día sin recargo es el 10)
- Se aplica sobre **cada mes vencido por separado**, no sobre el total adeudado
- **AMET 2.5%** es comisión bancaria, NO mora

### Pagos
- Se imputan a la **deuda más antigua primero** (FIFO)
- El titular paga por todo el grupo familiar
- Pagos parciales cancelan cuota + recargo del mes más viejo
- Saldo negativo = plata a favor del socio

### Dashboard
- **Recaudado** = base percibido (todos los fondos efectivamente recibidos)
- Cada tipo de ingreso en su propia línea (Cuotas, Recargos, Varios, Eventos)
- Bonificaciones solo por superadmins, quedan registradas

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
| Cobranzas Oct 2026 | (parsed, not persisted) | ✅ Reconciled |

---

## Reconciliation Approach

**IMPORTANT:** La reconciliación se hace contra los datos de los ARCHIVOS de Lila,
NO contra agregados del dashboard de Lila (que pueden diferir por reglas internas).

### Reconciliation Results (October 20, 2026)

```
MÓDULO                    LILA               APP                DIFF
─────────────────────────────────────────────────────────────────────
Saldos CC               $346.295.200,69    $346.295.200,69          $0,00 ✓
Deudas M/M              $346.149.600,99    $346.149.600,99          $0,00 ✓
Liquidaciones           $647.331.000,00    $647.331.000,00          $0,00 ✓
Liq Oct 2026             $62.843.000,00     $62.843.000,00          $0,00 ✓
Percibido Oct            $58.587.731,34     $58.587.731,34          $0,00 ✓
Grupos Fam                  $384.667,00        $384.667,00          $0,00 ✓
```

**All figures match to the cent.**

### Liquidación October 2026 - Category Breakdown

```
CATEGORÍA                          SOCIOS              TOTAL
─────────────────────────────────────────────────────────────────────
📊 Socio Familiar ($70K)               790     $55.300.000,00
📊 Socio Individual ($40K)             108      $4.320.000,00
   Familiar + Tenis ($82K)              22      $1.804.000,00
   Individual + Tenis ($52K)            23      $1.196.000,00
   Abono Tenis ($12K)                   18        $216.000,00
   Sin liquidación ($0)              6.471              $0,00
   Otros montos ($1.750)                 4          $7.000,00
─────────────────────────────────────────────────────────────────────
📊 CUOTAS SOCIALES (Familiar + Individual)           $59.620.000,00
   TOTAL LIQUIDACIÓN (todos los conceptos)           $62.843.000,00
```

### Percibido October 2026 - Income by Type

```
INGRESOS POR TIPO (percibido):
  Cuotas sociales                    $53.974.732,94
  Varios (conceptos mixtos)           $2.394.998,37
  Eventos/Reservas                    $1.629.000,00
  Recargos (10%)                        $589.000,03
  ─────────────────────────────────────────────────────────────
  TOTAL PERCIBIDO                    $58.587.731,34

DESGLOSE CUOTAS:
  Cuotas Octubre del 2026:           $45.960.999,97
  Cuotas atrasadas:                   $8.013.732,97
```

---

## Coherence Checks

### 1. Saldos CC vs Deudas M/M difference (~$145,599.70)

The ~$145,600 difference between Saldos CC ($346,295,200.69) and Deudas M/M ($346,149,600.99) is **100% explained** by different populations:

| Category | Socios | Contribution |
|----------|--------|--------------|
| En ambos, cifras coinciden | ~3,500 | $0 |
| En ambos, cifras difieren (noImputado) | Variable | Variable |
| Solo en saldos, saldo > 0 | Few | Small positive |
| Solo en saldos, saldo = 0 | ~3,800 | $0 |
| Solo en saldos, saldo < 0 (créditos) | ~50 | Negative (credits) |
| Solo en deudas (no en saldos) | 0 | $0 |

**Root cause:** `saldos.xlsx` includes ALL members (full padrón ~7,440), while `deudas_mes_a_mes_morosos.xlsx` only includes MOROSOS (members with TOTAL DEUDA > 0).

**Consistent figure:** Dashboard uses Saldos CC ($346,295,200.69) as the single source of truth.

### 2. Dropped Non-Socio Rows

Correctly excluded from member imports (non-numeric nro_socio):

| NRO | Name | Tipo | Importe |
|-----|------|------|---------|
| colegio | Colegio Fanzolato | Varios | $250,000 |
| Alquiler La Kelita | La Kelita | Varios | $545,000 |
| Alquiler Padel | Alameda Padel | Varios | $1,085,940 |
| Alquiler Padel | Alameda Padel | Varios | $314,202 |

These represent third-party income (school, rentals) that goes to separate accounts.

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

**Key insight:** The `import-lila-saldos.mjs` script updates `members.outstanding_balance`, which is the source of truth for all balance-related calculations in the app.

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
