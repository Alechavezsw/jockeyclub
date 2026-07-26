/** Plan de cuentas institucional (espejo del seed SQL). */
export const ACCOUNT_TYPES = {
  asset: { label: 'Activo', nature: 'debit' },
  liability: { label: 'Pasivo', nature: 'credit' },
  equity: { label: 'Patrimonio Neto', nature: 'credit' },
  income: { label: 'Ingreso', nature: 'credit' },
  expense: { label: 'Gasto', nature: 'debit' },
};

export const DEFAULT_CHART_OF_ACCOUNTS = [
  { id: 'coa-1', code: '1', name: 'ACTIVO', accountType: 'asset', parentId: null, level: 1, isPostable: false, isCashAccount: false },
  { id: 'coa-1.1', code: '1.1', name: 'Activo Corriente', accountType: 'asset', parentId: 'coa-1', level: 2, isPostable: false, isCashAccount: false },
  { id: 'coa-1.1.01', code: '1.1.01', name: 'Caja General', accountType: 'asset', parentId: 'coa-1.1', level: 3, isPostable: true, isCashAccount: true },
  { id: 'coa-1.1.02', code: '1.1.02', name: 'Caja Cantina', accountType: 'asset', parentId: 'coa-1.1', level: 3, isPostable: true, isCashAccount: true },
  { id: 'coa-1.1.03', code: '1.1.03', name: 'Banco Nación', accountType: 'asset', parentId: 'coa-1.1', level: 3, isPostable: true, isCashAccount: true },
  { id: 'coa-1.2.01', code: '1.2.01', name: 'Equipamiento Canchas', accountType: 'asset', parentId: 'coa-1', level: 3, isPostable: true, isCashAccount: false },
  { id: 'coa-1.2.02', code: '1.2.02', name: 'Caballos Criollos', accountType: 'asset', parentId: 'coa-1', level: 3, isPostable: true, isCashAccount: false },
  { id: 'coa-2', code: '2', name: 'PASIVO', accountType: 'liability', parentId: null, level: 1, isPostable: false, isCashAccount: false },
  { id: 'coa-2.1.01', code: '2.1.01', name: 'Proveedores Hípicos', accountType: 'liability', parentId: 'coa-2', level: 3, isPostable: true, isCashAccount: false },
  { id: 'coa-2.1.02', code: '2.1.02', name: 'Sueldos a Pagar', accountType: 'liability', parentId: 'coa-2', level: 3, isPostable: true, isCashAccount: false },
  { id: 'coa-2.1.03', code: '2.1.03', name: 'Impuestos Pendientes', accountType: 'liability', parentId: 'coa-2', level: 3, isPostable: true, isCashAccount: false },
  { id: 'coa-3', code: '3', name: 'PATRIMONIO NETO', accountType: 'equity', parentId: null, level: 1, isPostable: false, isCashAccount: false },
  { id: 'coa-3.1.01', code: '3.1.01', name: 'Capital Social', accountType: 'equity', parentId: 'coa-3', level: 3, isPostable: true, isCashAccount: false },
  { id: 'coa-3.1.02', code: '3.1.02', name: 'Resultados Acumulados', accountType: 'equity', parentId: 'coa-3', level: 3, isPostable: true, isCashAccount: false },
  { id: 'coa-4', code: '4', name: 'INGRESOS', accountType: 'income', parentId: null, level: 1, isPostable: false, isCashAccount: false },
  { id: 'coa-4.1.01', code: '4.1.01', name: 'Cuotas Sociales', accountType: 'income', parentId: 'coa-4', level: 3, isPostable: true, isCashAccount: false },
  { id: 'coa-4.1.02', code: '4.1.02', name: 'Reservas e Instalaciones', accountType: 'income', parentId: 'coa-4', level: 3, isPostable: true, isCashAccount: false },
  { id: 'coa-4.1.03', code: '4.1.03', name: 'Eventos y Fiestas', accountType: 'income', parentId: 'coa-4', level: 3, isPostable: true, isCashAccount: false },
  { id: 'coa-4.1.04', code: '4.1.04', name: 'Concesión Gastronómica', accountType: 'income', parentId: 'coa-4', level: 3, isPostable: true, isCashAccount: false },
  { id: 'coa-5', code: '5', name: 'GASTOS', accountType: 'expense', parentId: null, level: 1, isPostable: false, isCashAccount: false },
  { id: 'coa-5.1.01', code: '5.1.01', name: 'Sueldos y Jornales', accountType: 'expense', parentId: 'coa-5', level: 3, isPostable: true, isCashAccount: false },
  { id: 'coa-5.1.02', code: '5.1.02', name: 'Mantenimiento de Canchas', accountType: 'expense', parentId: 'coa-5', level: 3, isPostable: true, isCashAccount: false },
  { id: 'coa-5.1.03', code: '5.1.03', name: 'Alimento Equino', accountType: 'expense', parentId: 'coa-5', level: 3, isPostable: true, isCashAccount: false },
  { id: 'coa-5.1.04', code: '5.1.04', name: 'Servicios e Insumos', accountType: 'expense', parentId: 'coa-5', level: 3, isPostable: true, isCashAccount: false },
  { id: 'coa-5.1.05', code: '5.1.05', name: 'Gastos de Eventos', accountType: 'expense', parentId: 'coa-5', level: 3, isPostable: true, isCashAccount: false },
];

