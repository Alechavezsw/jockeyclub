/** Importación de pagos a proveedores (plantilla Excel Manual / LILA). */

export const SUPPLIER_PAYMENT_IMPORT_MODULES = {
  excel_manual: 'Excel Manual',
};

export const SUPPLIER_PAYMENT_IMPORT_STATUS = {
  completed: 'Completado',
  partial: 'Parcial',
  failed: 'Fallido',
};

const PAGOS_HEADERS = [
  'PROVEEDOR',
  'FECHA (YYYY-MM-DD)',
  'DESCRIPCIÓN',
  '¿QUIéN CONFECCIONA? (OPCIONAL)',
  '¿QUIéN AUTORIZA? (OPCIONAL)',
  '¿QUIéN RETIRA? (OPCIONAL)',
  'N° COMPROBANTE (OPCIONAL)',
  'MONTO',
  'FORMA DE PAGO',
];

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
    // Excel serial date (approx)
    const utc = Date.UTC(1899, 11, 30) + Math.round(v * 86400000);
    return new Date(utc).toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  return s.slice(0, 10);
}

export function mapPaymentMethodLabel(raw) {
  const s = String(raw || '').toLowerCase();
  if (!s) return 'transferencia';
  if (s.includes('efectivo')) return 'efectivo';
  if (s.includes('cheque')) return 'cheque';
  return 'transferencia';
}

export function matchSupplierByName(suppliers = [], name) {
  const q = String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!q) return null;
  const exact = suppliers.find((s) => {
    const legal = String(s.legalName || s.name || '').trim().toLowerCase().replace(/\s+/g, ' ');
    const trade = String(s.tradeName || '').trim().toLowerCase().replace(/\s+/g, ' ');
    return legal === q || trade === q;
  });
  if (exact) return exact;
  return suppliers.find((s) => {
    const legal = String(s.legalName || s.name || '').trim().toLowerCase();
    return legal.includes(q) || q.includes(legal);
  }) || null;
}

/** AOA de hoja PAGOS → filas normalizadas. */
export function parsePagosSheetRows(aoa = []) {
  if (!Array.isArray(aoa) || !aoa.length) {
    throw new Error('El archivo no tiene hoja PAGOS con datos.');
  }
  const headerIdx = aoa.findIndex((r) => {
    if (!r || !r.length) return false;
    const h0 = normHeader(r[0]);
    return h0 === 'PROVEEDOR' || h0.startsWith('PROVEEDOR');
  });
  if (headerIdx < 0) {
    throw new Error('No se encontró el encabezado PROVEEDOR en la hoja PAGOS.');
  }

  const header = (aoa[headerIdx] || []).map(normHeader);
  const idx = {
    proveedor: header.findIndex((h) => h.startsWith('PROVEEDOR')),
    fecha: header.findIndex((h) => h.startsWith('FECHA')),
    descripcion: header.findIndex((h) => h.startsWith('DESCRIPCION') || h.startsWith('DESCRIPCIÓN')),
    confecciona: header.findIndex((h) => h.includes('CONFECCIONA')),
    autoriza: header.findIndex((h) => h.includes('AUTORIZA')),
    retira: header.findIndex((h) => h.includes('RETIRA')),
    comprobante: header.findIndex((h) => h.includes('COMPROBANTE')),
    monto: header.findIndex((h) => h === 'MONTO' || h.startsWith('MONTO')),
    formaPago: header.findIndex((h) => h.includes('FORMA DE PAGO') || h.includes('FORMA')),
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
    if (!proveedor && !monto) continue;
    rows.push({
      line: i + 1,
      proveedor,
      fecha: excelDateToIso(idx.fecha >= 0 ? r[idx.fecha] : ''),
      descripcion: idx.descripcion >= 0 ? String(r[idx.descripcion] ?? '').trim() : '',
      confecciona: idx.confecciona >= 0 ? String(r[idx.confecciona] ?? '').trim() : '',
      autoriza: idx.autoriza >= 0 ? String(r[idx.autoriza] ?? '').trim() : '',
      retira: idx.retira >= 0 ? String(r[idx.retira] ?? '').trim() : '',
      comprobante: idx.comprobante >= 0 ? String(r[idx.comprobante] ?? '').trim() : '',
      monto,
      formaPago: idx.formaPago >= 0 ? String(r[idx.formaPago] ?? '').trim() : '',
    });
  }
  return rows;
}

/**
 * Valida filas y arma órdenes de pago + resumen de importación.
 * No persiste: el caller aplica upserts.
 */
export function buildSupplierPaymentImport({
  rows = [],
  suppliers = [],
  module = 'excel_manual',
  fileName = '',
}) {
  const payments = [];
  const errors = [];
  const stamp = new Date();
  let totalAmount = 0;

  rows.forEach((row, i) => {
    if (!row.proveedor) {
      errors.push({ line: row.line, message: 'Falta proveedor.' });
      return;
    }
    if (!row.monto || row.monto <= 0) {
      errors.push({ line: row.line, message: `Monto inválido para ${row.proveedor}.` });
      return;
    }
    const matched = matchSupplierByName(suppliers, row.proveedor);
    const number = `OP-IMP-${stamp.getFullYear()}${String(stamp.getMonth() + 1).padStart(2, '0')}${String(stamp.getDate()).padStart(2, '0')}-${String(i + 1).padStart(3, '0')}`;
    const payment = {
      id: `po-imp-${stamp.getTime()}-${i}`,
      number,
      date: row.fecha || stamp.toISOString().slice(0, 10),
      payee: matched ? (matched.legalName || matched.name) : row.proveedor,
      concept: row.descripcion || `Pago importado${row.comprobante ? ` · ${row.comprobante}` : ''}`,
      amount: row.monto,
      status: 'paid',
      paymentMethod: mapPaymentMethodLabel(row.formaPago),
      supplierId: matched?.id || null,
      accessinCode: matched?.accessinCode || '',
      invoiceNumber: row.comprobante || '',
      preparedBy: row.confecciona || '',
      authorizedBy: row.autoriza || '',
      withdrawnBy: row.retira || '',
      paymentMethodLabel: row.formaPago || '',
      importSource: module,
      createdAt: stamp.toISOString(),
    };
    payments.push(payment);
    totalAmount += row.monto;
    if (!matched) {
      errors.push({ line: row.line, message: `Proveedor no encontrado en padrón: ${row.proveedor}` });
    }
  });

  let status = 'completed';
  if (!payments.length) status = 'failed';
  else if (errors.length) status = 'partial';

  const batch = {
    id: `spi-${stamp.getTime()}`,
    importedAt: stamp.toISOString(),
    module,
    moduleLabel: SUPPLIER_PAYMENT_IMPORT_MODULES[module] || module,
    status,
    importedCount: payments.length,
    totalAmount,
    fileName: fileName || '',
    errorCount: errors.length,
    errors,
    paymentIds: payments.map((p) => p.id),
  };

  return { batch, payments, errors };
}

export function supplierPaymentImportHeaders() {
  return PAGOS_HEADERS;
}

export const LISTA_BASE_PAGOS_URL = '/templates/lista-base-pagos-proveedores.xlsx';
export const LISTA_BASE_PAGOS_FILENAME = 'lista-base-pagos-proveedores.xlsx';
