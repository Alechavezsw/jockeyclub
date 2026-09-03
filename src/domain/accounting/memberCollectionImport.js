/** Importación de cobranzas de socios (Excel Manual / lista base LILA). */

export const MEMBER_COLLECTION_ENTITIES = {
  excel_manual: 'Excel Manual',
};

export const MEMBER_COLLECTION_IMPUTATION_ORDERS = {
  chronological: 'Orden cronológico (De lo más antiguo a lo más nuevo según fecha de imputación)',
  reverse: 'Orden inverso (De lo más nuevo a lo más antiguo)',
};

export const MEMBER_COLLECTION_IMPORT_STATUS = {
  completed: 'Finalizado',
  partial: 'Parcial',
  failed: 'Fallido',
  deleted: 'Eliminadas',
};

export const LISTA_BASE_COBRANZAS_URL = '/templates/lista-base-cobranzas-socios.xlsx';
export const LISTA_BASE_COBRANZAS_FILENAME = 'lista-base-cobranzas-socios.xlsx';

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

function padUnidad(v) {
  const s = String(v ?? '').trim();
  if (!s) return '';
  if (/^\d+$/.test(s)) return String(Number(s));
  return s;
}

export function matchMemberByUnidad(members = [], unidad) {
  const key = padUnidad(unidad);
  if (!key) return null;
  const exact = members.find((m) => padUnidad(m.memberId) === key);
  if (exact) return exact;
  const padded = key.padStart(5, '0');
  return members.find((m) => padUnidad(m.memberId).padStart(5, '0') === padded) || null;
}

/** AOA hoja Socios → filas normalizadas. */
export function parseCobranzasSociosSheetRows(aoa = []) {
  if (!Array.isArray(aoa) || !aoa.length) {
    throw new Error('El archivo no tiene la hoja Socios con datos.');
  }
  const headerIdx = aoa.findIndex((r) => {
    if (!r || !r.length) return false;
    const h0 = normHeader(r[0]);
    return h0 === 'UNIDAD' || h0.startsWith('UNIDAD');
  });
  if (headerIdx < 0) {
    throw new Error('No se encontró el encabezado UNIDAD en la hoja Socios.');
  }

  const header = (aoa[headerIdx] || []).map(normHeader);
  const idx = {
    unidad: header.findIndex((h) => h.startsWith('UNIDAD')),
    nombre: header.findIndex((h) => h.includes('NOMBRE')),
    fecha: header.findIndex((h) => h.startsWith('FECHA')),
    monto: header.findIndex((h) => h === 'MONTO' || h.startsWith('MONTO')),
    cbu: header.findIndex((h) => h.includes('CBU')),
    comprobante: header.findIndex((h) => h.includes('COMPROBANTE')),
  };
  if (idx.unidad < 0 || idx.monto < 0) {
    throw new Error('La plantilla debe incluir columnas UNIDAD y MONTO.');
  }

  const rows = [];
  for (let i = headerIdx + 1; i < aoa.length; i += 1) {
    const r = aoa[i];
    if (!r) continue;
    const unidad = padUnidad(r[idx.unidad]);
    const monto = Number(r[idx.monto]) || 0;
    const nombre = idx.nombre >= 0 ? String(r[idx.nombre] ?? '').trim() : '';
    if (!unidad && !monto && !nombre) continue;
    rows.push({
      line: i + 1,
      unidad,
      nombre,
      fecha: excelDateToIso(idx.fecha >= 0 ? r[idx.fecha] : ''),
      monto,
      cbu: idx.cbu >= 0 ? String(r[idx.cbu] ?? '').trim() : '',
      comprobante: idx.comprobante >= 0 ? String(r[idx.comprobante] ?? '').trim() : '',
    });
  }
  return rows;
}

/**
 * Arma pagos importados + resumen de lote.
 * Filas con monto 0 se omiten (lista base vacía).
 */
export function buildMemberCollectionImport({
  rows = [],
  members = [],
  entity = 'excel_manual',
  forceDate = '',
  imputationOrder = 'chronological',
  fileName = '',
}) {
  const payments = [];
  const errors = [];
  const stamp = new Date();
  let totalAmount = 0;

  const payable = (rows || []).filter((r) => (Number(r.monto) || 0) > 0);
  const ordered = imputationOrder === 'reverse'
    ? [...payable].reverse()
    : payable;

  ordered.forEach((row, i) => {
    if (!row.unidad) {
      errors.push({ line: row.line, message: 'Falta UNIDAD (nro. de socio).' });
      return;
    }
    const matched = matchMemberByUnidad(members, row.unidad);
    const date = forceDate || row.fecha || stamp.toISOString().slice(0, 10);
    const payment = {
      id: `mcp-${stamp.getTime()}-${i}`,
      memberId: matched?.memberId || row.unidad,
      memberName: matched?.name || row.nombre || row.unidad,
      date,
      amount: row.monto,
      cbu: row.cbu || '',
      voucher: row.comprobante || '',
      matched: Boolean(matched),
      entity,
      createdAt: stamp.toISOString(),
    };
    payments.push(payment);
    totalAmount += row.monto;
    if (!matched) {
      errors.push({ line: row.line, message: `Socio no encontrado en padrón: ${row.unidad} ${row.nombre || ''}`.trim() });
    }
  });

  let status = 'completed';
  if (!payments.length) status = 'failed';
  else if (errors.length) status = 'partial';

  const batch = {
    id: `mci-${stamp.getTime()}`,
    accessinId: null,
    importedAt: stamp.toISOString(),
    entity,
    entityLabel: MEMBER_COLLECTION_ENTITIES[entity] || entity,
    status,
    importedCount: payments.length,
    totalRows: payable.length,
    totalAmount,
    fileName: fileName || '',
    errorCount: errors.length,
    errors,
    forceDate: forceDate || '',
    imputationOrder,
    paymentIds: payments.map((p) => p.id),
  };

  return { batch, payments, errors };
}

/** Aplica pagos al saldo de socios (reduce outstandingBalance). */
export function applyMemberCollectionPayments(members = [], payments = []) {
  const byId = new Map((members || []).map((m) => [String(m.memberId), m]));
  const next = [...(members || [])];
  const indexById = new Map(next.map((m, i) => [String(m.memberId), i]));

  (payments || []).forEach((p) => {
    if (!p?.matched) return;
    const key = String(p.memberId);
    const idx = indexById.get(key);
    if (idx == null) return;
    const m = next[idx];
    const bal = Number(m.outstandingBalance) || 0;
    const paid = Number(p.amount) || 0;
    next[idx] = {
      ...m,
      outstandingBalance: Math.max(0, Math.round((bal - paid) * 100) / 100),
      lastPaymentDate: p.date || m.lastPaymentDate,
      updatedAt: new Date().toISOString(),
    };
    byId.set(key, next[idx]);
  });

  return next;
}
