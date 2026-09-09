/** Saldos / resumen de cuenta de socios (Accessin / LILA). */

import { ACCESSIN_COBRANZAS } from '../../data/seed/accessinCobranzas';
import { ACCESSIN_FEE_ACCOUNT_DETAILS } from '../../data/seed/accessinFeeAccountDetails';
import {
  familyPrincipalOf,
  isTitularMember,
  memberNumberOf,
  resolveFamilyForDisplay,
} from '../members/households';
import { getTierDisplayName } from '../members/tiers';
import { currentAccountBalanceOf } from './currentAccountBalances';
import { familyGroupBalanceOf } from './familyGroupBalances';
import { buildDetailedCcAccountEntries } from './detailedCurrentAccounts';

const MONTHS_ES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

export const ACCOUNT_ENTRY_TYPES = [
  { id: 'pago', label: 'Pago' },
  { id: 'cuota', label: 'Cuota' },
  { id: 'recargo', label: 'Recargo de Cuota (FIJO)' },
  { id: 'descuento', label: 'Descuento' },
  { id: 'interes', label: 'Interés' },
  { id: 'otro', label: 'Otros' },
];

function uid(prefix = 'mae') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function padMember(n) {
  return String(n || '').replace(/\D/g, '') || String(n || '');
}

export function memberStatusLabel(member) {
  const s = String(member?.status || '').toLowerCase();
  if (s === 'inactive' || s === 'disabled' || s === 'baja' || s === 'suspended') return 'Inhabilitado';
  if (s === 'pending') return 'Pendiente';
  return 'Habilitado';
}

export function familyBalanceForMember(member, allMembers = []) {
  if (!isTitularMember(member)) {
    return { isTitular: false, label: 'No es titular de un grupo familiar', amount: null };
  }
  const family = resolveFamilyForDisplay(member, allMembers);
  const official = familyGroupBalanceOf(member);
  const adherents = family?.members || [];
  const summed = currentAccountBalanceOf(member)
    + adherents.reduce((s, m) => s + currentAccountBalanceOf(m), 0);
  const groupName = official?.name
    || member.familyGroupName
    || family?.titular?.familyGroupName
    || '';
  return {
    isTitular: true,
    label: groupName || null,
    amount: summed,
    officialAmount: official ? Number(official.total) || 0 : null,
    months: official?.months || [],
    source: 'ledger',
  };
}

export function applyAccountEntryToMember(member, entry) {
  if (!member) return member;
  const delta = Number(entry?.value);
  if (!Number.isFinite(delta)) return member;
  const next = Math.round(((Number(member.outstandingBalance) || 0) + delta) * 100) / 100;
  return {
    ...member,
    outstandingBalance: next,
    lastPaymentDate: entry?.type === 'pago'
      ? (entry.date || new Date().toISOString().slice(0, 10))
      : member.lastPaymentDate,
    updatedAt: new Date().toISOString(),
  };
}

export function applyEntryToMembers(members = [], entry) {
  const nro = padMember(entry?.memberNumber || entry?.memberId);
  if (!nro) return members || [];
  return (members || []).map((m) => (
    padMember(memberNumberOf(m) || m.memberId) === nro
      ? applyAccountEntryToMember(m, entry)
      : m
  ));
}

