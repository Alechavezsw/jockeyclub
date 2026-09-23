/**
 * Catálogo de snapshots exportados de LILA/Accessin y Societas.
 *
 * Módulo sin dependencias ni import.meta: lo comparten la app (data/snapshots.js) y el
 * script que los sube a Supabase Storage (scripts/upload-snapshots.mjs). Cada nombre es
 * a la vez src/data/seed/<nombre>.js y <nombre>.json en el bucket.
 */

export const SNAPSHOT_BUCKET = 'club-snapshots';

/** Nombre para mostrar en avisos. */
export const SNAPSHOT_LABELS = Object.freeze({
  accessinBankAccounts: 'cuentas bancarias',
  accessinBonificaciones: 'bonificaciones',
  accessinCashMovements: 'movimientos de caja',
  accessinCashSnapshot: 'corte de caja',
  accessinCheques: 'cheques en cartera',
  accessinCobranzas: 'cobranzas',
  accessinCurrentAccountBalances: 'saldos de cuenta corriente',
  accessinDetailedCurrentAccounts: 'cuentas corrientes detalladas',
  accessinFamilyGroupBalances: 'saldos de grupo familiar',
  accessinFeeAccountDetails: 'detalle de cuotas',
  accessinLiquidationCc: 'liquidación de cuentas corrientes',
  accessinMemberCreditPurchases: 'créditos comprados por socios',
  accessinMonthlyBalance: 'balance mensual',
  accessinMonthlyBalanceDetails: 'detalle del balance mensual',
  accessinMonthlyDebts: 'deudas mes a mes',
  accessinRetenciones: 'retenciones',
  accessinSupplierPayments: 'pagos a proveedores',
  accessinSuppliers: 'proveedores',
  societasMembershipMoves: 'altas y bajas de socios',
});

export const SNAPSHOT_NAMES = Object.freeze(Object.keys(SNAPSHOT_LABELS));
