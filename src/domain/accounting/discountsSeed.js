/**
 * Enlace con el snapshot de bonificaciones de Accessin (`accessinBonificaciones`).
 *
 * Separado de discounts.js para que ese módulo, que el store del ERP usa al arrancar,
 * no dependa de un snapshot con nombre y documento de socios. El snapshot se lee del
 * registro de data/snapshots y está vacío hasta que carga.
 */

import { readSnapshot } from '../../data/snapshots';
import { ACCESSIN_DISCOUNT_RULES } from './discounts';

const EMPTY_BONIFICACIONES_SEED = Object.freeze({
  ACCESSIN_BONIFICACIONES: [],
  ACCESSIN_BONIFICACIONES_AS_OF: '',
  ACCESSIN_BONIFICACIONES_SNAPSHOT: {},
});

export function bonificacionesSeed() {
  return readSnapshot('accessinBonificaciones', EMPTY_BONIFICACIONES_SEED);
}

/** Bonificaciones importadas de Accessin + reglas fijas del club. */
export function seedDiscounts() {
  return [...(bonificacionesSeed().ACCESSIN_BONIFICACIONES || []), ...(ACCESSIN_DISCOUNT_RULES || [])];
}
