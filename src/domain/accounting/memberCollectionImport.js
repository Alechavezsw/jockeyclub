import { createAccountEntry, padMember } from './accountEntries';
import { memberNumberOf } from '../members/households';
import {
  applyImportedMemberPayment,
  revertImportedMemberPayment,
} from '../members/memberPayments';

/** Importación de cobranzas de socios (Excel Manual). */

export const MEMBER_COLLECTION_ENTITIES = {
  excel_manual: 'Excel Manual',
};

export const MEMBER_COLLECTION_IMPUTATION_ORDERS = {
  chronological: 'Deuda más antigua primero',
  reverse: 'Pago más reciente primero',
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
  const digits = String(v ?? '').replace(/\D/g, '');
  if (digits) return String(Number(digits));
  return String(v ?? '').trim();
}

function clubNumber(member) {
  const digits = padMember(memberNumberOf(member) || member?.memberId);
  if (!digits) return '';
  if (digits.length >= 5) return digits;
  return digits.padStart(5, '0');
}

function memberLookupKeys(member) {
  const keys = new Set();
  const nro = memberNumberOf(member);
  if (nro) {
    keys.add(nro);
    keys.add(nro.replace(/^0+/, '') || nro);
    keys.add(nro.padStart(5, '0'));
  }
  const club = clubNumber(member);
  if (club) keys.add(club);
  const dni = String(member?.documentNumber || member?.dni || '').replace(/\D/g, '');
  if (dni) keys.add(dni);
  return keys;
}

export function buildMemberMatchIndex(members = []) {
  const byKey = new Map();
  for (const member of members || []) {
    for (const key of memberLookupKeys(member)) {
      if (!byKey.has(key)) byKey.set(key, member);
    }
  }
  return byKey;
}

export function matchMemberByUnidad(members = [], unidad, index) {
  const key = padUnidad(unidad);
  if (!key) return null;
  const map = index || buildMemberMatchIndex(members);
  return map.get(key)
    || map.get(key.replace(/^0+/, '') || key)
    || map.get(key.padStart(5, '0'))
    || null;
}

/** AOA hoja Socios → filas normalizadas. */
export function parseCobranzasSociosSheetRows(aoa = []) {
  if (!Array.isArray(aoa) || !aoa.length) {
    throw new Error('El archivo no tiene la hoja Socios con datos.');
  }
  const headerIdx = aoa.findIndex((r) => {
    if (!r || !r.length) return false;
    const h0 = normHeader(r[0]);
    return h0 === 'UNIDAD' || h0.startsWith('UNIDAD') || h0 === 'NRO' || h0.startsWith('NRO');
  });
  if (headerIdx < 0) {
    throw new Error('No se encontró el encabezado UNIDAD en la hoja Socios.');
  }

  const header = (aoa[headerIdx] || []).map(normHeader);
  const idx = {
    unidad: header.findIndex((h) => h.startsWith('UNIDAD') || h === 'NRO' || h.startsWith('NRO ')),
    nombre: header.findIndex((h) => h.includes('NOMBRE')),
    fecha: header.findIndex((h) => h.startsWith('FECHA')),
    monto: header.findIndex((h) => h === 'MONTO' || h.startsWith('MONTO')),
    cbu: header.findIndex((h) => h.includes('CBU')),
    comprobante: header.findIndex((h) => h.includes('COMPROBANTE')),
    dni: header.findIndex((h) => h.includes('DNI') || h.includes('DOCUMENTO')),
  };
  if (idx.unidad < 0 || idx.monto < 0) {
    throw new Error('La plantilla debe incluir columnas UNIDAD y MONTO.');
  }

  const rows = [];
  for (let i = headerIdx + 1; i < aoa.length; i += 1) {
    const r = aoa[i];
    if (!r) continue;
    const unidad = padUnidad(r[idx.unidad]);
    const dni = idx.dni >= 0 ? padUnidad(r[idx.dni]) : '';
    const monto = Number(r[idx.monto]) || 0;
    const nombre = idx.nombre >= 0 ? String(r[idx.nombre] ?? '').trim() : '';
    if (!unidad && !dni && !monto && !nombre) continue;
    rows.push({
      line: i + 1,
      unidad: unidad || dni,
      dni,
      nombre,
      fecha: excelDateToIso(idx.fecha >= 0 ? r[idx.fecha] : ''),
      monto,
      cbu: idx.cbu >= 0 ? String(r[idx.cbu] ?? '').trim() : '',
      comprobante: idx.comprobante >= 0 ? String(r[idx.comprobante] ?? '').trim() : '',
    });
  }
  return rows;
}

