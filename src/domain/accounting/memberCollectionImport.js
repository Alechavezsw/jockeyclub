import { createAccountEntry, padMember } from './accountEntries';
import { memberNumberOf } from '../members/households';
import {
  applyImportedMemberPayment,
  importedCollectionKey,
  revertImportedMemberPayment,
} from '../members/memberPayments';
import { todayAR } from '../../lib/arDate';

/** Importación de cobranzas de socios (Excel Manual o export LILA). */

export const MEMBER_COLLECTION_ENTITIES = {
  excel_manual: 'Excel Manual',
  lila_cobranzas: 'Cobranzas / débitos',
};

/** Tipos de fila del export LILA que se imputan como cuota viva. */
export const LILA_COBRANZAS_DEFAULT_KINDS = Object.freeze(['Cuotas', 'Recargos']);

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

function utcCalendarDay(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function excelDateToIso(v) {
  if (v == null || v === '') return '';
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return utcCalendarDay(v);
  }
  if (typeof v === 'number') {
    const utc = Date.UTC(1899, 11, 30) + Math.round(v * 86400000);
    return utcCalendarDay(new Date(utc));
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

function parseMoneyCell(raw) {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return Math.round(raw * 100) / 100;
  }
  const t = String(raw || '')
    .replace(/\./g, '')
    .replace(',', '.')
    .replace(/[^\d.-]/g, '');
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function findHeaderRow(aoa = [], predicate) {
  return (aoa || []).findIndex((r) => r && r.length && predicate((r || []).map(normHeader)));
}

/** Detecta export LILA (Tipo / ID Recibo / NRO DE SOCIO) vs lista base (UNIDAD / MONTO). */
export function detectCobranzasSheetFormat(aoa = []) {
  const lilaIdx = findHeaderRow(aoa, (h) => {
    const tipo = h.findIndex((x) => x === 'TIPO');
    const socio = h.findIndex((x) => x.includes('NRO') && x.includes('SOCIO'));
    const recibo = h.findIndex((x) => x.includes('RECIBO'));
    return tipo >= 0 && (socio >= 0 || recibo >= 0);
  });
  if (lilaIdx >= 0) return { format: 'lila', headerIdx: lilaIdx };
  const baseIdx = findHeaderRow(aoa, (h) => {
    const h0 = h[0] || '';
    return h0 === 'UNIDAD' || h0.startsWith('UNIDAD') || h0 === 'NRO' || h0.startsWith('NRO');
  });
  if (baseIdx >= 0) return { format: 'lista_base', headerIdx: baseIdx };
  return { format: 'unknown', headerIdx: -1 };
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

/**
 * Export LILA cobranzas: Tipo, ID Recibo, Fecha, Mes, Año, NRO DE SOCIO, …
 * Misma estructura que el Excel de débitos/cobranzas que se importa a mano.
 */
export function parseLilaCobranzasSheetRows(aoa = [], {
  kinds = LILA_COBRANZAS_DEFAULT_KINDS,
  month = null,
  year = null,
} = {}) {
  if (!Array.isArray(aoa) || !aoa.length) {
    throw new Error('El archivo no tiene datos de cobranzas LILA.');
  }
  const detected = detectCobranzasSheetFormat(aoa);
  if (detected.format !== 'lila' || detected.headerIdx < 0) {
    throw new Error('No se encontró el encabezado LILA (Tipo, ID Recibo, NRO DE SOCIO, …).');
  }
  const headerIdx = detected.headerIdx;
  const header = (aoa[headerIdx] || []).map(normHeader);
  const idx = {
    tipo: header.findIndex((h) => h === 'TIPO'),
    recibo: header.findIndex((h) => h.includes('RECIBO') || h === 'ID RECIBO'),
    fecha: header.findIndex((h) => h === 'FECHA' || h.startsWith('FECHA')),
    mes: header.findIndex((h) => h === 'MES'),
    anio: header.findIndex((h) => h === 'ANO' || h === 'AÑO' || h.startsWith('ANIO')),
    socio: header.findIndex((h) => h.includes('NRO') && h.includes('SOCIO')),
    nombre: header.findIndex((h) => h === 'NOMBRE'),
    apellido: header.findIndex((h) => h === 'APELLIDO'),
    dni: header.findIndex((h) => h.includes('DNI') || h.includes('DOCUMENTO')),
    concepto: header.findIndex((h) => h.includes('CONCEPTO')),
    banco: header.findIndex((h) => h === 'BANCO' || h.startsWith('BANCO')),
    importe: header.findIndex((h) => h.includes('IMPORTE') || h === 'TOTAL' || h.includes('TOTAL')),
  };
  if (idx.tipo < 0 || idx.socio < 0 || idx.importe < 0) {
    throw new Error('La planilla LILA debe incluir Tipo, NRO DE SOCIO e Importe total.');
  }

  const kindSet = new Set(
    (kinds || LILA_COBRANZAS_DEFAULT_KINDS).map((k) => String(k || '').trim().toLowerCase()),
  );
  const wantMonth = month != null && month !== '' ? Number(month) : null;
  const wantYear = year != null && year !== '' ? Number(year) : null;
  const rows = [];
  const skipped = { kind: 0, period: 0, empty: 0 };

  for (let i = headerIdx + 1; i < aoa.length; i += 1) {
    const r = aoa[i];
    if (!r) continue;
    const kind = String(r[idx.tipo] ?? '').trim();
    const unidad = padUnidad(r[idx.socio]);
    const monto = parseMoneyCell(r[idx.importe]);
    const nombre = [idx.nombre >= 0 ? r[idx.nombre] : '', idx.apellido >= 0 ? r[idx.apellido] : '']
      .map((p) => String(p ?? '').trim())
      .filter(Boolean)
      .join(' ');
    if (!kind && !unidad && !monto && !nombre) {
      skipped.empty += 1;
      continue;
    }
    if (!kindSet.has(kind.toLowerCase())) {
      skipped.kind += 1;
      continue;
    }
    const rowMonth = idx.mes >= 0 ? Number(r[idx.mes]) : null;
    const rowYear = idx.anio >= 0 ? Number(r[idx.anio]) : null;
    if (wantMonth != null && Number.isFinite(wantMonth) && rowMonth !== wantMonth) {
      skipped.period += 1;
      continue;
    }
    if (wantYear != null && Number.isFinite(wantYear) && rowYear !== wantYear) {
      skipped.period += 1;
      continue;
    }
    if (!unidad || !(monto > 0)) {
      skipped.empty += 1;
      continue;
    }
    rows.push({
      line: i + 1,
      kind,
      unidad,
      dni: idx.dni >= 0 ? padUnidad(r[idx.dni]) : '',
      nombre,
      fecha: excelDateToIso(idx.fecha >= 0 ? r[idx.fecha] : ''),
      monto,
      cbu: '',
      comprobante: idx.recibo >= 0 ? String(r[idx.recibo] ?? '').trim() : '',
      concepto: idx.concepto >= 0 ? String(r[idx.concepto] ?? '').trim() : '',
      banco: idx.banco >= 0 ? String(r[idx.banco] ?? '').trim() : '',
      month: Number.isFinite(rowMonth) ? rowMonth : null,
      year: Number.isFinite(rowYear) ? rowYear : null,
    });
  }

  return { rows, skipped, headerIdx };
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
  paidAtReason = '',
  importSource = '',
  sendReceipts = true,
}) {
  const payments = [];
  const errors = [];
  const seen = new Set();
  const stamp = new Date();
  let totalAmount = 0;
  const index = buildMemberMatchIndex(members);
  const batchId = `mci-${stamp.getTime()}`;
  const sourceKey = String(importSource || batchId).trim() || batchId;

  const payable = (rows || []).filter((r) => (Number(r.monto) || 0) > 0);
  const ordered = sortPayableRows(payable, imputationOrder);

  ordered.forEach((row) => {
    if (!row.unidad && !row.dni) {
      errors.push({ line: row.line, message: 'Falta UNIDAD o DNI (nro. de socio).' });
      return;
    }
    const matched = matchMemberByUnidad(members, row.unidad, index)
      || matchMemberByUnidad(members, row.dni, index);
    const date = forceDate || row.fecha || todayAR(stamp);
    const memberId = matched?.memberId || row.unidad || row.dni;
    const idempotencyKey = importedCollectionKey({
      memberId,
      date,
      amount: row.monto,
      voucher: row.comprobante || '',
      cbu: row.cbu || '',
    });
    if (seen.has(idempotencyKey)) {
      errors.push({ line: row.line, message: 'Cobro repetido en el archivo: ya está en una fila anterior.' });
      return;
    }
    seen.add(idempotencyKey);
    const bankName = String(row.banco || '').trim();
    const concept = String(row.concepto || '').trim() || 'Importación cobranzas socios';
    const payment = {
      id: idempotencyKey,
      idempotencyKey,
      memberId,
      memberName: matched?.name || matched?.fullName || row.nombre || row.unidad,
      date,
      amount: row.monto,
      cbu: row.cbu || '',
      voucher: row.comprobante || '',
      concept,
      bankName,
      method: 'transferencia',
      methodLabel: bankName
        ? `Transferencia bancaria · ${bankName}`
        : 'Transferencia bancaria',
      kind: row.kind || '',
      paidAtReason: String(paidAtReason || '').trim(),
      importSource: sourceKey,
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
    id: batchId,
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
    importSource: sourceKey,
    sendReceipts: sendReceipts !== false,
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
        method: payment.method || 'transferencia',
        methodLabel: payment.methodLabel,
        concept: payment.concept,
        bankName: payment.bankName,
        paidAtReason: payment.paidAtReason,
        importSource: payment.importSource,
        id: payment.id,
      });
      if (result.duplicate) continue;
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
        date: p.date || todayAR(),
        voucher: p.comprobante || p.voucher || '',
        source: 'collection_import',
        description: 'Importación cobranzas socios',
      })];
    } catch {
      return [];
    }
  });
}
