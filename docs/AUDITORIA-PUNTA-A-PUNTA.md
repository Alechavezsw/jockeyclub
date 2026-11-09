# Auditoría punta a punta — Jockey Club ERP

Fecha: 9 nov 2026. Auditoría + fixes aplicados el mismo día (C1–C2, H1–H10, M2/M3 parcial).

Orden: severidad (impacto en plata, puerta o comprobante). Al final: qué está OK y fixes sugeridos (no implementados).

---

## Críticos

| ID | Área | Hallazgo | Evidencia |
|----|------|----------|-----------|
| C1 | MP / cuota | **Doble cobro tras QR de Mercado Pago** en mostrador y Control. `CollectDuesModal` manda `alreadyApplied: true`; MembersTab y MemberProfilePanel lo respetan; **CollectDuesDeskFlow y DuesControlTab no** → vuelven a `recordDuesCollection` + `persistDuesCollection` + recibo. | `CollectDuesDeskFlow.jsx` ~165–178; `DuesControlTab.jsx` ~244–257; contraste `MembersTab.jsx` ~929 |
| C2 | Fee periods | **Doble imputación de saldo** si el cliente “promueve” un pending que el cron ya pasó a processed. `persistFeePeriod` traga el error «procesada no se modifica» y **igual** llama `applyMemberBalanceDeltas` (aditivo). | `useErpStore.js` ~1401, ~1577–1624; cron `auto-fee-liquidation` sí usa lock `status=pending` |

---

## Altos

| ID | Área | Hallazgo | Evidencia |
|----|------|----------|-----------|
| H1 | Acceso | Búsqueda manual remota admite con **saldo 0 inventado**: `search_members_lookup` no trae balance/titular; `admitMember` → `seasonDuesGate` casi nunca bloquea. | `AccessControlView.jsx` ~968–1030; RPC lookup; contraste pileta que hace `getMemberByNumber` |
| H2 | Acceso | `unknown_member` del verificador **no se maneja**: solo `unreachable` / `invalid`. Si el socio está en `members[]`, se admite **sin firma válida**. | `credentialCheck.js` ~78; `AccessControlView.jsx` ~340–410 |
| H3 | Acceso | Adherente sin titular en `members[]`: `accountHolderOf` cae al propio adherente → mora del titular **no aplica**. | `seasonDuesGate.js` ~19–24 |
| H4 | Saldo/mora | Gates de puerta/pileta leen solo `outstandingBalance`; admin usa `socialDuesStoredBalance` (`unpaidCapital` LILA preferido). Columna stale vs meta → **falso positivo/negativo de mora**. | `dues.js` `socialDuesStoredBalance`; `seasonDuesGate.js` ~46–57, ~91–97 |
| H5 | Fee periods | Clave sticky de promote + sin tick a medianoche: failover del día 2 en SPA larga **no corre**; depende solo del cron. | `useErpStore.js` `feePromoteRef` / `ensurePromotePendingFeePeriods` |
| H6 | Fee periods | Fallo de `listFeePeriodClosures` deja seed Accessin + auto del día 1 puede **persistir borrador inventado**. | `useErpStore.js` hydrate catch; `AdminView` auto |
| H7 | MP / recibos | Caja `autoSendCashPaymentReceipts` puede **reenviar mail** de cuotas/MP ya enviados (`deliverPaymentReceipt` / `deliverMpReceipt`): claves distintas. | Caja ledger + `cash_payment_receipts_sent` vs `receipt_email_id` |
| H8 | MP / reservas | Reserva MP: webhook acredita diario pero **no crea la reserva**; si el socio cierra antes del `onApproved` UI → plata sin turno. Admin además puede **doble recibo** (webhook + UI). | `apply_mp_approved_payment` booking = journal only; `AdminNewReservationDialog` |
| H9 | Settings | Portal **socio nunca hidrata** `dues`/`club`/`pool`/`system`/`paymentPlans` desde `app_settings`. Toda la sesión en defaults (CC visible, avisos, etc.). | `bootstrapMemberDeferredFromDb` ~174–205 |
| H10 | Settings | `facility_catalog` **nunca se lee** del bootstrap; solo se escribe. Tras reload, catálogo custom de DB no aplica. | `bootstrap.js`; `App.jsx` init |