/** Compatibilidad con asientos legacy (nombre de cuenta → id). */
export const LEGACY_ACCOUNT_NAME_MAP = {
  'Caja': 'coa-1.1.01',
  'Caja General': 'coa-1.1.01',
  'Caja Cantina': 'coa-1.1.02',
  'Banco Nación': 'coa-1.1.03',
  'Equipamiento Canchas': 'coa-1.2.01',
  'Caballos Criollos': 'coa-1.2.02',
  'Proveedores Hípicos': 'coa-2.1.01',
  'Sueldos a Pagar': 'coa-2.1.02',
  'Impuestos Pendientes': 'coa-2.1.03',
  'Capital Social': 'coa-3.1.01',
  'Resultados Acumulados': 'coa-3.1.02',
  'Cuotas Sociales': 'coa-4.1.01',
  'Reservas Gourmet': 'coa-4.1.02',
  'Reservas e Instalaciones': 'coa-4.1.02',
  'Concesión Golf': 'coa-4.1.04',
  'Concesión Gastronómica': 'coa-4.1.04',
  'Eventos y Fiestas': 'coa-4.1.03',
  'Sueldos y Jornales': 'coa-5.1.01',
  'Mantenimiento de Canchas': 'coa-5.1.02',
  'Alimento Equino': 'coa-5.1.03',
  'Servicios e Insumos': 'coa-5.1.04',
  'Gastos de Eventos': 'coa-5.1.05',
};

export function getPostableAccounts(chart = DEFAULT_CHART_OF_ACCOUNTS) {
  return chart.filter((a) => a.isPostable && a.isActive !== false);
}

export function getAccountById(chart, id) {
  return chart.find((a) => a.id === id);
}

export function getAccountByCode(chart, code) {
  return chart.find((a) => a.code === code);
}

export function resolveAccountId(chart, accountRef) {
  if (!accountRef) return null;
  const byId = getAccountById(chart, accountRef);
  if (byId) return byId.id;
  const byCode = getAccountByCode(chart, accountRef);
  if (byCode) return byCode.id;
  const legacy = LEGACY_ACCOUNT_NAME_MAP[accountRef];
  if (legacy) return legacy;
  const byName = chart.find((a) => a.name === accountRef);
  return byName?.id ?? null;
}

export function accountLabel(account) {
  if (!account) return '—';
  return `${account.code} · ${account.name}`;
}