export function filterMembersForBalances(members = [], filters = {}) {
  const {
    firstName = '',
    lastName = '',
    dni = '',
    memberNumber = '',
    familyId = '',
    status = 'habilitado',
    tier = 'all',
    query = '',
  } = filters;

  const q = String(query || '').trim().toLowerCase();
  const fn = String(firstName || '').trim().toLowerCase();
  const ln = String(lastName || '').trim().toLowerCase();
  const dniQ = String(dni || '').replace(/\D/g, '');
  const nroQ = String(memberNumber || '').replace(/\D/g, '');
  const famQ = String(familyId || '').trim().toLowerCase();

  return (members || []).filter((m) => {
    if (!m) return false;
    const statusLabel = memberStatusLabel(m);
    if (status === 'habilitado' && statusLabel !== 'Habilitado') return false;
    if (status === 'inhabilitado' && statusLabel !== 'Inhabilitado') return false;
    if (tier !== 'all' && String(m.tier || '') !== tier) return false;

    const name = String(m.name || '').toLowerCase();
    const parts = name.split(/\s+/);
    const last = parts[0] || '';
    const first = parts.slice(1).join(' ');

    if (fn && !first.includes(fn) && !name.includes(fn)) return false;
    if (ln && !last.includes(ln) && !name.includes(ln)) return false;
    if (dniQ && !String(m.documentNumber || m.dni || '').replace(/\D/g, '').includes(dniQ)) return false;
    if (nroQ && !padMember(memberNumberOf(m) || m.memberId).includes(nroQ)) return false;
    if (famQ) {
      const fam = String(m.familyGroupName || m.familyPrincipalNumber || '').toLowerCase();
      if (!fam.includes(famQ)) return false;
    }
    if (q) {
      const hay = [
        m.name,
        m.memberId,
        m.documentNumber,
        m.familyGroupName,
        getTierDisplayName(m.tier),
      ].map((x) => String(x || '').toLowerCase()).join(' ');
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function monthKeyFromIso(iso) {
  const s = String(iso || '').slice(0, 7);
  return /^\d{4}-\d{2}$/.test(s) ? s : '';
}

function monthTitle(key) {
  if (!key) return 'Sin fecha';
  const [y, m] = key.split('-').map(Number);
  return `${MONTHS_ES[m - 1] || m} del ${y}`;
}

export function formatSpanishLongDate(iso) {
  if (!iso) return '—';
  try {
    const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
    return `${d} de ${MONTHS_ES[m - 1]} del ${y}`;
  } catch {
    return iso;
  }
}

/** "Julio del 2026" → 2026-07-11 (día típico de recargo fijo Accessin). */
function recargoDateFromConcept(concept, fallbackDate) {
  const text = String(concept || '');
  const m = text.match(/(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\s+del\s+(\d{4})/i);
  if (!m) return fallbackDate || '';
  const idx = MONTHS_ES.findIndex((name) => name.toLowerCase() === m[1].toLowerCase());
  if (idx < 0) return fallbackDate || '';
  return `${m[2]}-${String(idx + 1).padStart(2, '0')}-11`;
}

function receiptPaidTotal(rows = []) {
  const conceptSum = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const first = rows[0] || {};
  const once = Number(first.transferAmount) || Number(first.electronicAmount)
    || Number(first.otherAmount) || Number(first.cashAmount) || Number(first.checkAmount) || 0;
  return once > 0 ? once : conceptSum;
}

/** Entradas Accessin: CC detalladas + cobranzas + detalle de cuotas. */
export function buildAccessinAccountEntries(memberNumber, {
  cobranzas = ACCESSIN_COBRANZAS,
  feeDetails = ACCESSIN_FEE_ACCOUNT_DETAILS,
} = {}) {
  const key = padMember(memberNumber);
  if (!key) return [];
  const entries = [];
  const seen = new Set();
  const ccPeriods = new Set();

  // 1) Fuente preferida: cuentas corrientes detalladas LILA
  buildDetailedCcAccountEntries(key).forEach((e) => {
    if (e?.id) seen.add(e.id);
    if (e?.accessinId) seen.add(`aid-${e.accessinId}`);
    if (e?.type === 'cuota' && e.date) ccPeriods.add(String(e.date).slice(0, 7));
    entries.push(e);
  });

  (feeDetails || []).forEach((acc) => {
    (acc.lines || []).forEach((line, i) => {
      if (padMember(line.memberNumber) !== key) return;
      const period = String(line.feeDate || '').slice(0, 7);
      // Evitar duplicar cuotas del mismo período ya cubiertas por CC detalladas
      if (period && ccPeriods.has(period)) return;
      const id = `mae-fee-${key}-${line.feeDate || i}-${line.amount}-${line.description || ''}`;
      if (seen.has(id)) return;
      seen.add(id);
      entries.push({
        id,
        accessinId: null,
        memberNumber: key,
        memberName: line.memberName,
        date: line.feeDate || line.collectedAt || '',
        type: 'cuota',
        typeLabel: 'Cuota',
        description: line.description || '',
        value: Number(line.amount) || 0,
        source: 'accessin',
      });
    });
  });

  const byReceipt = new Map();
  (cobranzas || []).forEach((row) => {
    if (padMember(row.memberNumber) !== key) return;

    if (String(row.type || '') === 'Recargos') {
      const desc = String(row.concept || '').replace(/^Recargo:\s*/i, '') || '';
      const chargeDate = recargoDateFromConcept(row.concept, row.date);
      const id = `mae-rec-${key}-${desc}-${Number(row.amount) || 0}`;
      if (!seen.has(id)) {
        seen.add(id);
        entries.push({
          id,
          accessinId: null,
          memberNumber: key,
          memberName: row.memberName,
          date: chargeDate,
          type: 'recargo',
          typeLabel: 'Recargo de Cuota (FIJO)',
          description: desc,
          value: Number(row.amount) || 0,
          source: 'accessin',
        });
      }
    }

    const rid = String(row.receiptId || row.id || '');
    if (!byReceipt.has(rid)) byReceipt.set(rid, []);
    byReceipt.get(rid).push(row);
  });

  byReceipt.forEach((rows, rid) => {
    const date = rows[0]?.date || '';
    const paid = receiptPaidTotal(rows);
    if (!(paid > 0)) return;
    // Si el período ya tiene cancelación desde CC detalladas, no duplicar el pago global
    const period = String(date).slice(0, 7);
    if (period && ccPeriods.has(period)) {
      const alreadyPaidInCc = entries.some(
        (e) => e.source === 'accessin-cc' && e.type === 'pago' && String(e.date).slice(0, 7) === period
      );
      if (alreadyPaidInCc) return;
    }
    const concepts = rows.map((r) => r.concept).filter(Boolean).join(' · ');
    const id = `mae-pay-${rid || date}`;
    if (seen.has(id)) return;
    seen.add(id);
    const descLower = concepts.toLowerCase();
    entries.push({
      id,
      accessinId: Number(String(rid).replace(/\D/g, '')) || null,
      memberNumber: key,
      memberName: rows[0]?.memberName || '',
      date,
      type: 'pago',
      typeLabel: 'Pago',
      description: descLower.includes('orden') || descLower.includes('app')
        ? concepts
        : (rows.length > 1 ? '' : concepts),
      value: -Math.abs(paid),
      paymentMethods: [{
        method: rows[0]?.paymentMethodLabel || rows[0]?.paymentMethod || 'Pago',
        reference: rid,
        amount: Math.abs(paid),
      }],
      allocations: rows.map((r) => ({
        date: r.date,
        type: r.type === 'Recargos' ? 'Recargo de Cuota (FIJO)' : (r.type === 'Cuotas' ? 'Cuota' : r.type),
        description: String(r.concept || '').replace(/^Recargo:\s*/i, ''),
        amount: Number(r.amount) || 0,
        cancelled: Number(r.amount) || 0,
      })),
      source: 'accessin',
    });
  });

  return entries.toSorted((a, b) => String(a.date).localeCompare(String(b.date)) || a.id.localeCompare(b.id));
}

export function mergeAccountEntries(accessinEntries = [], localEntries = [], memberNumber) {
  const key = padMember(memberNumber);
  const local = (localEntries || []).filter((e) => padMember(e.memberNumber) === key && e.isActive !== false);
  const byId = new Map();
  [...accessinEntries, ...local].forEach((e) => {
    if (e?.id) byId.set(e.id, e);
  });
  return [...byId.values()].toSorted((a, b) => String(a.date).localeCompare(String(b.date)) || a.id.localeCompare(b.id));
}

/** Agrupa entradas por mes con saldo inicial del mes. */
export function groupEntriesByMonth(entries = [], { monthsBack = 3 } = {}) {
  const sorted = [...(entries || [])].toSorted((a, b) => String(a.date).localeCompare(String(b.date)));
  const byMonth = new Map();
  sorted.forEach((e) => {
    const key = monthKeyFromIso(e.date);
    if (!key) return;
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key).push(e);
  });

  const keys = [...byMonth.keys()].toSorted();
  const recent = monthsBack > 0 ? keys.slice(-monthsBack) : keys;
  let running = 0;
  // compute opening for first shown month
  for (const key of keys) {
    if (recent.includes(key)) break;
    (byMonth.get(key) || []).forEach((e) => { running += Number(e.value) || 0; });
  }

  return recent.map((key) => {
    const opening = running;
    const rows = byMonth.get(key) || [];
    rows.forEach((e) => { running += Number(e.value) || 0; });
    const [y, m] = key.split('-').map(Number);
    return {
      key,
      title: monthTitle(key),
      openingLabel: `Saldo al 01 de ${MONTHS_ES[m - 1]} del ${y}`,
      openingBalance: opening,
      entries: rows,
      closingBalance: running,
    };
  });
}

export function createAccountEntry(input = {}) {
  const type = ACCOUNT_ENTRY_TYPES.some((t) => t.id === input.type) ? input.type : 'pago';
  const typeLabel = ACCOUNT_ENTRY_TYPES.find((t) => t.id === type)?.label || type;
  const memberNumber = padMember(input.memberNumber || input.memberId);
  if (!memberNumber) throw new Error('Indicá el socio.');
  const rawValue = Number(input.value);
  if (!Number.isFinite(rawValue)) throw new Error('El valor es obligatorio.');
  const value = type === 'pago' ? -Math.abs(rawValue) : Math.abs(rawValue);
  return {
    id: input.id || uid('mae'),
    accessinId: input.accessinId || null,
    memberNumber,
    memberName: String(input.memberName || '').trim(),
    date: input.date || new Date().toISOString().slice(0, 10),
    type,
    typeLabel,
    description: String(input.description || '').trim(),
    value,
    voucher: String(input.voucher || '').trim(),
    paymentMethods: input.paymentMethods || [],
    allocations: input.allocations || [],
    isActive: input.isActive !== false,
    source: input.source || 'manual',
    createdAt: input.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function upsertAccountEntry(list = [], input = {}) {
  const existing = (list || []).find((e) => e.id === input.id) || null;
  const next = createAccountEntry({
    ...existing,
    ...input,
    id: existing?.id || input.id,
    createdAt: existing?.createdAt,
    source: existing?.source || input.source || 'manual',
  });
  if (existing) return (list || []).map((e) => (e.id === existing.id ? next : e));
  return [next, ...(list || [])];
}

export function softDeleteAccountEntry(list = [], id) {
  return (list || []).map((e) => (
    e.id === id ? { ...e, isActive: false, updatedAt: new Date().toISOString() } : e
  ));
}

export function buildPaymentBoleto(member, {
  periodLabel = '',
  amount = 0,
  dueDate1 = '',
  dueDate2 = '',
  surcharge = 0,
  lineId = null,
} = {}) {
  const nro = memberNumberOf(member) || '';
  const fee = Number(amount) || Number(member?.outstandingBalance) || 0;
  return {
    number: `025${String(nro).padStart(5, '0')}${String(Date.now()).slice(-2)}`,
    periodLabel: periodLabel || 'Liquidación',
    memberNumber: nro,
    memberName: member?.name || '',
    tierLabel: getTierDisplayName(member?.tier),
    familyGroupName: member?.familyGroupName || '',
    clubName: 'JOCKEY CLUB SAN JUAN',
    lines: [{
      id: lineId || '1',
      memberName: member?.name || '',
      identifier: getTierDisplayName(member?.tier),
      amount: fee,
      description: periodLabel ? `Cuota ${periodLabel}` : 'Cuota',
      date: dueDate1 || new Date().toISOString().slice(0, 10),
      cancelled: 0,
    }],
    total: fee,
    creditBalance: 0,
    totalToPay: fee,
    dueDate1,
    dueAmount1: fee,
    dueDate2,
    dueAmount2: fee + (Number(surcharge) || 0),
    surchargeNote: surcharge
      ? `$ ${Number(surcharge).toLocaleString('es-AR')} si se abona luego de ${dueDate1}`
      : '',
  };
}

export function accountSummaryMeta(member, allMembers = []) {
  const family = resolveFamilyForDisplay(member, allMembers);
  const adherents = (family?.members || [])
    .filter((m) => memberNumberOf(m) !== memberNumberOf(member))
    .map((m) => m.name)
    .filter(Boolean);
  const principal = familyPrincipalOf(member);
  const groupName = member?.familyGroupName
    || (isTitularMember(member) && (family?.members || []).length
      ? `GF - ${(member.name || '').split(/\s+/).slice(-1)[0] || 'Grupo'} ${memberNumberOf(member)}`
      : (principal ? `GF - ${principal}` : ''));
  return {
    memberNumber: memberNumberOf(member),
    memberName: member?.name || '',
    tierLabel: getTierDisplayName(member?.tier),
    familyGroupName: groupName,
    isTitular: isTitularMember(member),
    responsibleName: family?.titular?.name || member?.name || '',
    adherentNames: adherents,
  };
}

export { monthTitle };
