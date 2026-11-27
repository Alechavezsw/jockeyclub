# Primera cuota social del alta

La obligación que se genera al dar de alta a un socio titular es la **cuota social del mes calendario en que ingresa**. No es un cargo de inscripción y no se vuelve a liquidar ese mismo mes.

## Regla

- La fecha de alta se lee en `America/Argentina/Buenos_Aires`.
- El período es el mes de esa fecha. El identificador interno sigue siendo el día 10 (el 18 si es AMET). Ese día nombra el período; no es, por sí solo, una mora anterior al ingreso.
- La tarifa sale de la categoría vigente (catálogo `member_tiers` en la base; si no hay, familiar $ 70.000, individual $ 40.000, AMET familiar $ 68.250, AMET individual $ 39.000).
- El integrante del grupo no genera otra cuota social. La cuota es del titular.
- Vitalicio, fundador, comisión, pileta no socio y colonia no socio no generan cuota social.
- Si el alta es **el día del vencimiento o antes**, el 10 % de mora corre desde el día siguiente, como en cualquier cuota de ese mes.
- Si el alta es **después del vencimiento**, la base de mora de esa primera cuota queda en cero. No se inventa otro plazo de gracia: la cuota queda exigible desde el alta, sin el 10 % de un vencimiento que el socio no alcanzó a tener. El próximo vencimiento ordinario es el del mes siguiente.
- El abono de tenis, si corresponde, es otro movimiento (`charge_scope = abono_tenis`). No se suma dentro de la cuota social.
- Un reintento usa la clave `alta:{id}` (y `alta:{id}:abono_tenis`). Si ya existe el movimiento, el período o la marca `altaMonthlyQuotaReconciliation`, no se abre otra obligación.

## Qué quedó mal

El alta escribía un movimiento `kind = alta` con vencimiento ficticio `1899-12-10` y el texto «Cuota de alta». Ese vencimiento no entra en `member_dues_periods` (el sincronizador ignora fechas hasta el 1900-01-10), así que la ficha, el cobro y la liquidación no veían el mes real. La liquidación del mes de ingreso ya omitía la cuota social cuando había `joinDate`; el hueco era el cargo inicial, suelto y sin período.

## Qué hace el alta ahora

`registrar_primera_cuota_alta` corre en una sola transacción:

1. Toma el socio ya creado y lo bloquea.
2. Calcula el período y la tarifa en la base. No usa el importe que manda el formulario.
3. Inserta un movimiento `kind = alta`, `charge_scope = cuota_social`.
4. Inserta el período de ese mes, con la misma capital y `late_base` en cero si el alta es posterior al vencimiento.
5. Deja el auxiliar en `fee_ledger_lines` como **pendiente**. No es un cobro ni un ingreso de caja.
6. El saldo de la ficha sale de la suma de movimientos. El período y el auxiliar describen la misma obligación; no son otras dos deudas.
7. Audita `alta_primera_cuota`.

El formulario muestra, antes de confirmar, categoría, fecha, «Primera cuota social — [mes y año]», recargo y el próximo vencimiento.

## Los diez socios ya corregidos

Siguen como están. La función sale sin escribir si el socio tiene `meta.altaMonthlyQuotaReconciliation`. No se los vuelve a liquidar.

| Socio | Capital |
|---|---:|
| 111598, 111624, 111627 | $ 70.000 |
| 111615, 111617, 111618, 111620, 111622, 111623, 111633 | $ 40.000 |
| Total | $ 490.000 |

## Contabilidad

Crear la cuota aumenta el pendiente de la cuenta de la categoría (cuota por cobrar). No mueve caja, banco ni una cuenta de ingreso cobrado. El asiento de ingreso se hace cuando esa cuota se cobra, por el circuito de cobranza que ya existe, imputado a ese `due_on`.

## Rollback

No aplicar esta migración hasta autorización. Si ya se aplicó y todavía no hubo altas nuevas con el procedimiento:

`drop function if exists public.registrar_primera_cuota_alta(uuid, date, boolean);`

Eso no borra períodos, movimientos ni los $ 490.000 conciliados. Las altas que ya hayan pasado por la función quedan como cuota del mes; revertirlas es un ajuste puntual, no un borrado masivo.
