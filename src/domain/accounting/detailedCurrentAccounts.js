/** Cuentas corrientes detalladas Accessin/LILA (cargos y pagos por línea). */

import { readSnapshot } from '../../data/snapshots';
import { DEFAULT_CHART_OF_ACCOUNTS, getAccountById } from './chartOfAccounts';
import { journalDateKey, normalizeLines, postedJournalEntries } from './journal';
import { memberNumberOf } from '../members/households';
import { money } from '../money';
import { todayISODateAR } from '../../lib/arDate';

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

/** Nº de socio sin ceros a la izquierda. Un uuid no es un número de socio. */
export function detailedCcMemberKey(n) {
  const digits = String(n || '').replace(/\D/g, '');
  if (!digits || digits.length > 8) return '';
  return digits.replace(/^0+/, '') || '0';
}

export function periodLabelFromKey(periodKey) {
  if (!/^\d{4}-\d{2}$/.test(periodKey || '')) return periodKey || '';
  const y = periodKey.slice(0, 4);
  const m = Number(periodKey.slice(5, 7));
  return `${MONTHS_ES[m - 1] || m} del ${y}`;
}

export function lookupDetailedCc(memberNumber, byNumber = detailedCcSeed().ACCESSIN_DETAILED_CC_BY_NUMBER) {
  const key = detailedCcMemberKey(memberNumber) || padMember(memberNumber);
  if (!key || !byNumber) return null;
  return byNumber[key] || byNumber[padMember(memberNumber)] || null;
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

export function periodKeyFromDate(iso) {
  const key = String(iso || '').slice(0, 7);
  return /^\d{4}-\d{2}$/.test(key) ? key : '';
}

/** Socios con cuota del período cargada y todavía adeudada. */
export function listUnpaidFeeMembersForPeriod(
  periodKey,
  byNumber = detailedCcSeed().ACCESSIN_DETAILED_CC_BY_NUMBER,
) {
  const key = periodKeyFromDate(periodKey) || String(periodKey || '');
  if (!/^\d{4}-\d{2}$/.test(key)) return [];

  const rows = [];
  for (const member of Object.values(byNumber || {})) {
    let owed = 0;
    let amount = 0;
    for (const line of member.lines || []) {
      if (line.periodKey !== key) continue;
      if (line.value != null && line.value !== '') {
        const value = Number(line.value) || 0;
        owed += value;
        if (value > 0) amount += value;
        continue;
      }
      const lineOwed = Number(line.owed) || 0;
      if (lineOwed <= 0) continue;
      owed += lineOwed;
      amount += Number(line.amount) || 0;
    }
    owed = money(owed);
    if (owed <= 0) continue;
    rows.push({
      memberNumber: member.memberNumber || '',
      memberName: member.memberName || [member.firstName, member.lastName].filter(Boolean).join(' ') || 'Socio',
      dni: member.dni || '',
      owed,
      amount,
    });
  }
  return rows.toSorted((a, b) => (
    b.owed - a.owed
    || String(a.memberName).localeCompare(String(b.memberName), 'es')
    || String(a.memberNumber).localeCompare(String(b.memberNumber))
  ));
}

const ARCHIVE_BEFORE = '2026-11';
const ROLLED_OCTOBER = 'Saldo al 31 de octubre de 2026';

/** Octubre y lo anterior, para descargar. Noviembre queda en la cuenta que se ve. */
export function detailedCcArchiveRows(
  byNumber = detailedCcSeed().ACCESSIN_DETAILED_CC_BY_NUMBER,
  history = detailedCcSeed().ACCESSIN_DETAILED_CC_HISTORY,
) {
  if (Array.isArray(history) && history.length) {
    return history.map((row) => {
      const [memberNumber, date, type, concept, value] = row;
      const bucket = byNumber?.[memberNumber];
      return {
        memberNumber: String(memberNumber || ''),
        memberName: bucket?.memberName || '',
        date: date || '',
        type: type || '',
        concept: concept || '',
        value: Number(value) || 0,
      };
    });
  }
  const rows = [];
  for (const member of Object.values(byNumber || {})) {
    for (const line of member.lines || []) {
      if (line.concept === ROLLED_OCTOBER) continue;
      const key = line.periodKey || '';
      const date = line.feeDate || '';
      const archived = (key && key < ARCHIVE_BEFORE) || (!key && date && date <= '2026-10-31');
      if (!archived) continue;
      rows.push({
        memberNumber: member.memberNumber || '',
        memberName: member.memberName || '',
        date,
        type: line.type || '',
        concept: line.concept || '',
        value: Number(line.value) || 0,
      });
    }
  }
  return rows;
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
  const key = detailedCcMemberKey(memberNumber) || padMember(memberNumber);
  const bucket = key ? (byNumber[key] || byNumber[padMember(memberNumber)]) : null;
  if (!bucket?.lines?.length) return [];

  const entries = [];
  bucket.lines.forEach((line) => {
    if (line.value != null && line.value !== '') {
      const value = Number(line.value) || 0;
      if (Math.abs(value) < 0.009) return;
      const date = line.feeDate || '';
      const desc = line.concept || periodLabelFromKey(line.periodKey) || line.periodKey || '';
      const isPay = value < 0;
      const isOpening = /saldo anterior/i.test(String(line.type || ''));
      entries.push({
        id: `mae-cc-${line.id}`,
        accessinId: line.id,
        memberNumber: key,
        memberName: bucket.memberName,
        date,
        type: isOpening ? 'saldo' : (isPay ? 'pago' : 'cuota'),
        typeLabel: line.type || (isPay ? 'Pago' : 'Cuota'),
        description: desc,
        value,
        paid: isPay ? Math.abs(value) : 0,
        owed: isPay ? 0 : value,
        source: line.source || 'accessin-cc',
      });
      return;
    }
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

function signedLineValue(line) {
  if (line?.value != null && line.value !== '') return Number(line.value) || 0;
  return (Number(line?.amount) || 0) - (Number(line?.paid) || 0);
}

function accountNameOf(line, chart) {
  if (!Array.isArray(chart)) return String(line?.account || '');
  const account = getAccountById(chart, line?.accountId)
    || chart.find((row) => row.id === line?.accountId || row.name === line?.account);
  return account?.name || String(line?.account || '');
}

function feePeriodMonthKey(period) {
  const year = Number(period?.year);
  const month = Number(period?.month);
  if (!year || !month) return '';
  return `${year}-${String(month).padStart(2, '0')}`;
}

/** La liquidación entra solo si se generó después del corte y nadie la revirtió. */
function feePeriodGeneratedAfterCut(period, cut) {
  if (!period || period.status === 'cancelled' || period.status === 'draft') return false;
  const history = Array.isArray(period.pack?.history) ? period.pack.history : [];
  let on = false;
  for (const row of history) {
    const day = todayISODateAR(row?.at);
    if (!day || day <= cut) continue;
    if (row?.type === 'reverted') on = false;
    else if (row?.type === 'generated' || row?.type === 'auto_generated') on = true;
  }
  if (on) return true;
  const generated = String(period.generatedAt || '').slice(0, 10);
  return generated > cut && (period.status === 'processed' || period.status === 'pending');
}

function memberIndex(members) {
  const byId = new Map();
  const byNumber = new Map();
  for (const member of members || []) {
    const nro = detailedCcMemberKey(member?.memberId || member?.memberNumber);
    if (!nro) continue;
    if (member?.id) byId.set(String(member.id), nro);
    if (!byNumber.has(nro)) byNumber.set(nro, member);
  }
  return { byId, byNumber };
}

function journalMemberKey(entry, index) {
  const raw = entry?.memberNumber || entry?.memberId;
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits && digits.length <= 8) return detailedCcMemberKey(digits);
  const fromId = index.byId.get(String(entry?.memberId || ''));
  if (fromId) return fromId;
  // Tras recargar, el asiento viene de DB sin memberId: se lee del texto Cred. N.
  const text = String(entry?.description || entry?.concept || entry?.memo || '');
  const match = text.match(/\(Cred\.\s*(\d{1,8})(?:\.{3}|…)?\)/i);
  return match ? detailedCcMemberKey(match[1]) : '';
}

function retotalMember(bucket, lines) {
  let totalAmount = 0;
  let totalPaid = 0;
  let totalOwed = 0;
  for (const line of lines) {
    const value = signedLineValue(line);
    totalOwed += value;
    if (value > 0.009) totalAmount += value;
    else if (value < -0.009) totalPaid += -value;
  }
  return {
    ...bucket,
    lines,
    totalAmount: money(totalAmount),
    totalPaid: money(totalPaid),
    totalOwed: money(totalOwed),
  };
}

/**
 * El libro de Lila es la base. Un cobro posterior al corte resta; una anulación
 * o una liquidación de un mes que el libro no trae, suma.
 */
export function applyDetailedCcAppDelta(byNumber, {
  cutDate = '',
  journalEntries = [],
  chartOfAccounts = [],
  feePeriods = [],
  members = [],
} = {}) {
  const cut = String(cutDate || '').slice(0, 10);
  if (!cut || !byNumber) return byNumber || {};
  const chart = Array.isArray(chartOfAccounts) && chartOfAccounts.length
    ? chartOfAccounts
    : DEFAULT_CHART_OF_ACCOUNTS;
  const index = memberIndex(members);
  const extra = new Map();
  const push = (key, line) => {
    if (!key || Math.abs(Number(line.value) || 0) < 0.009) return;
    const list = extra.get(key) || [];
    list.push(line);
    extra.set(key, list);
  };

  for (const entry of postedJournalEntries(journalEntries)) {
    const date = journalDateKey(entry);
    if (!date || date <= cut) continue;
    const key = journalMemberKey(entry, index);
    if (!key) continue;
    let duesNet = 0;
    let reservaNet = 0;
    const entryLines = normalizeLines(entry.lines || [], chart);
    for (const line of entryLines) {
      const name = accountNameOf(line, chart);
      const net = (Number(line.credit) || 0) - (Number(line.debit) || 0);
      if (!net) continue;
      if (/cuotas sociales/i.test(name)) duesNet += net;
      else if (/reservas e instalaciones/i.test(name)) reservaNet += net;
    }
    duesNet = money(duesNet);
    reservaNet = money(reservaNet);
    const concept = String(entry.memo || entry.description || '').trim();
    if (duesNet) {
      const value = money(-duesNet);
      push(key, {
        id: `app-j-${entry.id || date}-cuota`,
        feeDate: date,
        periodKey: date.slice(0, 7),
        type: value < 0 ? 'Pago' : 'Ajuste',
        concept: concept || (value < 0 ? 'Cobro posterior al corte' : 'Anulación posterior al corte'),
        value,
        amount: value > 0 ? value : 0,
        paid: value < 0 ? Math.abs(value) : 0,
        owed: value > 0 ? value : 0,
        source: 'app',
      });
    }
    if (reservaNet) {
      const value = money(-reservaNet);
      push(key, {
        id: `app-j-${entry.id || date}-reserva`,
        feeDate: date,
        periodKey: date.slice(0, 7),
        type: value < 0 ? 'Pago' : 'Reserva de espacio',
        concept: concept || 'Reserva posterior al corte',
        value,
        amount: value > 0 ? value : 0,
        paid: value < 0 ? Math.abs(value) : 0,
        owed: value > 0 ? value : 0,
        source: 'app',
      });
    }
  }

  for (const period of feePeriods || []) {
    const monthKey = feePeriodMonthKey(period);
    if (!monthKey || !feePeriodGeneratedAfterCut(period, cut)) continue;
    const charges = Array.isArray(period.pack?.charges) ? period.pack.charges : [];
    const byMember = new Map();
    for (const charge of charges) {
      const key = detailedCcMemberKey(charge?.memberId || charge?.memberNumber);
      const amount = Number(charge?.addAmount ?? charge?.amount) || 0;
      if (!key || !(amount > 0)) continue;
      const bucket = byNumber[key];
      if ((bucket?.lines || []).some((line) => line.periodKey === monthKey && line.source !== 'app')) continue;
      byMember.set(key, money((byMember.get(key) || 0) + amount));
    }
    for (const [key, amount] of byMember) {
      const dueOn = String(
        charges.find((row) => detailedCcMemberKey(row?.memberId || row?.memberNumber) === key)?.dueOn || '',
      ).slice(0, 10);
      const feeDate = /^\d{4}-\d{2}-\d{2}$/.test(dueOn) ? dueOn : `${monthKey}-10`;
      push(key, {
        id: `app-liq-${period.id || monthKey}-${key}`,
        feeDate,
        periodKey: monthKey,
        type: 'Cuota',
        concept: periodLabelFromKey(monthKey),
        value: amount,
        amount,
        paid: 0,
        owed: amount,
        source: 'app',
      });
    }
  }

  if (!extra.size) return byNumber;
  const next = { ...byNumber };
  for (const [key, lines] of extra) {
    const current = next[key] || {
      memberNumber: key,
      memberName: index.byNumber.get(key)?.name
        || [index.byNumber.get(key)?.firstName, index.byNumber.get(key)?.lastName].filter(Boolean).join(' ')
        || 'Socio',
      firstName: index.byNumber.get(key)?.firstName || '',
      lastName: index.byNumber.get(key)?.lastName || '',
      dni: '',
      socialFee: '',
      feeCategory: '',
      lines: [],
      totalAmount: 0,
      totalPaid: 0,
      totalOwed: 0,
    };
    const merged = [...(current.lines || []), ...lines].toSorted(
      (a, b) => String(a.feeDate).localeCompare(String(b.feeDate)) || String(a.id).localeCompare(String(b.id)),
    );
    next[key] = retotalMember(current, merged);
  }
  return next;
}
