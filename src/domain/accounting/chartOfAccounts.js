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
  { id: 'coa-1.1.03', code: '1.1.03', name: 'Banco Macro', accountType: 'asset', parentId: 'coa-1.1', level: 3, isPostable: true, isCashAccount: true },
  { id: 'coa-1.1.07', code: '1.1.07', name: 'AMET', accountType: 'asset', parentId: 'coa-1.1', level: 3, isPostable: true, isCashAccount: true },
  { id: 'coa-1.1.08', code: '1.1.08', name: 'Mercado Pago', accountType: 'asset', parentId: 'coa-1.1', level: 3, isPostable: true, isCashAccount: true },
  { id: 'coa-1.1.04', code: '1.1.04', name: 'IVA Crédito Fiscal', accountType: 'asset', parentId: 'coa-1.1', level: 3, isPostable: true, isCashAccount: false },
  { id: 'coa-1.1.05', code: '1.1.05', name: 'Percepciones a Favor', accountType: 'asset', parentId: 'coa-1.1', level: 3, isPostable: true, isCashAccount: false },
  { id: 'coa-1.1.06', code: '1.1.06', name: 'Cuentas a Cobrar', accountType: 'asset', parentId: 'coa-1.1', level: 3, isPostable: true, isCashAccount: false },
  { id: 'coa-1.2.01', code: '1.2.01', name: 'Equipamiento Canchas', accountType: 'asset', parentId: 'coa-1', level: 3, isPostable: true, isCashAccount: false },
  { id: 'coa-1.2.02', code: '1.2.02', name: 'Caballos Criollos', accountType: 'asset', parentId: 'coa-1', level: 3, isPostable: true, isCashAccount: false },
  { id: 'coa-2', code: '2', name: 'PASIVO', accountType: 'liability', parentId: null, level: 1, isPostable: false, isCashAccount: false },
  { id: 'coa-2.1.01', code: '2.1.01', name: 'Proveedores Hípicos', accountType: 'liability', parentId: 'coa-2', level: 3, isPostable: true, isCashAccount: false },
  { id: 'coa-2.1.02', code: '2.1.02', name: 'Sueldos a Pagar', accountType: 'liability', parentId: 'coa-2', level: 3, isPostable: true, isCashAccount: false },
  { id: 'coa-2.1.03', code: '2.1.03', name: 'Impuestos Pendientes', accountType: 'liability', parentId: 'coa-2', level: 3, isPostable: true, isCashAccount: false },
  { id: 'coa-2.1.04', code: '2.1.04', name: 'IVA Débito Fiscal', accountType: 'liability', parentId: 'coa-2', level: 3, isPostable: true, isCashAccount: false },
  { id: 'coa-2.1.05', code: '2.1.05', name: 'IVA a Pagar', accountType: 'liability', parentId: 'coa-2', level: 3, isPostable: true, isCashAccount: false },
  { id: 'coa-2.1.06', code: '2.1.06', name: 'IIBB a Pagar', accountType: 'liability', parentId: 'coa-2', level: 3, isPostable: true, isCashAccount: false },
  { id: 'coa-2.1.07', code: '2.1.07', name: 'Percepciones a Depositar', accountType: 'liability', parentId: 'coa-2', level: 3, isPostable: true, isCashAccount: false },
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
  { id: 'coa-5.1.06', code: '5.1.06', name: 'Impuestos y Tasas', accountType: 'expense', parentId: 'coa-5', level: 3, isPostable: true, isCashAccount: false },
  { id: 'coa-5.1.07', code: '5.1.07', name: 'Descuentos sobre cuotas', accountType: 'expense', parentId: 'coa-5', level: 3, isPostable: true, isCashAccount: false },
];

