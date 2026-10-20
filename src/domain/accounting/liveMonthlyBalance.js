import { todayISODateAR } from '../../lib/arDate';
import { ACCOUNT_TYPES, DEFAULT_CHART_OF_ACCOUNTS, getAccountById } from './chartOfAccounts';
import {
  compareJournalOldestFirst,
  journalDateKey,
  normalizeLines,
  postedJournalEntries,
} from './journal';
import { journalMonthKey, journalMonthLabel } from './officialJournal';

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function addToMap(map, key, amount) {
  map.set(key, roundMoney((map.get(key) || 0) + amount));
}

function periodBounds(dates) {
  const sorted = dates.filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value)).toSorted();
  return {
    periodFrom: sorted[0] || '',
    periodTo: sorted[sorted.length - 1] || '',
  };
}

function accountLines(byAccount, chart, monthKey, prefix, kind = 'item') {
  return [...byAccount.entries()]
    .map(([accountId, amount]) => ({
      accountId,
      account: getAccountById(chart, accountId),
      amount: roundMoney(amount),
    }))
    .filter((row) => row.account && Math.abs(row.amount) >= 0.005)
    .toSorted((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
    .map((row) => ({
      id: `${monthKey}-${prefix}-${row.accountId}`,
      label: row.account.name,
      amount: row.amount,
      kind,
      accountId: row.accountId,
      detailKind: prefix,
    }));
}

function cashBalanceLines(cashEnd, chart, monthKey) {
  return chart
    .filter((account) => account.isCashAccount)
    .flatMap((account) => {
      const amount = roundMoney(cashEnd.get(account.id) || 0);
      if (Math.abs(amount) < 0.005) return [];
      return [{
        id: `${monthKey}-saldo-${account.id}`,
        label: account.name,
        amount,
        kind: 'item',
        accountId: account.id,
        detailKind: 'cash',
      }];
    });
}

function withTotal(lines, id, label) {
  const amount = roundMoney(lines.reduce((sum, line) => sum + (Number(line.amount) || 0), 0));
  return [...lines, { id, label, amount, kind: 'total' }];
}

function ensureMonth(byMonth, key) {
  let month = byMonth.get(key);
  if (!month) {
    month = {
      key,
      label: journalMonthLabel(key),
      dates: [],
      incomeByAccount: new Map(),
      expenseByAccount: new Map(),
      cashIn: 0,
      cashOut: 0,
      count: 0,
      entries: [],
      entriesThrough: [],
      cashEnd: new Map(),
    };
    byMonth.set(key, month);
  }
  return month;
}

function freezeMonth(month, cashRunning, seen) {
  if (!month) return;
  month.cashEnd = new Map(cashRunning);
  month.entriesThrough = [...seen];
}

export function buildLiveMonthlyBalances(entries = [], chart = [], options = {}) {
  const accounts = chart?.length ? chart : DEFAULT_CHART_OF_ACCOUNTS;
  const today = options.today || todayISODateAR();
  const currentMonth = /^\d{4}-\d{2}/.test(today) ? today.slice(0, 7) : '';
  const posted = postedJournalEntries(entries).toSorted(compareJournalOldestFirst);
  const cashIds = new Set(accounts.filter((account) => account.isCashAccount).map((account) => account.id));
  const byMonth = new Map();
  const cashRunning = new Map();
  const seen = [];
  let previousKey = null;

  for (const entry of posted) {
    const date = journalDateKey(entry);
    const monthKey = journalMonthKey(date || 'sin-fecha');
    if (previousKey && previousKey !== monthKey) {
      freezeMonth(byMonth.get(previousKey), cashRunning, seen);
    }
    const month = ensureMonth(byMonth, monthKey);
    if (date) month.dates.push(date);
    month.count += 1;
    month.entries.push(entry);
    seen.push(entry);

    const lines = normalizeLines(entry.lines || [], accounts);
    for (const line of lines) {
      const account = getAccountById(accounts, line.accountId);
      if (!account) continue;
      const debit = Number(line.debit) || 0;
      const credit = Number(line.credit) || 0;

      if (account.accountType === 'income') {
        addToMap(month.incomeByAccount, account.id, credit - debit);
      }
      if (account.accountType === 'expense') {
        addToMap(month.expenseByAccount, account.id, debit - credit);
      }
      if (cashIds.has(account.id)) {
        const nature = ACCOUNT_TYPES[account.accountType]?.nature ?? 'debit';
        const delta = nature === 'debit' ? debit - credit : credit - debit;
        cashRunning.set(account.id, roundMoney((cashRunning.get(account.id) || 0) + delta));
        month.cashIn = roundMoney(month.cashIn + debit);
        month.cashOut = roundMoney(month.cashOut + credit);
      }
    }
    previousKey = monthKey;
  }
  freezeMonth(byMonth.get(previousKey), cashRunning, seen);

  return [...byMonth.values()]
    .reverse()
    .map((month) => finalizeMonth(month, accounts, currentMonth));
}

function finalizeMonth(month, chart, currentMonth) {
  const { periodFrom, periodTo } = periodBounds(month.dates);
  const incomeLines = accountLines(month.incomeByAccount, chart, month.key, 'ingreso');
  const expenseLines = accountLines(month.expenseByAccount, chart, month.key, 'egreso');
  const cashLines = cashBalanceLines(month.cashEnd, chart, month.key);
  const totalIncome = roundMoney(incomeLines.reduce((sum, line) => sum + line.amount, 0));
  const totalExpenses = roundMoney(expenseLines.reduce((sum, line) => sum + line.amount, 0));
  const cashOnHand = roundMoney(cashLines.reduce((sum, line) => sum + line.amount, 0));
  const resultado = roundMoney(totalIncome - totalExpenses);
  const complete = Boolean(currentMonth && month.key !== 'sin-fecha' && month.key < currentMonth);

  const sections = [];
  if (cashLines.length || month.cashIn || month.cashOut) {
    sections.push({
      id: `${month.key}-caja`,
      title: 'Saldos de caja',
      family: 'cash',
      lines: withTotal(cashLines, `${month.key}-caja-total`, 'Total caja y bancos'),
    });
    sections.push({
      id: `${month.key}-flujo`,
      title: 'Movimiento de caja',
      family: 'cash',
      lines: [
        {
          id: `${month.key}-flujo-in`,
          label: 'Ingresos en caja y bancos',
          amount: month.cashIn,
          kind: 'item',
          detailKind: 'cash-in',
        },
        {
          id: `${month.key}-flujo-out`,
          label: 'Egresos de caja y bancos',
          amount: month.cashOut,
          kind: 'item',
          detailKind: 'cash-out',
        },
      ],
    });
  }
  if (incomeLines.length) {
    sections.push({
      id: `${month.key}-ingresos`,
      title: 'Ingresos',
      family: 'in',
      lines: withTotal(incomeLines, `${month.key}-ingresos-total`, 'Total ingresos'),
    });
  }
  if (expenseLines.length) {
    sections.push({
      id: `${month.key}-egresos`,
      title: 'Egresos',
      family: 'out',
      lines: withTotal(expenseLines, `${month.key}-egresos-total`, 'Total egresos'),
    });
  }
  sections.push({
    id: `${month.key}-totales`,
    title: 'Totales',
    family: 'net',
    lines: [
      { id: `${month.key}-tot-in`, label: 'Ingresos del mes', amount: totalIncome, kind: 'item' },
      { id: `${month.key}-tot-out`, label: 'Egresos del mes', amount: totalExpenses, kind: 'item' },
      { id: `${month.key}-tot-net`, label: 'Resultado del mes', amount: resultado, kind: 'total' },
    ],
  });

  return {
    key: month.key,
    label: month.label,
    periodFrom,
    periodTo,
    complete,
    count: month.count,
    totalIncome,
    totalIncomeCash: month.cashIn,
    totalExpenses,
    cashOut: month.cashOut,
    cashOnHand,
    closingCash: cashOnHand,
    resultado,
    sections,
    entries: month.entries,
    entriesThrough: month.entriesThrough,
  };
}

function lineTouchesCash(line, chart, direction) {
  const account = getAccountById(chart, line.accountId);
  if (!account?.isCashAccount) return false;
  if (direction === 'in') return (Number(line.debit) || 0) > 0;
  if (direction === 'out') return (Number(line.credit) || 0) > 0;
  return true;
}

export function liveMonthlyBalanceDetail(line, chart = []) {
  const entries = line?.entries || [];
  const accountId = line?.accountId;
  const detailKind = line?.detailKind;
  const rows = [];

  for (const entry of entries) {
    const date = journalDateKey(entry);
    const lines = normalizeLines(entry.lines || [], chart);
    const relevant = lines.filter((journalLine) => {
      if (accountId) return journalLine.accountId === accountId;
      if (detailKind === 'cash-in') return lineTouchesCash(journalLine, chart, 'in');
      if (detailKind === 'cash-out') return lineTouchesCash(journalLine, chart, 'out');
      return false;
    });
    for (const journalLine of relevant) {
      rows.push({
        fecha: date,
        glosa: entry.description || 'Asiento',
        debe: Number(journalLine.debit) || 0,
        haber: Number(journalLine.credit) || 0,
      });
    }
  }

  const total = roundMoney(rows.reduce((sum, row) => {
    if (detailKind === 'ingreso' || detailKind === 'cash-in') return sum + row.haber - row.debe;
    if (detailKind === 'egreso' || detailKind === 'cash-out') return sum + row.debe - row.haber;
    return sum + row.debe - row.haber;
  }, 0));

  return {
    title: line?.label || 'Detalle',
    count: rows.length,
    total: line?.amount ?? total,
    columns: [
      { key: 'fecha', label: 'Fecha' },
      { key: 'glosa', label: 'Asiento' },
      { key: 'debe', label: 'Debe', money: true },
      { key: 'haber', label: 'Haber', money: true },
    ],
    rows,
  };
}

export function filterLiveBalanceDetailRows(rows = [], query = '') {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((row) => {
    const hay = `${row.fecha || ''} ${row.glosa || ''}`.toLowerCase();
    return hay.includes(q);
  });
}

function aggregateItemLines(months, matchSection) {
  const byKey = new Map();
  for (const month of months) {
    for (const section of month.sections || []) {
      if (!matchSection(section)) continue;
      for (const line of section.lines || []) {
        if (line.kind !== 'item') continue;
        const key = line.accountId || line.detailKind || line.label;
        const prev = byKey.get(key);
        byKey.set(key, {
          id: `sum-${key}`,
          label: line.label,
          amount: roundMoney((prev?.amount || 0) + (Number(line.amount) || 0)),
          kind: 'item',
          accountId: line.accountId,
        });
      }
    }
  }
  return [...byKey.values()].toSorted((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
}

export function summarizeLiveMonthlyBalances(months = []) {
  if (!months.length) {
    return {
      months: [],
      periodFrom: '',
      periodTo: '',
      complete: false,
      count: 0,
      totalIncome: 0,
      totalIncomeCash: 0,
      totalExpenses: 0,
      cashOnHand: 0,
      closingCash: 0,
      resultado: 0,
      sections: [],
    };
  }
  const newest = months[0] || null;
  const oldest = months[months.length - 1] || null;
  const totalIncome = roundMoney(months.reduce((sum, month) => sum + (Number(month.totalIncome) || 0), 0));
  const totalIncomeCash = roundMoney(months.reduce((sum, month) => sum + (Number(month.totalIncomeCash) || 0), 0));
  const totalExpenses = roundMoney(months.reduce((sum, month) => sum + (Number(month.totalExpenses) || 0), 0));
  const cashIn = totalIncomeCash;
  const cashOut = roundMoney(months.reduce((sum, month) => sum + (Number(month.cashOut) || 0), 0));
  const cashOnHand = newest ? Number(newest.cashOnHand) || 0 : 0;
  const resultado = roundMoney(totalIncome - totalExpenses);
  const cashLines = newest
    ? (newest.sections || []).find((section) => section.id.endsWith('-caja'))?.lines?.filter((line) => line.kind === 'item') || []
    : [];
  const incomeLines = aggregateItemLines(months, (section) => section.family === 'in');
  const expenseLines = aggregateItemLines(months, (section) => section.family === 'out');

  const sections = [];
  if (cashLines.length) {
    sections.push({
      id: 'resumen-caja',
      title: 'Saldos de caja',
      family: 'cash',
      lines: withTotal(
        cashLines.map((line) => ({ ...line, id: `resumen-${line.id}` })),
        'resumen-caja-total',
        'Total caja y bancos',
      ),
    });
  }
  if (cashIn || cashOut) {
    sections.push({
      id: 'resumen-flujo',
      title: 'Movimiento de caja',
      family: 'cash',
      lines: [
        { id: 'resumen-flujo-in', label: 'Ingresos en caja y bancos', amount: cashIn, kind: 'item' },
        { id: 'resumen-flujo-out', label: 'Egresos de caja y bancos', amount: cashOut, kind: 'item' },
      ],
    });
  }
  if (incomeLines.length) {
    sections.push({
      id: 'resumen-ingresos',
      title: 'Ingresos',
      family: 'in',
      lines: withTotal(incomeLines, 'resumen-ingresos-total', 'Total ingresos'),
    });
  }
  if (expenseLines.length) {
    sections.push({
      id: 'resumen-egresos',
      title: 'Egresos',
      family: 'out',
      lines: withTotal(expenseLines, 'resumen-egresos-total', 'Total egresos'),
    });
  }
  sections.push({
    id: 'resumen-totales',
    title: 'Totales',
    family: 'net',
    lines: [
      { id: 'resumen-tot-in', label: 'Ingresos del libro', amount: totalIncome, kind: 'item' },
      { id: 'resumen-tot-out', label: 'Egresos del libro', amount: totalExpenses, kind: 'item' },
      { id: 'resumen-tot-net', label: 'Resultado', amount: resultado, kind: 'total' },
    ],
  });

  return {
    months,
    periodFrom: oldest?.periodFrom || '',
    periodTo: newest?.periodTo || '',
    complete: months.length > 0 && months.every((month) => month.complete),
    count: months.reduce((sum, month) => sum + (Number(month.count) || 0), 0),
    totalIncome,
    totalIncomeCash,
    totalExpenses,
    cashOnHand,
    closingCash: cashOnHand,
    resultado,
    sections,
  };
}

export function buildLiveBalanceSummary(entries = [], chart = [], options = {}) {
  return summarizeLiveMonthlyBalances(buildLiveMonthlyBalances(entries, chart, options));
}
