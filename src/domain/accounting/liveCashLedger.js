/** Tesorería viva: libro importado + cobros y caja de la app después del corte. */

import { todayISODateAR } from '../../lib/arDate';
import {
  DEFAULT_CHART_OF_ACCOUNTS,
  getAccountById,
  resolveAccountId,
} from './chartOfAccounts';
import { journalDateKey, normalizeLines, postedJournalEntries } from './journal';
import {
  accessinCashBalanceCards,
  accessinChequesTotal,
  cashMovementMonthSheets,
  enrichCashMovementsWithMembers,
  formatAccessinCashDate,
  impliedCashOnHand,
  mergeAccessinCashMovements,
} from './cashLedger';

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function isoDate(value) {
  const raw = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : '';
}

export function signedCashAmount(row) {
  const amount = Number(row?.amount) || 0;
  const type = String(row?.movementType || '').toLowerCase();
  if (type === 'expense' || type === 'transfer_out' || type === 'egreso') {
    return -Math.abs(amount);
  }
  return Math.abs(amount);
}

export function liveCutoffDate(snapshot = {}) {
  return isoDate(snapshot.asOf || snapshot.periodTo);
}

function isTreasuryAccount(account) {
  if (!account) return false;
  if (account.isCashAccount) return true;
  if (account.code === '1.1.03') return true;
  return /banco|caja|mercado pago/i.test(`${account.name || ''} ${account.code || ''}`);
}

export function isMercadoPagoMovement(row) {
  const blob = `${row?.walletName || ''} ${row?.walletId || ''} ${row?.description || ''} ${row?.typeLabel || ''} ${row?.paymentMethod || ''} ${row?.paymentMethodLabel || ''}`;
  return /mercado\s*pago|\bmp\b|wallet-mp/i.test(blob);
}

/** Saldo / inflow de Mercado Pago en el corte Accessin. */
export function mercadoPagoBalanceFromSnapshot(snapshot = {}) {
  const flows = snapshot?.periodInflows || {};
  let sum = 0;
  Object.entries(flows).forEach(([name, value]) => {
    if (/mercado\s*pago/i.test(String(name))) sum += Number(value) || 0;
  });
  return roundMoney(sum);
}

function incomeAmount(row) {
  const type = String(row?.movementType || '').toLowerCase();
  if (type === 'expense' || type === 'transfer_out' || type === 'egreso') return 0;
  return Math.abs(Number(row?.amount) || 0);
}

function emptyPocketInflow(extra = {}) {
  return {
    efectivo: 0,
    mercadopago: 0,
    bancos: 0,
    cheques: 0,
    total: 0,
    count: 0,
    efectivoCount: 0,
    mercadopagoCount: 0,
    bancosCount: 0,
    ...extra,
  };
}

function accumulatePocketInflow(out, row) {
  const amount = incomeAmount(row);
  if (!(amount > 0)) return;
  out.count += 1;
  out.total = roundMoney(out.total + amount);
  const blob = `${row.walletName || ''} ${row.typeLabel || ''} ${row.description || ''}`;
  if (isMercadoPagoMovement(row)) {
    out.mercadopago = roundMoney(out.mercadopago + amount);
    out.mercadopagoCount += 1;
    return;
  }
  if (row.walletKind === 'cash' || /caja|efectivo/i.test(blob)) {
    out.efectivo = roundMoney(out.efectivo + amount);
    out.efectivoCount += 1;
    return;
  }
  out.bancos = roundMoney(out.bancos + amount);
  out.bancosCount += 1;
}

/** Ingresos del día por bolsillo (efectivo / MP / bancos / total). */
export function cashDayInflowSummary(ledger = [], day = '') {
  const date = isoDate(day);
  const out = emptyPocketInflow({ date });
  if (!date) return out;
  for (const row of ledger || []) {
    if (isoDate(row?.date) !== date) continue;
    accumulatePocketInflow(out, row);
  }
  return out;
}

/** Ingresos del mes por bolsillo (solo movimientos del mes, no stock histórico). */
export function cashMonthInflowSummary(ledger = [], monthKey = '') {
  const month = String(monthKey || '').slice(0, 7);
  const out = emptyPocketInflow({ monthKey: month });
  if (!/^\d{4}-\d{2}$/.test(month)) return out;
  for (const row of ledger || []) {
    const date = isoDate(row?.date);
    if (!date || !date.startsWith(month)) continue;
    accumulatePocketInflow(out, row);
  }
  return out;
}

