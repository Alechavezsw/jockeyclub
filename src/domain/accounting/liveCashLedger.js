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
  varios: 'Varios',
};

export function asCobranzaFromOtherIncome(item) {
  if (!item || String(item.status || 'posted').toLowerCase() === 'void') return null;
  const date = isoDate(item.date);
  if (!date) return null;
  const amount = roundMoney(item.amount);
  if (!amount) return null;
  return {
    id: `live-oi-${item.id}`,
    date,
    amount,
    type: OTHER_INCOME_COBRANZA_TYPE[item.group] || 'Varios',
    paymentMethod: item.paymentMethod || 'efectivo',
    paymentMethodLabel: item.paymentMethodLabel || 'Efectivo',
    memberNumber: item.payerType === 'member' ? (item.documentId || '') : '',
    memberName: item.payerName || '',
    concept: item.concept || 'Otro ingreso',
    receiptId: item.documentId || item.id,
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
  return id.startsWith('je-lila-') || id.startsWith('je-liq-') || id.startsWith('je-cash-');
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
    if (!date || (after && date <= after)) return;
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
    .filter((row) => row && row.date && row.date > cutoff);
  const skipJournalIds = new Set(
    appRows.map((row) => row.journalEntryId && String(row.journalEntryId)).filter(Boolean),
  );
  const journalRows = asLedgerRowsFromJournal(journalEntries, chartOfAccounts, {
    afterDate: cutoff,
    skipJournalIds,
  });
  const extra = [...appRows, ...journalRows];
  const ledger = enrichCashMovementsWithMembers(
    mergeAccessinCashMovements(movements, extra),
    members,
  );

  const cashDelta = extra
    .filter((row) => row.walletKind === 'cash')
    .reduce((sum, row) => sum + signedCashAmount(row), 0);
  const bankDelta = extra
    .filter((row) => row.walletKind === 'bank')
    .reduce((sum, row) => sum + signedCashAmount(row), 0);

  const cutoffOnHand = impliedCashOnHand(snapshot, { bankAccounts, cheques });
  const efectivo = roundMoney(cutoffOnHand.efectivo + cashDelta);
  const bancos = roundMoney(cutoffOnHand.bancos + bankDelta);
  const chequesValue = accessinChequesTotal(cheques);
  const total = roundMoney(efectivo + bancos + chequesValue);
  const cobExtras = [
    ...postedJournalEntries(journalEntries)
      .map((entry) => asCobranzaFromJournal(entry, chartOfAccounts, members))
      .filter((row) => row && row.date > cutoff),
    ...(otherIncomes || [])
      .map((item) => asCobranzaFromOtherIncome(item))
      .filter((row) => row && row.date > cutoff),
  ];
  const asOfLabel = formatAccessinCashDate(asOf);

  const cards = accessinCashBalanceCards(snapshot, movements, cheques, bankAccounts).map((card) => {
    if (card.id === 'efectivo') {
      return { ...card, value: efectivo, caption: `Saldo al ${asOfLabel}` };
    }
    if (card.id === 'bancos') {
      return { ...card, value: bancos, caption: `Saldo al ${asOfLabel}` };
    }
    if (card.id === 'cheques') {
      return { ...card, value: chequesValue, caption: `Cartera al ${asOfLabel}` };
    }
    if (card.id === 'total') {
      return { ...card, value: total, caption: `Saldo al ${asOfLabel}` };
    }
    return card;
  });

  return {
    asOf,
    asOfLabel,
    cutoff,
    cutoffLabel: formatAccessinCashDate(cutoff),
    periodFrom: snapshot.periodFrom || '',
    periodFromLabel: formatAccessinCashDate(snapshot.periodFrom),
    extraCount: extra.length,
    extraCobranzasCount: cobExtras.length,
    cobranzas: mergeLiveCobranzas(cobranzas, cobExtras),
    ledger,
    cards,
    sheets: cashMovementMonthSheets(ledger),
    efectivo,
    bancos,
    cheques: chequesValue,
    total,
  };
}