---

## Medios

| ID | Área | Hallazgo |
|----|------|----------|
| M1 | Mora | `isPiletaMora` bloquea con **cualquier** saldo > 0 todo el año; sede solo temporada + desde el 10. Asimetría (tests la fijan); confirmar si es norma de negocio. |
| M2 | Exentos | JS `isDuesExemptMember` = AND de tiers; Postgres `member_is_dues_exempt` = OR. Fichas mixtas (comisión + familiar) divergen liquidación vs saldo. |
| M3 | CC | `memberPaidFeePeriod` por `lastPaymentDate` mes ≥ período puede marcar pagado con cobro parcial/otro concepto. |
| M4 | Acceso | Offline + verify en caché + `getMemberByNumber` falla → “no empadronado” falso (no cartel amarillo). |
| M5 | Acceso | Pase invitado OK pero host offline → DENEGADO en vez de sin verificar; `member_id` UUID a menudo null en logs remotos. |
| M6 | Fee periods | Día 1: cliente puede **pisar pack pending** del cron (pending→pending permitido). Tarifas duplicadas cron vs `tiers.js`. |
| M7 | Recibos | `deliverMpReceipt` check-then-act sin lock → posible doble MD; helpers de recibo manual sin flag durable. |
| M8 | Settings | Ops “ready” con defaults hasta deferred (pileta fees, dues rules). Soft timeout → defaults permanentes y silenciosos. Disciplines/RSVP pueden nacer de LS antes de `clearStale`. |

---

## OK (confirmado)

- Cloud **no** escribe padrón/cuotas/fee periods/settings de negocio a `localStorage` (efectos gated; `jockey-fee-periods-v2` solo offline).
- Liquidación / deltas / `registrar_cobro`: el **10 % no entra al saldo** en el camino principal; se calcula al cobrar.
- Exentos puros (vitalicio/fundador/comisión): sin mora inventada en gates; liquidación los salta.
- MP webhook: `FOR UPDATE` + `applied_at` + unique `provider_payment_id` — reintentos no re-aplican saldo.
- MembersTab / MemberProfilePanel / pileta MP UI: no re-aplican tras QR.
- Acceso: QR sin firma desde cámara rechazado; outbox de lecturas es cola de dispositivo, no segunda verdad; libro cloud en `access_logs`.
- `clearStaleBusinessLocalCache` limpia `jockey-*` de negocio al montar ERP store.
- Cron `auto-fee-liquidation` con promote condicionado a `status=pending`.

---

## Fixes sugeridos (prioridad; no implementados)

1. **C1** — En Desk y Control: `if (payload?.alreadyApplied) { refresh; return; }` igual que MembersTab/Profile.
2. **C2** — Tras error «procesada», **no** llamar deltas; o RPC promote atómico con lock; o solo cron promove.
3. **H1–H3** — Antes de `admitMember`: siempre `getMemberByNumber` (o ficha completa); resolver titular remoto; tratar `unknown_member` como deny.
4. **H4** — Gates con `socialDuesStoredBalance` (misma fuente que admin).
5. **H7–H8** — Unificar claves de recibo; skip auto-caja si ya hay `receipt_*`; crear reserva en webhook/RPC con meta del intent.
6. **H9–H10** — Meter settings + `facility_catalog` en bootstrap (socio y ops); flag `settingsHydrated` para UI sensible.
7. **H5–H6** — Clave de promote con fecha AR del día; ante fallo de list, no marcar ready / no auto-liquidar seed.

---

## Mapa de capas auditadas

```
Auth/desk → bootstrap shell/deferred/padrón/ERP → repos/RPC/edges
     │
     ├─ Cuota/saldo/mora (C2, H4, M1–M3)
     ├─ Fee periods (C2, H5–H6, M6)
     ├─ /acceso (H1–H3, M4–M5)
     ├─ MP + caja + recibos (C1, H7–H8, M7)
     └─ Settings hydrate (H9–H10, M8)
```