function monthLabelES(monthKey = '') {
  const month = String(monthKey || '').slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) return '';
  const [y, m] = month.split('-').map(Number);
  const raw = new Date(y, m - 1, 1).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
  return raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : month;
}

/** Calendario del mes: ingreso y cantidad por día. */
export function cashIncomeCalendar(ledger = [], monthKey = '') {
  const month = String(monthKey || '').slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) return { monthKey: month, days: [], maxInflow: 0, totalInflow: 0 };
  const byDay = new Map();
  for (const row of ledger || []) {
    const date = isoDate(row?.date);
    if (!date || !date.startsWith(month)) continue;
    const amount = incomeAmount(row);
    if (!(amount > 0)) continue;
    const prev = byDay.get(date) || { date, inflow: 0, count: 0 };
    prev.inflow = roundMoney(prev.inflow + amount);
    prev.count += 1;
    byDay.set(date, prev);
  }
  const [y, m] = month.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const days = [];
  let maxInflow = 0;
  let totalInflow = 0;
  for (let d = 1; d <= daysInMonth; d += 1) {
    const date = `${month}-${String(d).padStart(2, '0')}`;
    const hit = byDay.get(date) || { date, inflow: 0, count: 0 };
    if (hit.inflow > maxInflow) maxInflow = hit.inflow;
    totalInflow = roundMoney(totalInflow + hit.inflow);
    days.push(hit);
  }
  return { monthKey: month, days, maxInflow, totalInflow };
}

