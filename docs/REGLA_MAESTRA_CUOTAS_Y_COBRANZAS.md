# Regla maestra de cuotas y cobranzas

Esta regla vale para todo Jockey Connect. Antes de tocar cobranzas, cuotas, imputaciones o el modal Cobrar cuota, hay que leerla.

## Tarifa vigente

Cada mes impago se cobra por separado, con la tarifa vigente de la categoría del socio, más el recargo de ese mes si corresponde.

Para un socio familiar, la tarifa vigente es $ 70.000. Para un socio individual, $ 40.000. Vitalicio, fundador y comisión no abonan cuota social.

Un mes impago entero se valoriza a esa tarifa. El importe original queda en el libro. La diferencia de tarifa se ve en el cobro y no se escribe sola en el saldo de la ficha.

Un pago parcial no se vuelve a inflar a la tarifa llena. El remanente es lo que falta de ese mes.

## Qué meses se deben

El mes sale del libro (`fee_ledger_lines`) o de las obligaciones ya guardadas. No se decide dividiendo el saldo por la tarifa.

Un ajuste sin fecha de mes, en particular `connect_admin_reconciliation_20261123`, es saldo histórico pendiente de conciliación. No es una cuota, no lleva recargo y no se reparte entre meses sin evidencia.

Hasta que un mes no está liquidado, nadie lo debe. Un `next_due_date` futuro no es deuda.

## Vencimiento y recargo

La cuota social vence el día 10. Hasta ese día, capital sin recargo. Desde el 11, 10 % sobre el capital exigible de ese mes, para familiar e individual.

El recargo es de cada mes. No es el 10 % del saldo. No se calcula sobre otro recargo. Si el libro ya tiene el recargo de ese mes, no se suma otro.

El débito no cobra el 10 %. El abono de tenis no lleva ese recargo y no se mezcla con la cuota social.

## Pagos, créditos y bonificaciones

El cobro es la suma de los meses elegidos, más sus recargos, menos el descuento o el crédito que corresponda. El descuento no cambia el capital del mes.

Cada imputación guarda socio, período, capital, recargo, descuento, medio e identificador. Repetir la misma lectura no reabre un mes ya cubierto.

## Conciliación

El saldo de la ficha es el control. No se modifica para que coincida con el teórico.

Si el teórico de meses verificados no cierra con el saldo, la diferencia queda a la vista y espera autorización. Los 249 ajustes sin mes se proponen, no se aplican solos.

## Casos que las pruebas cuidan

- 10632 Silvia Lorena Villalba: octubre y noviembre a $ 77.000, y $ 135.000 sin mes. El saldo sigue en $ 275.000. Agosto y septiembre no se inventan.
- Si el libro trae agosto a noviembre verificados, son cuatro meses de $ 77.000 ($ 308.000). La diferencia de $ 33.000 con la ficha no se escribe sola.
- 10697: octubre y noviembre a $ 77.000, sin duplicar el recargo ya anotado. El débito no lleva recargo.
- 100132 Luciano Virhuez: cuota social de noviembre $ 42.000 y abono de tenis $ 12.000. Total $ 54.000.
- Saldo $ 0 con el mes cubierto: al día, aunque `next_due_date` sea viejo.

## Invariantes

- Importe histórico, importe exigible y saldo cobrado son tres cifras distintas.
- No se cobra dos veces un mes cubierto.
- No se crea una cuota de un mes que no empezó.
- No se manda correo ni se registra un pago desde esta regla.
- No se toca Mercado Pago ni el débito Galicia más allá de usar el mismo importe exigible.