function sortPayableRows(rows, imputationOrder) {
  const dir = imputationOrder === 'reverse' ? -1 : 1;
  return [...(rows || [])].toSorted((a, b) => {
    const da = String(a.fecha || '');
    const db = String(b.fecha || '');
    if (da !== db) return da.localeCompare(db) * dir;
    return (a.line || 0) - (b.line || 0);
  });
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
  const index = buildMemberMatchIndex(members);

  const payable = (rows || []).filter((r) => (Number(r.monto) || 0) > 0);
  const ordered = sortPayableRows(payable, imputationOrder);

  ordered.forEach((row, i) => {
    if (!row.unidad && !row.dni) {
      errors.push({ line: row.line, message: 'Falta UNIDAD o DNI (nro. de socio).' });
      return;
    }
    const matched = matchMemberByUnidad(members, row.unidad, index)
      || matchMemberByUnidad(members, row.dni, index);
    const date = forceDate || row.fecha || stamp.toISOString().slice(0, 10);
    const payment = {
      id: `mcp-${stamp.getTime()}-${i}`,
      memberId: matched?.memberId || row.unidad || row.dni,
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
      errors.push({
        line: row.line,
        message: `Socio no encontrado en padrón: ${row.unidad || row.dni} ${row.nombre || ''}`.trim(),
      });
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
    applied: [],
  };

  return { batch, payments, errors };
}

/** Aplica pagos al padrón vivo (saldo, vencimiento, historial, crédito). */
export function applyMemberCollectionPayments(members = [], payments = []) {
  const next = [...(members || [])];
  const indexById = new Map(next.map((m, i) => [String(m.memberId), i]));
  const applied = [];
  const ledgerEntries = [];
  let fullyPaidCount = 0;
  let creditCount = 0;

  for (const payment of payments || []) {
    if (!payment?.matched) continue;
    const idx = indexById.get(String(payment.memberId));
    if (idx == null) continue;
    try {
      const result = applyImportedMemberPayment(next[idx], {
        amount: payment.amount,
        date: payment.date,
        voucher: payment.voucher,
        method: 'transferencia',
        id: payment.id,
      });
      next[idx] = result.member;
      applied.push({
        paymentId: result.payment.id,
        memberId: result.member.memberId,
        amount: result.payment.amount,
        date: result.payment.date,
        fullyPaid: result.fullyPaid,
        credit: result.credit,
        outstandingBalance: result.before.outstandingBalance,
        lastPaymentDate: result.before.lastPaymentDate,
        nextDueDate: result.before.nextDueDate,
        overdueSince: result.before.overdueSince,
      });
      ledgerEntries.push(result.ledgerEntry);
      if (result.fullyPaid) fullyPaidCount += 1;
      if (result.credit) creditCount += 1;
    } catch {
      /* fila inválida: no corta el lote */
    }
  }

  return { members: next, applied, ledgerEntries, fullyPaidCount, creditCount };
}

export function revertMemberCollectionPayments(members = [], applied = []) {
  const next = [...(members || [])];
  const indexById = new Map(next.map((m, i) => [String(m.memberId), i]));
  for (const snapshot of [...(applied || [])].toReversed()) {
    const idx = indexById.get(String(snapshot.memberId));
    if (idx == null) continue;
    next[idx] = revertImportedMemberPayment(next[idx], snapshot);
  }
  return next;
}

export function collectionPaymentsToEntries(payments = [], ledgerEntries = []) {
  if (Array.isArray(ledgerEntries) && ledgerEntries.length) return ledgerEntries;
  return (payments || []).flatMap((p) => {
    if (!p?.matched || !(Number(p.amount) > 0)) return [];
    try {
      return [createAccountEntry({
        id: p.id,
        type: 'pago',
        memberNumber: p.memberId,
        memberName: p.nombre || p.memberName || '',
        value: p.amount,
        date: p.date || new Date().toISOString().slice(0, 10),
        voucher: p.comprobante || p.voucher || '',
        source: 'collection_import',
        description: 'Importación cobranzas socios',
      })];
    } catch {
      return [];
    }
  });
}
