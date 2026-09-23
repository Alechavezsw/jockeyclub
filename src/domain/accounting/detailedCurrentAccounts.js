/** Cuentas corrientes detalladas Accessin/LILA (cargos y pagos por línea). */

import { readSnapshot } from '../../data/snapshots';
import { memberNumberOf } from '../members/households';

const EMPTY_DETAILED_CC_SEED = Object.freeze({
  ACCESSIN_DETAILED_CC_AS_OF: '',
  ACCESSIN_DETAILED_CC_BY_NUMBER: {},
  ACCESSIN_DETAILED_CC_SNAPSHOT: {},
});

/** Snapshot `accessinDetailedCurrentAccounts`; vacío hasta que carga (ver data/snapshots). */
export function detailedCcSeed() {
  return readSnapshot('accessinDetailedCurrentAccounts', EMPTY_DETAILED_CC_SEED);
}

const MONTHS_ES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

function padMember(n) {
  return String(n || '').replace(/\D/g, '') || '';
}

export function periodLabelFromKey(periodKey) {
  if (!/^\d{4}-\d{2}$/.test(periodKey || '')) return periodKey || '';
  const y = periodKey.slice(0, 4);
  const m = Number(periodKey.slice(5, 7));
  return `${MONTHS_ES[m - 1] || m} del ${y}`;
}

export function lookupDetailedCc(memberNumber) {
  const key = padMember(memberNumber);
  if (!key) return null;
  return detailedCcSeed().ACCESSIN_DETAILED_CC_BY_NUMBER[key] || null;
}

export function detailedCcForMember(member) {
  return lookupDetailedCc(memberNumberOf(member) || member?.memberId);
}

export function listDetailedCcMembers({
  byNumber = detailedCcSeed().ACCESSIN_DETAILED_CC_BY_NUMBER,
  query = '',
  onlyUnpaid = false,
  periodKey = 'all',
} = {}) {
  const q = String(query || '').trim().toLowerCase();
  const qDigits = q.replace(/\D/g, '');
  return Object.values(byNumber || {})
    .filter((m) => {
      if (onlyUnpaid && !(Number(m.totalOwed) > 0)) return false;
      if (periodKey && periodKey !== 'all') {
        if (!(m.lines || []).some((l) => l.periodKey === periodKey)) return false;
      }
      if (!q) return true;
      const hay = [m.memberName, m.firstName, m.lastName, m.memberNumber, m.dni, m.socialFee]
        .map((x) => String(x || '').toLowerCase()).join(' ');
      if (hay.includes(q)) return true;
      if (qDigits && String(m.memberNumber || '').includes(qDigits)) return true;
      if (qDigits && String(m.dni || '').includes(qDigits)) return true;
      return false;
    })
    .toSorted((a, b) => (Number(b.totalOwed) || 0) - (Number(a.totalOwed) || 0)
      || (Number(b.totalAmount) || 0) - (Number(a.totalAmount) || 0)
      || String(a.memberNumber).localeCompare(String(b.memberNumber)));
}

export function listDetailedCcPeriods(byNumber = detailedCcSeed().ACCESSIN_DETAILED_CC_BY_NUMBER) {
  const set = new Set();
  Object.values(byNumber || {}).forEach((m) => {
    (m.lines || []).forEach((l) => { if (l.periodKey) set.add(l.periodKey); });
  });
  return [...set].toSorted().map((periodKey) => ({
    periodKey,
    periodLabel: periodLabelFromKey(periodKey),
  }));
}

/**
 * Convierte líneas CC detalladas en entradas de resumen de cuenta
 * (cuota positiva + pago negativo cuando hubo cancelación).
 */
export function buildDetailedCcAccountEntries(memberNumber, {
  byNumber = detailedCcSeed().ACCESSIN_DETAILED_CC_BY_NUMBER,
} = {}) {
  const key = padMember(memberNumber);
  const bucket = key ? byNumber[key] : null;
  if (!bucket?.lines?.length) return [];

  const entries = [];
  bucket.lines.forEach((line) => {
    const amount = Number(line.amount) || 0;
    const paid = Number(line.paid) || 0;
    const date = line.feeDate || '';
    const desc = periodLabelFromKey(line.periodKey) || line.periodKey || '';

    if (amount > 0 || amount === 0) {
      entries.push({
        id: `mae-cc-cuota-${line.id}`,
        accessinId: line.id,
        memberNumber: key,
        memberName: bucket.memberName,
        date,
        type: 'cuota',
        typeLabel: 'Cuota',
        description: desc,
        value: amount,
        paid,
        owed: Number(line.owed) || Math.max(0, amount - paid),
        source: 'accessin-cc',
      });
    }

    if (paid > 0) {
      entries.push({
        id: `mae-cc-pago-${line.id}`,
        accessinId: line.id,
        memberNumber: key,
        memberName: bucket.memberName,
        date,
        type: 'pago',
        typeLabel: 'Pago',
        description: desc ? `Cancelación ${desc}` : 'Pago',
        value: -Math.abs(paid),
        allocations: [{
          date,
          type: 'Cuota',
          description: desc,
          amount,
          cancelled: paid,
        }],
        paymentMethods: [],
        source: 'accessin-cc',
      });
    }
  });

  return entries.toSorted((a, b) => String(a.date).localeCompare(String(b.date)) || a.id.localeCompare(b.id));
}
