# Auditoría duplicado Rut Tamara Yacante Jaled

Fecha: 2026-11-20  
Rama: `fix/yacante-duplicate-12143`

## Conclusión

| Nº | Rol | Acción |
|---|---|---|
| **12143** | Ficha canónica activa (socio familiar, DNI 38593056) | Operativa |
| **12144** | Yashira Elizabet Yacante Jaled — familiar legítima | Se mantiene vinculada a 12143 |
| **10698** | Misma persona, ficha histórica inactiva (DNI truncado 3859356) | Antecedente; no operativa |

**Evidencia de misma persona:** nombre idéntico; DNI 3859356 es truncado de 38593056; antigüedad ~3 años coherente; 10698 **no** aparece en padrón legado `socios` (sí 12143/12144).

## Qué no se hizo

- No se transfirió la deuda $376.100,78 de 10698 a 12143.
- No se movieron los 5 familiares del GF Bassi (2302, 4848, 5174, 6608, 8356). Quedan con principal 10698 para **revisión administrativa individual**.
- No se borró 10698.

## Estado operativo 12143

- Al día con **octubre** (Macro Clic $70.000 registrado).
- Debe **noviembre** $70.000.
- Antigüedad verificada: **3 años**.
- Grupo familiar: **Familia Yacante Jaled** (titular 12143 + Yashira 12144).

## Prevención

- Módulo `memberDuplicates.js`: DNI normalizado / truncado, ocultar histórico en cobranzas salvo Nº exacto.
- Vista/auditoría de grupos con `findDuplicateMemberGroups`.

## Familiares 10698 (pendientes de decisión humana)

| Nº | Nombre | Estado |
|---|---|---|
| 2302 | Nestor Fabian Bassi | active → principal 10698 |
| 4848 | Clorinda Jaled | active → principal 10698 |
| 5174 | Maria Paz Bassi Yacante | active → principal 10698 |
| 6608 | Silvia Beatriz Cordoba | active → principal 10698 |
| 8356 | Federico Bassi | active → principal 10698 |