/** IDs UUID del seed Supabase → código (para cruzar con el plan demo coa-*). */
export const CLOUD_ACCOUNT_ID_TO_CODE = {
  'aaaaaaaa-0001-0001-0001-000000000111': '1.1.01',
  'aaaaaaaa-0001-0001-0001-000000000112': '1.1.02',
  'aaaaaaaa-0001-0001-0001-000000000113': '1.1.03',
  'aaaaaaaa-0001-0001-0001-000000000114': '1.1.04',
  'aaaaaaaa-0001-0001-0001-000000000115': '1.1.05',
  'aaaaaaaa-0001-0001-0001-000000000116': '1.1.06',
  'aaaaaaaa-0001-0001-0001-000000000117': '1.1.07',
  'aaaaaaaa-0001-0001-0001-000000000118': '1.1.08',
  'aaaaaaaa-0001-0001-0001-000000000121': '1.2.01',
  'aaaaaaaa-0001-0001-0001-000000000122': '1.2.02',
  'aaaaaaaa-0002-0002-0002-000000000111': '2.1.01',
  'aaaaaaaa-0002-0002-0002-000000000112': '2.1.02',
  'aaaaaaaa-0002-0002-0002-000000000113': '2.1.03',
  'aaaaaaaa-0002-0002-0002-000000000114': '2.1.04',
  'aaaaaaaa-0002-0002-0002-000000000115': '2.1.05',
  'aaaaaaaa-0002-0002-0002-000000000116': '2.1.06',
  'aaaaaaaa-0002-0002-0002-000000000117': '2.1.07',
  'aaaaaaaa-0003-0003-0003-000000000111': '3.1.01',
  'aaaaaaaa-0003-0003-0003-000000000112': '3.1.02',
  'aaaaaaaa-0004-0004-0004-000000000111': '4.1.01',
  'aaaaaaaa-0004-0004-0004-000000000112': '4.1.02',
  'aaaaaaaa-0004-0004-0004-000000000113': '4.1.03',
  'aaaaaaaa-0004-0004-0004-000000000114': '4.1.04',
  'aaaaaaaa-0005-0005-0005-000000000111': '5.1.01',
  'aaaaaaaa-0005-0005-0005-000000000112': '5.1.02',
  'aaaaaaaa-0005-0005-0005-000000000113': '5.1.03',
  'aaaaaaaa-0005-0005-0005-000000000114': '5.1.04',
  'aaaaaaaa-0005-0005-0005-000000000115': '5.1.05',
  'aaaaaaaa-0005-0005-0005-000000000116': '5.1.06',
  'aaaaaaaa-0005-0005-0005-000000000117': '5.1.07',
};

/** Compatibilidad con asientos legacy (nombre de cuenta → id). */
export const LEGACY_ACCOUNT_NAME_MAP = {
  'Caja': 'coa-1.1.01',
  'Caja General': 'coa-1.1.01',
  'Caja Cantina': 'coa-1.1.02',
  'Banco Nación': 'coa-1.1.03',
  'Banco Macro': 'coa-1.1.03',
  'Mercado Pago': 'coa-1.1.08',
  'AMET': 'coa-1.1.07',
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
  'Descuentos sobre cuotas': 'coa-5.1.07',
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
  const list = Array.isArray(chart) ? chart : [];
  const byId = getAccountById(list, accountRef);
  if (byId) return byId.id;
  const byCode = getAccountByCode(list, accountRef);
  if (byCode) return byCode.id;
  const byName = list.find(
    (a) => a.name === accountRef
      || String(a.name || '').toLowerCase() === String(accountRef).toLowerCase()
  );
  if (byName) return byName.id;

  // Legacy demo ids (coa-*) → resolver por código/nombre en el plan actual (UUID en nube)
  const legacy = LEGACY_ACCOUNT_NAME_MAP[accountRef];
  if (legacy) {
    const legacyAcc = getAccountById(DEFAULT_CHART_OF_ACCOUNTS, legacy);
    if (legacyAcc) {
      const match = list.find(
        (a) => a.id === legacy
          || a.code === legacyAcc.code
          || a.name === legacyAcc.name
      );
      if (match) return match.id;
    }
    if (getAccountById(list, legacy)) return legacy;
  }

  // coa-* en plan nube (UUID): cruzar por código/nombre del demo.
  const fromDefault = getAccountById(DEFAULT_CHART_OF_ACCOUNTS, accountRef);
  if (fromDefault) {
    const match = list.find(
      (a) => a.code === fromDefault.code || a.name === fromDefault.name
    );
    if (match) return match.id;
    return fromDefault.id;
  }

  // UUID de nube en plan demo: códigos estables del seed Supabase.
  const cloudCode = CLOUD_ACCOUNT_ID_TO_CODE[accountRef];
  if (cloudCode) {
    const match = getAccountByCode(list, cloudCode)
      || getAccountByCode(DEFAULT_CHART_OF_ACCOUNTS, cloudCode);
    if (match) return match.id;
  }
  return null;
}

export function accountLabel(account) {
  if (!account) return '—';
  return `${account.code} · ${account.name}`;
}
