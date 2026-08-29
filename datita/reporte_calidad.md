# Reporte de calidad de datos — migración de socios

Total de filas procesadas: **5073**


## Documentos con formato atípico (3)
No son 'Arg-DNI' estándar (ej: RUT chileno, 'Otro'). Revisar si la nueva app soporta otros tipos de documento.

- socio #100280: `Chl-RUT 92635102`
- socio #12338: `Otro 33146947`
- socio #12963: `Chl-RUT 521603378`

## Fecha de nacimiento no parseable (1773)
Quedó en NULL en el CSV — valor original no era una fecha (ej. 'No definido').

- socio #4: `No definido`
- socio #23: `No definido`
- socio #34: `No definido`
- socio #61: `No definido`
- socio #65: `No definido`
- socio #66: `No definido`
- socio #67: `No definido`
- socio #70: `No definido`
- socio #77: `No definido`
- socio #92: `No definido`
- ... y 1763 más

## Fecha de alta no parseable (0)

## Socios con más de una categoría de cuota activa (75)
Se migraron todas sus categorías a `socio_cuotas` (una fila por categoría), no se perdió información.

- socio #1738: ABONO TENIS, GRUPO FAMILIAR (Familiar)
- socio #2422: ABONO TENIS, GRUPO FAMILIAR (Familiar)
- socio #3173: ABONO TENIS, SOCIO (Vitalicio)
- socio #3651: GRUPO FAMILIAR (Vitalicio), SOCIO (Vitalicio)
- socio #3719: ABONO TENIS, SOCIO (Vitalicio)
- socio #3869: ABONO TENIS, GRUPO FAMILIAR (Familiar)
- socio #4389: ABONO TENIS, SOCIO (Vitalicio)
- socio #5067: ABONO TENIS, SOCIO (Vitalicio)
- socio #5138: ABONO TENIS, SOCIO (Vitalicio)
- socio #5755: ABONO TENIS, SOCIO (Vitalicio)
- ... y 65 más

## Socios sin ninguna categoría de cuota (131)
No tienen fila en `socio_cuotas`. Puede ser normal (bajas, pendientes) pero conviene confirmarlo.


## ⚠️ 'TARJETA PRISMA' con valores atípicos (5)
Esta columna debería tener datos de tarjeta de débito Prisma, pero **algunos valores parecen ser grupos sanguíneos** (ej. 'O+', 'A0+'), probablemente por un error de carga en el sistema de origen (columnas corridas al tipear). Se migró el valor tal cual pero **recomiendo que el equipo lo confirme contra el sistema original** antes de dar la tabla por buena.

- socio #None: `O+`
- socio #None: `O+`
- socio #None: `O+`
- socio #None: `O+`
- socio #None: `B+`