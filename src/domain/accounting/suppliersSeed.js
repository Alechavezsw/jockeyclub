/**
 * Enlace con el padrón de proveedores de Accessin (`accessinSuppliers`).
 *
 * Separado de suppliers.js para que ese módulo, que el store del ERP usa al arrancar,
 * no dependa de un snapshot con razón social y CUIT de 240 proveedores, muchos de ellos
 * personas físicas. El snapshot se lee del registro de data/snapshots y está vacío
 * hasta que carga.
 */

import { readSnapshot } from '../../data/snapshots';

const EMPTY_SUPPLIERS_SEED = Object.freeze({
  ACCESSIN_SUPPLIERS: [],
  ACCESSIN_SUPPLIERS_AS_OF: '',
});

export function suppliersSeed() {
  return readSnapshot('accessinSuppliers', EMPTY_SUPPLIERS_SEED);
}