function dayInflowCaption(amount, count, asOfLabel) {
  if (!(amount > 0)) return `Hoy sin ingresos · ${asOfLabel}`;
  const money = `$ ${Number(amount).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const movs = count === 1 ? '1 ingreso' : `${count} ingresos`;
  return `Hoy +${money} · ${movs}`;
}

function walletKindForAccount(account) {
  if (!account) return 'cash';
  if (account.code === '1.1.03' || /banco|mercado pago/i.test(account.name || '')) return 'bank';
  return 'cash';
}

function typeLabelFor(movementType) {
  if (movementType === 'expense' || movementType === 'transfer_out') return 'Egreso';
  if (movementType === 'transfer_in') return 'Traspaso';
  return 'Ingreso';
}

export function asLedgerRowFromAppMovement(row, {
  registers = [],
  sessions = [],
  chart = DEFAULT_CHART_OF_ACCOUNTS,
} = {}) {
  if (!row) return null;
  const session = (sessions || []).find((item) => item.id === row.cashSessionId);
  const register = (registers || []).find((item) => item.id === (session?.cashRegisterId || row.cashRegisterId));
  const date = isoDate(row.date || row.createdAt);
  if (!date) return null;
  const account = getAccountById(chart, register?.accountId)
    || getAccountById(DEFAULT_CHART_OF_ACCOUNTS, register?.accountId);
  const walletKind = register?.walletKind || walletKindForAccount(account);
  const movementType = row.movementType || 'income';
  return {
    id: row.id,
    accessinId: null,
    date,
    amount: roundMoney(row.amount),
    movementType,
    typeLabel: typeLabelFor(movementType),
    description: row.concept || 'Movimiento de caja',
    walletKind: walletKind === 'bank' ? 'bank' : 'cash',
    walletName: register?.name || account?.name || (walletKind === 'bank' ? 'Bancos' : 'Efectivo'),
    memberNumber: row.memberId || '',
    memberName: '',
    origin: 'app',
    journalEntryId: row.journalEntryId || null,
  };
}

const COBRANZA_TYPE_BY_SOURCE = {
  cuotas: 'Cuotas',
  pileta: 'Varios',
  eventos: 'Eventos',
};

export function asCobranzaFromJournal(entry, chart = DEFAULT_CHART_OF_ACCOUNTS, members = []) {
  if (!entry || skipImportedJournal(entry)) return null;
  const type = COBRANZA_TYPE_BY_SOURCE[String(entry.sourceModule || '')];
  if (!type) return null;
  const date = journalDateKey(entry);
  if (!date) return null;
  const list = chart?.length ? chart : DEFAULT_CHART_OF_ACCOUNTS;
  const treasury = normalizeLines(entry.lines || [], list).filter((line) => {
    const accountId = resolveAccountId(list, line.accountId) || line.accountId;
    return isTreasuryAccount(getAccountById(list, accountId));
  });
  const amount = roundMoney(treasury.reduce((sum, line) => sum + (Number(line.debit) || 0), 0));
  if (!amount) return null;
  const accountId = resolveAccountId(list, treasury[0].accountId) || treasury[0].accountId;
  const account = getAccountById(list, accountId);
  const bank = walletKindForAccount(account) === 'bank';
  const memberNumber = memberNumberFromEntry(entry);
  const member = (members || []).find((row) => String(row.memberId || '') === memberNumber);
  return {
    id: `live-cob-${entry.id}`,
    date,
    amount,
    type,
    paymentMethod: bank ? 'transferencia' : 'efectivo',
    paymentMethodLabel: bank ? (account?.name || 'Transferencia') : 'Efectivo',
    memberNumber,
    memberName: member?.name || '',
    concept: entry.description || 'Cobro de cuota',
    receiptId: entry.id,
    origin: 'app',
  };
}

const OTHER_INCOME_COBRANZA_TYPE = {
  cuotas: 'Cuotas',
  eventos: 'Eventos',
  porteria: 'Portería',
  varios: 'Varios',
};

export function asCobranzaFromOtherIncome(item) {
  if (!item || String(item.status || 'posted').toLowerCase() === 'void') return null;
  const date = isoDate(item.date);
  if (!date) return null;
  const amount = roundMoney(item.amount);
  if (!amount) return null;
  const porteria = item.group === 'porteria'
    || /porter[ií]a|estacionamiento/i.test(String(item.concept || ''));
  const who = String(item.renderedBy || item.meta?.renderedBy || '').trim();
  const base = item.concept || (porteria ? 'Rendición portería' : 'Otro ingreso');
  const paymentMethod = item.paymentMethod || 'efectivo';
  const paymentMethodLabel = item.paymentMethodLabel
    || (paymentMethod === 'mercadopago' ? 'Mercado Pago' : 'Efectivo');
  const walletKind = walletKindForPaymentMethod(paymentMethod);
  const mp = /mercado\s*pago/i.test(`${paymentMethod} ${paymentMethodLabel}`);
  return {
    id: `live-oi-${item.id}`,
    date,
    amount,
    type: porteria ? 'Portería' : (OTHER_INCOME_COBRANZA_TYPE[item.group] || 'Varios'),
    typeLabel: porteria ? 'RENDICION PORTERIA' : undefined,
    paymentMethod,
    paymentMethodLabel,
    walletKind,
    walletName: mp ? 'Mercado Pago' : (walletKind === 'bank' ? 'Bancos' : 'Efectivo'),
    memberNumber: item.payerType === 'member' ? (item.documentId || '') : '',
    memberName: who || item.payerName || '',
    concept: base,
    description: porteria
      ? [
        who ? `${base} — rindió ${who}` : base,
        String(item.bookNumber || item.meta?.bookNumber || '').trim()
          ? `talonario ${String(item.bookNumber || item.meta?.bookNumber || '').trim()}`
          : '',
        String(item.notes || '').trim(),
      ].filter(Boolean).join(' · ')
      : base,
    group: item.group || null,
    receiptId: item.bookNumber || item.meta?.bookNumber || item.documentId || item.id,
    origin: 'app',
  };
}

export function mergeLiveCobranzas(items = [], extra = []) {
  const byId = new Map((items || []).map((row) => [String(row.id || row.receiptId), row]));
  extra.forEach((row) => {
    const key = String(row.id || row.receiptId);
    if (!byId.has(key)) byId.set(key, row);
  });
  return [...byId.values()].sort((a, b) => {
    const byDate = String(b.date || '').localeCompare(String(a.date || ''));
    if (byDate) return byDate;
    return String(b.receiptId || '').localeCompare(String(a.receiptId || ''));
  });
}

function skipImportedJournal(entry) {
  const id = String(entry?.id || '');
  if (entry?.origin === 'lila') return true;
  if (id.startsWith('je-lila-') || id.startsWith('je-liq-') || id.startsWith('je-cash-')) return true;
  // El lote Excel se lista pago a pago; el asiento global no debe repetirse en el libro.
  const concept = `${entry?.description || ''} ${entry?.concept || ''}`;
  return /importaci[oó]n\s+cobranzas/i.test(concept);
}

function memberDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

/** Huella para no repetir Accessin ↔ débito importado ↔ asiento vivo. */
export function cashLedgerFingerprint(row) {
  const date = isoDate(row?.date);
  const amount = roundMoney(row?.amount);
  if (!date || !(amount > 0)) return '';
  let member = memberDigits(row?.memberNumber);
  if (!member) {
    const fromDesc = String(row?.description || '').match(/Cred\.?\s*(\d+)/i);
    member = fromDesc ? fromDesc[1] : memberDigits(row?.description);
  }
  if (!member) return '';
  return `${date}|${amount}|${member}`;
}

function fingerprintSet(rows = []) {
  const set = new Set();
  for (const row of rows || []) {
    const key = cashLedgerFingerprint(row);
    if (key) set.add(key);
  }
  return set;
}

export function isImportedCollectionPayment(payment) {
  if (!payment || payment.status === 'void' || payment.status === 'cancelled') return false;
  if (String(payment.importSource || '').trim()) return true;
  return /importaci[oó]n|d[eé]bitos?\s+lila|planilla\s+cobranzas/i.test(
    String(payment.paidAtReason || ''),
  );
}

function walletKindForPaymentMethod(method, bankName = '') {
  const raw = `${method || ''} ${bankName || ''}`.toLowerCase();
  if (/efectivo|caja|a[_\s-]?cuenta/.test(raw)) return 'cash';
  if (/transfer|banco|mercado\s*pago|mp\b|d[eé]bit|tarjeta|electr/.test(raw)) return 'bank';
  return 'bank';
}

export function asLedgerRowFromImportedPayment(member, payment) {
  if (!isImportedCollectionPayment(payment)) return null;
  const date = isoDate(payment.date || payment.paidAt);
  const amount = roundMoney(payment.amount);
  if (!date || !(amount > 0)) return null;
  const memberNumber = memberDigits(member?.memberId || member?.member_number);
  const walletKind = walletKindForPaymentMethod(payment.method || payment.methodLabel, payment.bankName);
  const methodLabel = String(payment.methodLabel || payment.method || 'Transferencia').trim() || 'Transferencia';
  const bank = String(payment.bankName || '').trim();
  return {
    id: `live-imp-${payment.id}`,
    accessinId: null,
    date,
    amount,
    movementType: 'income',
    typeLabel: 'Débito',
    description: payment.concept
      || `Débito importado${bank ? ` · ${bank}` : ''} · ${methodLabel}`,
    walletKind,
    walletName: bank || (walletKind === 'bank' ? 'Bancos' : 'Efectivo'),
    memberNumber,
    memberName: member?.name || '',
    origin: 'import',
    importSource: payment.importSource || null,
    paymentId: payment.id,
    journalEntryId: payment.journalEntryId || null,
  };
}

export function asLedgerRowsFromImportedPayments(members = [], { skipFingerprints = new Set() } = {}) {
  const rows = [];
  const seenPay = new Set();
  const seenFp = new Set(skipFingerprints);
  for (const member of members || []) {
    for (const payment of member.paymentHistory || []) {
      const row = asLedgerRowFromImportedPayment(member, payment);
      if (!row) continue;
      const payKey = String(payment.id || '');
      if (payKey && seenPay.has(payKey)) continue;
      const fp = cashLedgerFingerprint(row);
      if (fp && seenFp.has(fp)) continue;
      if (payKey) seenPay.add(payKey);
      if (fp) seenFp.add(fp);
      rows.push(row);
    }
  }
  return rows;
}

export function asCobranzaFromImportedPayment(member, payment) {
  if (!isImportedCollectionPayment(payment)) return null;
  const date = isoDate(payment.date || payment.paidAt);
  const amount = roundMoney(payment.amount);
  if (!date || !(amount > 0)) return null;
  const memberNumber = memberDigits(member?.memberId || member?.member_number);
  const method = String(payment.method || 'transferencia').toLowerCase();
  const bank = String(payment.bankName || '').trim();
  return {
    id: `live-imp-cob-${payment.id}`,
    date,
    amount,
    type: payment.importKind || 'Cuotas',
    paymentMethod: method.includes('efectivo') ? 'efectivo' : 'transferencia',
    paymentMethodLabel: payment.methodLabel
      || (bank ? `Transferencia ${bank}` : (payment.method || 'Transferencia')),
    memberNumber,
    memberName: member?.name || '',
    concept: payment.concept || 'Débito importado',
    bankName: bank || '',
    receiptId: payment.receiptNumber || payment.receipt || payment.id,
    origin: 'import',
    importSource: payment.importSource || null,
  };
}

function memberNumberFromEntry(entry) {
  if (entry?.memberId) return String(entry.memberId);
  const match = String(entry?.description || '').match(/Cred\.?\s*(\d+)/i);
  return match ? match[1] : '';
}

export function asLedgerRowsFromJournal(entries = [], chart = DEFAULT_CHART_OF_ACCOUNTS, {
  afterDate = '',
  skipJournalIds = new Set(),
} = {}) {
  const list = chart?.length ? chart : DEFAULT_CHART_OF_ACCOUNTS;
  const after = isoDate(afterDate);
  const rows = [];
  postedJournalEntries(entries).forEach((entry) => {
    if (skipImportedJournal(entry)) return;
    if (skipJournalIds.has(String(entry.id))) return;
    const date = journalDateKey(entry);
    // Incluir el día del corte: Accessin trae el saldo a esa fecha, pero los cobros
    // de la app del mismo día (después del export) no están en el snapshot.
    if (!date || (after && date < after)) return;
    const source = String(entry.sourceModule || '');
    // Impuestos / otros ingresos también mueven tesorería cuando asientan contra caja o banco.
    if (source && !['cuotas', 'caja', 'gastos', 'pileta', 'eventos', 'otros_ingresos', 'impuestos'].includes(source)) return;
    normalizeLines(entry.lines || [], list).forEach((line) => {
      const accountId = resolveAccountId(list, line.accountId) || line.accountId;
      const account = getAccountById(list, accountId);
      if (!isTreasuryAccount(account)) return;
      const debit = Number(line.debit) || 0;
      const credit = Number(line.credit) || 0;
      const amount = roundMoney(debit || credit);
      if (!amount) return;
      const movementType = debit ? 'income' : 'expense';
      const walletKind = walletKindForAccount(account);
      rows.push({
        id: `live-je-${entry.id}-${account.id}`,
        accessinId: null,
        date,
        amount,
        movementType,
        typeLabel: typeLabelFor(movementType),
        description: entry.description || 'Movimiento de tesorería',
        walletKind,
        walletName: account.name,
        memberNumber: memberNumberFromEntry(entry),
        memberName: '',
        origin: 'app',
        journalEntryId: entry.id,
      });
    });
  });
  return rows;
}

/** Mayor # Accessin/numérico del libro (para seguir la serie). */
export function maxCashMovementNumber(rows = []) {
  let max = 0;
  for (const row of rows || []) {
    const n = Number(row?.accessinId);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max;
}

/**
 * Asigna # correlativos a movimientos vivos/importados sin accessinId,
 * a continuación del último número Accessin. Orden: fecha ASC, luego id.
 */
export function assignCashMovementNumbers(rows = [], { startAfter = null } = {}) {
  const list = (rows || []).map((row) => ({ ...row }));
  let next = Number.isFinite(Number(startAfter)) && Number(startAfter) > 0
    ? Number(startAfter)
    : maxCashMovementNumber(list);
  const pending = list
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => {
      const n = Number(row.accessinId);
      return !Number.isFinite(n) || n <= 0;
    });
  pending.sort((a, b) => {
    const byDate = String(a.row.date || '').localeCompare(String(b.row.date || ''));
    if (byDate) return byDate;
    return String(a.row.id || '').localeCompare(String(b.row.id || ''));
  });
  for (const { row, index } of pending) {
    next += 1;
    list[index] = { ...row, accessinId: next, movementNumber: next };
  }
  return list;
}

export function buildLiveCashLedger({
  snapshot = {},
  movements = [],
  liveMovements = [],
  sessions = [],
  registers = [],
  cheques = [],
  bankAccounts = [],
  journalEntries = [],
  cobranzas = [],
  otherIncomes = [],
  members = [],
  chartOfAccounts = DEFAULT_CHART_OF_ACCOUNTS,
  today = new Date(),
} = {}) {
  const asOf = todayISODateAR(today);
  const cutoff = liveCutoffDate(snapshot) || asOf;
  const appRows = (liveMovements || [])
    .map((row) => asLedgerRowFromAppMovement(row, { registers, sessions, chart: chartOfAccounts }))
    .filter((row) => row && row.date && row.date >= cutoff);
  const skipJournalIds = new Set(
    appRows.map((row) => row.journalEntryId && String(row.journalEntryId)).filter(Boolean),
  );
  const journalRows = asLedgerRowsFromJournal(journalEntries, chartOfAccounts, {
    afterDate: cutoff,
    skipJournalIds,
  });
  // Débitos Excel: se listan en el libro; no pisan Accessin ni asientos ya presentes.
  const skipFp = fingerprintSet([...(movements || []), ...appRows, ...journalRows]);
  const importRows = asLedgerRowsFromImportedPayments(members, { skipFingerprints: skipFp });
  const liveExtra = [...appRows, ...journalRows];
  // Saldo vivo: solo lo posterior al corte. Los débitos ≤ corte ya están en Accessin.
  const balanceExtra = [
    ...liveExtra,
    ...importRows.filter((row) => row.date >= cutoff),
  ];
  const extra = [...liveExtra, ...importRows];
  const merged = enrichCashMovementsWithMembers(
    mergeAccessinCashMovements(movements, extra),
    members,
  );
  const ledger = assignCashMovementNumbers(merged);

  const cashDelta = balanceExtra
    .filter((row) => row.walletKind === 'cash')
    .reduce((sum, row) => sum + signedCashAmount(row), 0);
  const bankDelta = balanceExtra
    .filter((row) => row.walletKind === 'bank')
    .reduce((sum, row) => sum + signedCashAmount(row), 0);

  // Corte Accessin/Lila + movimientos del libro posteriores + app/asientos vivos.
  const base = impliedCashOnHand(snapshot, { bankAccounts, cheques });
  const importedAfter = (movements || []).filter((row) => {
    const date = isoDate(row.date);
    return date && date > cutoff;
  });
  const importedCashDelta = importedAfter
    .filter((row) => row.walletKind === 'cash')
    .reduce((sum, row) => sum + signedCashAmount(row), 0);
  const importedBankDelta = importedAfter
    .filter((row) => row.walletKind === 'bank')
    .reduce((sum, row) => sum + signedCashAmount(row), 0);

  const efectivo = roundMoney(base.efectivo + importedCashDelta + cashDelta);
  const bancosAll = roundMoney(base.bancos + importedBankDelta + bankDelta);
  const mpBase = mercadoPagoBalanceFromSnapshot(snapshot);
  const mpAfterCutoff = [...importedAfter, ...balanceExtra]
    .filter((row) => isMercadoPagoMovement(row))
    .reduce((sum, row) => sum + signedCashAmount(row), 0);
  const mercadopago = roundMoney(mpBase + mpAfterCutoff);
  const bancosSinMp = roundMoney(Math.max(0, bancosAll - mercadopago));
  const chequesValue = accessinChequesTotal(cheques);
  const total = roundMoney(efectivo + bancosAll + chequesValue);
  const monthKey = String(asOf).slice(0, 7);
  const dayInflow = cashDayInflowSummary(ledger, asOf);
  const monthInflow = cashMonthInflowSummary(ledger, monthKey);
  const calendar = cashIncomeCalendar(ledger, monthKey);
  const monthLabel = monthLabelES(monthKey);
  const importCobranzas = [];
  const cobReceipts = new Set(
    (cobranzas || []).map((row) => String(row.receiptId || row.id || '')).filter(Boolean),
  );
  const cobFp = fingerprintSet(cobranzas || []);
  for (const member of members || []) {
    for (const payment of member.paymentHistory || []) {
      const row = asCobranzaFromImportedPayment(member, payment);
      if (!row) continue;
      const receiptKey = String(row.receiptId || '');
      if (receiptKey && cobReceipts.has(receiptKey)) continue;
      const fp = cashLedgerFingerprint(row);
      if (fp && cobFp.has(fp)) continue;
      if (receiptKey) cobReceipts.add(receiptKey);
      if (fp) cobFp.add(fp);
      importCobranzas.push(row);
    }
  }
  const cobExtras = [
    ...postedJournalEntries(journalEntries)
      .map((entry) => asCobranzaFromJournal(entry, chartOfAccounts, members))
      .filter((row) => row && row.date >= cutoff),
    ...(otherIncomes || [])
      .map((item) => asCobranzaFromOtherIncome(item))
      .filter((row) => row && row.date >= cutoff),
    ...importCobranzas,
  ];
  const asOfLabel = formatAccessinCashDate(asOf);

  const cards = [
    {
      id: 'efectivo',
      label: 'Efectivo',
      value: efectivo,
      dayInflow: dayInflow.efectivo,
      dayCount: dayInflow.efectivoCount,
      monthInflow: monthInflow.efectivo,
      monthCount: monthInflow.efectivoCount,
      caption: dayInflowCaption(dayInflow.efectivo, dayInflow.efectivoCount, asOfLabel),
      subcaption: `En el mes · ${monthLabel}`,
      actionLabel: 'Ver registro de efectivo',
      filter: { view: 'efectivo_registro', walletKind: 'cash', onDate: asOf },
      icon: 'cash',
    },
    {
      id: 'mercadopago',
      label: 'Mercado Pago',
      value: mercadopago,
      dayInflow: dayInflow.mercadopago,
      dayCount: dayInflow.mercadopagoCount,
      monthInflow: monthInflow.mercadopago,
      monthCount: monthInflow.mercadopagoCount,
      caption: dayInflowCaption(dayInflow.mercadopago, dayInflow.mercadopagoCount, asOfLabel),
      subcaption: `En el mes · ${monthLabel}`,
      actionLabel: 'Ver Mercado Pago',
      filter: {
        view: 'movements',
        walletKind: 'bank',
        walletMatch: 'mercado\\s*pago|wallet-mp',
        onDate: asOf,
      },
      currencyHint: 'ARS',
      icon: 'mp',
    },
    {
      id: 'cheques',
      label: 'Cheques en Cartera',
      value: chequesValue,
      dayInflow: dayInflow.cheques,
      dayCount: 0,
      monthInflow: monthInflow.cheques,
      monthCount: 0,
      caption: `Cartera al ${asOfLabel}`,
      subcaption: null,
      actionLabel: 'Ver cheques',
      filter: { view: 'cheques' },
      icon: 'checks',
      muted: chequesValue === 0,
      stockIsPortfolio: true,
    },
    {
      id: 'bancos',
      label: 'Cuentas Bancarias',
      value: bancosSinMp,
      dayInflow: dayInflow.bancos,
      dayCount: dayInflow.bancosCount,
      monthInflow: monthInflow.bancos,
      monthCount: monthInflow.bancosCount,
      caption: dayInflowCaption(dayInflow.bancos, dayInflow.bancosCount, asOfLabel),
      subcaption: `En el mes · ${monthLabel}`,
      actionLabel: 'Ver cuentas bancarias',
      filter: { view: 'bank_accounts', walletKind: 'bank' },
      currencyHint: 'ARS',
      icon: 'bank',
    },
    {
      id: 'total',
      label: 'Total Caja',
      value: total,
      dayInflow: dayInflow.total,
      dayCount: dayInflow.count,
      monthInflow: monthInflow.total,
      monthCount: monthInflow.count,
      caption: dayInflowCaption(dayInflow.total, dayInflow.count, asOfLabel),
      subcaption: `En el mes · ${monthLabel}`,
      actionLabel: null,
      filter: { view: 'movements', onDate: asOf },
      emphasize: true,
      icon: 'total',
    },
  ];

  return {
    asOf,
    asOfLabel,
    monthKey,
    monthLabel,
    cutoff,
    cutoffLabel: formatAccessinCashDate(cutoff),
    periodFrom: snapshot.periodFrom || '',
    periodFromLabel: formatAccessinCashDate(snapshot.periodFrom),
    extraCount: liveExtra.length,
    importCount: importRows.length,
    extraCobranzasCount: cobExtras.length - importCobranzas.length,
    cobranzas: mergeLiveCobranzas(cobranzas, cobExtras),
    ledger,
    cards,
    dayInflow,
    monthInflow,
    calendar,
    sheets: cashMovementMonthSheets(ledger),
    efectivo,
    bancos: bancosAll,
    bancosSinMp,
    mercadopago,
    cheques: chequesValue,
    total,
  };
}
