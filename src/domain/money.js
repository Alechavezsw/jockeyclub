/**
 * Pesos con centavos, igual que numeric(14,2) en la base.
 * Liquidado, saldo y recibo pasan por acá: no se tiran los centavos.
 */
export function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}
