/** Importación de gastos (Excel Manual con N° de comprobante). */

export const EXPENSE_IMPORT_MODULES = {
  excel_manual_invoice: 'Excel Manual Con Nro de comprobante',
};

export const EXPENSE_IMPORT_STATUS = {
  completed: 'Completado',
  partial: 'Parcial',
  failed: 'Fallido',
};

export const LISTA_BASE_GASTOS_URL = '/templates/lista-base-gastos.xlsx';
export const LISTA_BASE_GASTOS_FILENAME = 'lista-base-gastos.xlsx';

function normHeader(h) {
  return String(h || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function excelDateToIso(v) {
  if (v == null || v === '') return '';
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return v.toISOString().slice(0, 10);
  }
  if (typeof v === 'number') {
    const utc = Date.UTC(1899, 11, 30) + Math.round(v * 86400000);
    return new Date(utc).toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  return s.slice(0, 10);
}

export function matchExpenseAccount(accounts = [], label) {
  const q = String(label || '').trim().toLowerCase();
  if (!q) return null;
  return accounts.find((a) => {
    const name = String(a.name || '').toLowerCase();
    const code = String(a.code || '').toLowerCase();
    const full = `${code} ${name}`.trim();
    return name === q || code === q || full === q || name.includes(q) || q.includes(name);
  }) || null;
}

/** AOA hoja GASTOS → filas normalizadas. */
export function parseGastosSheetRows(aoa = []) {
  if (!Array.isArray(aoa) || !aoa.length) {
    throw new Error('El archivo no tiene hoja GASTOS con datos.');
  }
  const headerIdx = aoa.findIndex((r) => {
    if (!r || !r.length) return false;
    const h0 = normHeader(r[0]);
    return h0 === 'PROVEEDOR' || h0.startsWith('PROVEEDOR');
  });
  if (headerIdx < 0) {
    throw new Error('No se encontró el encabezado PROVEEDOR en la hoja GASTOS.');
  }

  const header = (aoa[headerIdx] || []).map(normHeader);
  const idx = {
    proveedor: header.findIndex((h) => h.startsWith('PROVEEDOR')),
    fecha: header.findIndex((h) => h.startsWith('FECHA')),
    concepto: header.findIndex((h) => h.startsWith('CONCEPTO') || h.startsWith('DESCRIPCION')),
    comprobante: header.findIndex((h) => h.includes('COMPROBANTE')),
    cuenta: header.findIndex((h) => h.includes('CUENTA')),
    monto: header.findIndex((h) => h === 'MONTO' || h.startsWith('MONTO')),
  };
  if (idx.proveedor < 0 || idx.monto < 0) {
    throw new Error('La plantilla debe incluir columnas PROVEEDOR y MONTO.');
  }

  const rows = [];
  for (let i = headerIdx + 1; i < aoa.length; i += 1) {
    const r = aoa[i];
    if (!r) continue;
    const proveedor = String(r[idx.proveedor] ?? '').trim();
    const monto = Number(r[idx.monto]) || 0;
    const concepto = idx.concepto >= 0 ? String(r[idx.concepto] ?? '').trim() : '';
    if (!proveedor && !monto && !concepto) continue;
    rows.push({
      line: i + 1,
      proveedor,
      fecha: excelDateToIso(idx.fecha >= 0 ? r[idx.fecha] : ''),
      concepto,
      comprobante: idx.comprobante >= 0 ? String(r[idx.comprobante] ?? '').trim() : '',
      cuentaGasto: idx.cuenta >= 0 ? String(r[idx.cuenta] ?? '').trim() : '',
      monto,
    });
  }
  return rows;
}

/**
 * Arma borradores de gasto + batch de importación.
 * status inicial: pending_approval (flujo de aprobación ERP).
 */
export function buildExpenseImport({
  rows = [],
  suppliers = [],
  expenseAccounts = [],
  paymentAccountId = '',
  defaultCategoryAccountId = '',
  module = 'excel_manual_invoice',
  fileName = '',
}) {
  const expenses = [];
  const errors = [];
  const stamp = new Date();
  let totalAmount = 0;

  rows.forEach((row) => {
    if (!row.proveedor) {
      errors.push({ line: row.line, message: 'Falta proveedor.' });
      return;
    }
    if (!row.monto || row.monto <= 0) {
      errors.push({ line: row.line, message: `Monto inválido para ${row.proveedor}.` });
      return;
    }
    if (!row.concepto) {
      errors.push({ line: row.line, message: `Falta concepto para ${row.proveedor}.` });
      return;
    }

    const matchedSupplier = suppliers.find((s) => {
      const name = String(s.legalName || s.name || '').trim().toLowerCase();
      const q = row.proveedor.toLowerCase();
      return name === q || name.includes(q) || q.includes(name);
    });

    const matchedAccount = row.cuentaGasto
      ? matchExpenseAccount(expenseAccounts, row.cuentaGasto)
      : null;
    const categoryAccountId = matchedAccount?.id || defaultCategoryAccountId;
    if (!categoryAccountId) {
      errors.push({ line: row.line, message: `Sin cuenta de gasto para ${row.proveedor}.` });
      return;
    }
    if (row.cuentaGasto && !matchedAccount) {
      errors.push({
        line: row.line,
        message: `Cuenta no encontrada (${row.cuentaGasto}); se usó la cuenta por defecto.`,
      });
    }

    const expense = {
      id: `exp-imp-${stamp.getTime()}-${row.line}`,
      expenseNumber: null,
      expenseDate: row.fecha || stamp.toISOString().slice(0, 10),
      vendorName: matchedSupplier
        ? (matchedSupplier.legalName || matchedSupplier.name)
        : row.proveedor,
      categoryAccountId,
      paymentAccountId: paymentAccountId || '',
      amount: row.monto,
      concept: row.concepto,
      invoiceNumber: row.comprobante || '',
      status: 'pending_approval',
      requestedBy: 'import-excel',
      approvedBy: null,
      approvedAt: null,
      paidAt: null,
      journalEntryId: null,
      rejectionReason: null,
      importSource: module,
      createdAt: stamp.toISOString(),
    };
    expenses.push(expense);
    totalAmount += row.monto;
    if (!matchedSupplier) {
      errors.push({ line: row.line, message: `Proveedor no está en padrón: ${row.proveedor}` });
    }
  });

  let status = 'completed';
  if (!expenses.length) status = 'failed';
  else if (errors.length) status = 'partial';

  const batch = {
    id: `exi-${stamp.getTime()}`,
    importedAt: stamp.toISOString(),
    module,
    moduleLabel: EXPENSE_IMPORT_MODULES[module] || module,
    status,
    importedCount: expenses.length,
    totalAmount,
    fileName: fileName || '',
    errorCount: errors.length,
    errors,
    expenseIds: expenses.map((e) => e.id),
  };

  return { batch, expenses, errors };
}
