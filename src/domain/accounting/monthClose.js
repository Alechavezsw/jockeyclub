/** Informe de cierre de un mes: resultado, caja, recaudado y liquidación. */

import { DEFAULT_CHART_OF_ACCOUNTS } from './chartOfAccounts';
import { splitMonthDuesCollection } from './cashPaymentDetail';
import { feePackForPeriod } from './feePackConcepts';
import { buildLiveMonthlyBalances } from './liveMonthlyBalance';
import { journalMonthLabel } from './officialJournal';
import { formatISODateLongAR, todayISODateAR } from '../../lib/arDate';

const LIQUIDATION_NOTE = 'El total del paquete es la cuota cargada en las cuentas. El recargo del 10 % no está adentro. No tiene que coincidir con «expensas imputadas en cuentas corrientes».';

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function pesos(value) {
  return `$ ${roundMoney(value).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function monthKeyOf(today) {
  const iso = todayISODateAR(today instanceof Date ? today : new Date(`${String(today).slice(0, 10)}T12:00:00`));
  return iso.slice(0, 7);
}

function cashLinesOf(month, chart) {
  const section = (month?.sections || []).find((row) => String(row.id || '').endsWith('-caja'));
  const posted = new Map(
    (section?.lines || [])
      .filter((line) => line.kind === 'item')
      .map((line) => [line.label, roundMoney(line.amount)]),
  );
  return (chart || [])
    .filter((account) => account.isCashAccount && account.isPostable !== false && account.isActive !== false)
    .map((account) => ({
      label: account.name,
      amount: posted.get(account.name) || 0,
      bank: /banco naci[oó]n/i.test(account.name),
    }));
}

function itemLines(month, family) {
  const section = (month?.sections || []).find((row) => row.family === family && !String(row.id || '').endsWith('-caja') && !String(row.id || '').endsWith('-flujo'));
  return (section?.lines || [])
    .filter((line) => line.kind === 'item')
    .map((line) => ({ label: line.label, amount: roundMoney(line.amount) }));
}

function periodForMonth(feePeriods, monthKey) {
  const [year, month] = String(monthKey || '').split('-').map(Number);
  if (!year || !month) return null;
  return (feePeriods || []).find((period) => Number(period.year) === year && Number(period.month) === month) || null;
}

function liquidationOf(period) {
  if (!period) {
    return {
      status: 'missing',
      statusLabel: 'Sin período',
      packTotal: 0,
      concepts: [],
      zeroCategories: 0,
      note: LIQUIDATION_NOTE,
    };
  }
  const pack = feePackForPeriod(period);
  const concepts = (pack?.concepts || [])
    .map((row) => ({
      label: row.label || row.name || 'Categoría',
      holders: Number(row.holders) || 0,
      unit: roundMoney(row.amount ?? row.unit),
      total: roundMoney(row.total),
    }));
  const charged = concepts.filter((row) => Math.abs(row.total) >= 0.005);
  const status = period.status === 'processed'
    ? 'processed'
    : period.status === 'cancelled'
      ? 'cancelled'
      : 'draft';
  const statusLabel = status === 'processed'
    ? 'Liquidado'
    : status === 'cancelled'
      ? 'Anulado'
      : 'Borrador';
  return {
    status,
    statusLabel,
    packTotal: roundMoney(pack?.total ?? period.amount),
    concepts: charged,
    zeroCategories: concepts.length - charged.length,
    note: LIQUIDATION_NOTE,
  };
}

function cutoffDate(monthKey) {
  const [year, month] = String(monthKey || '').split('-').map(Number);
  if (!year || !month) return '';
  const day = new Date(year, month, 0).getDate();
  return `${monthKey}-${String(day).padStart(2, '0')}`;
}

function nextMonthKey(monthKey) {
  const [year, month] = String(monthKey || '').split('-').map(Number);
  if (!year || !month) return '';
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  return `${nextYear}-${String(nextMonth).padStart(2, '0')}`;
}

const METHOD_LABELS = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  mercadopago: 'Mercado Pago',
  tarjeta: 'Tarjeta',
  debito: 'Débito',
  cheque: 'Cheque',
};

function methodLabel(row) {
  const raw = String(row?.paymentMethod || row?.method || '').toLowerCase();
  if (METHOD_LABELS[raw]) return METHOD_LABELS[raw];
  const blob = `${row?.concept || ''} ${row?.typeLabel || ''} ${row?.description || ''}`;
  if (/mercado\s*pago|\bqr\b/i.test(blob)) return 'Mercado Pago';
  if (/transfer|banco/i.test(blob)) return 'Transferencia';
  if (/tarjeta|cr[eé]dito/i.test(blob)) return 'Tarjeta';
  if (/d[eé]bito/i.test(blob)) return 'Débito';
  if (/cheque/i.test(blob)) return 'Cheque';
  if (/efectivo/i.test(blob)) return 'Efectivo';
  return '';
}

function paymentMethodLines(movements, monthKey) {
  const totals = new Map();
  for (const row of movements || []) {
    const date = String(row?.date || row?.createdAt || '').slice(0, 10);
    if (!date.startsWith(monthKey)) continue;
    if (row?.movementType === 'expense' || row?.movementType === 'transfer_out') continue;
    if (row?.status === 'void' || row?.status === 'cancelled') continue;
    const amount = Number(row?.amount) || 0;
    if (!(amount > 0)) continue;
    const label = methodLabel(row);
    if (!label) continue;
    totals.set(label, roundMoney((totals.get(label) || 0) + amount));
  }
  return [...totals.entries()]
    .map(([label, amount]) => ({ label, amount }))
    .toSorted((a, b) => b.amount - a.amount);
}

function pendingPayments(items, cutoff) {
  return (items || []).filter((row) => {
    if (row?.status && row.status !== 'pending') return false;
    const date = String(row?.date || row?.createdAt || '').slice(0, 10);
    return !date || date <= cutoff;
  });
}

function pickMonth(months, monthKey, todayKey) {
  if (monthKey) return months.find((month) => month.key === monthKey) || null;
  return months.find((month) => month.key < todayKey) || months[0] || null;
}

/**
 * Arma el cierre de un mes del libro.
 * Sin monthKey, toma el último mes ya cerrado. Si ninguno cerró, el más nuevo.
 */
export function buildMonthCloseReport({
  journalEntries = [],
  chart = DEFAULT_CHART_OF_ACCOUNTS,
  monthKey = '',
  members = [],
  movements = [],
  feePeriods = [],
  pendingCollections = [],
  today = new Date(),
} = {}) {
  const accounts = chart?.length ? chart : DEFAULT_CHART_OF_ACCOUNTS;
  const todayIso = todayISODateAR(today instanceof Date ? today : new Date(`${String(today).slice(0, 10)}T12:00:00`));
  const todayKey = monthKeyOf(todayIso);
  const months = buildLiveMonthlyBalances(journalEntries, accounts, { today: todayIso });
  const month = pickMonth(months, monthKey, todayKey);
  if (!month) return null;

  const cashLines = cashLinesOf(month, accounts);
  const bank = cashLines.find((line) => line.bank) || null;
  const incomeLines = itemLines(month, 'in');
  const expenseLines = itemLines(month, 'out');
  const collected = splitMonthDuesCollection({
    movements,
    members,
    monthKey: month.key,
  });
  const liquidation = liquidationOf(periodForMonth(feePeriods, month.key));
  const closed = Boolean(month.complete);
  const liquidated = liquidation.status === 'processed';
  const cutoff = cutoffDate(month.key);
  const pending = pendingPayments(pendingCollections, cutoff);
  const pendingTotal = roundMoney(pending.reduce((sum, row) => sum + (Number(row.amount) || 0), 0));
  const methods = paymentMethodLines(movements, month.key);
  const openingKey = nextMonthKey(month.key);
  const imputed = pending.length === 0;

  const steps = [
    {
      id: 'cutoff',
      order: 1,
      title: 'Establecer la fecha de corte',
      tone: closed ? 'ok' : 'pending',
      detail: closed
        ? `Corte al ${formatISODateLongAR(cutoff)}. La caja y los bancos llegan hasta ese día. Un pago posterior que cancela la cuota de este mes se imputa a esta deuda, y el ingreso queda en caja con la fecha en que entró el dinero.`
        : `El corte es el ${formatISODateLongAR(cutoff)}. El mes sigue en curso.`,
      lines: [],
    },
    {
      id: 'impute',
      order: 2,
      title: 'Registrar e imputar pagos pendientes',
      tone: imputed ? 'ok' : 'pending',
      detail: imputed
        ? 'No quedan cobranzas sin imputar hasta el corte. Un cobro posterior de la cuota de este mes se imputa a esta deuda y la caja lo toma el día en que entró el dinero.'
        : `${pending.length === 1 ? 'Queda 1 cobranza' : `Quedan ${pending.length} cobranzas`} sin imputar, por ${pesos(pendingTotal)}.`,
      lines: [],
    },
    {
      id: 'cash',
      order: 3,
      title: 'Controlar cajas y medios de cobro',
      tone: 'watch',
      detail: `Banco Nación ${pesos(bank?.amount)}. Se confronta con el extracto. En caja ${pesos(month.totalIncomeCash)}. Egresos de caja ${pesos(month.cashOut)}.${methods.length ? ` Medios: ${methods.map((row) => `${row.label} ${pesos(row.amount)}`).join(', ')}.` : ''}`,
      lines: cashLines,
    },
    {
      id: 'accounts',
      order: 4,
      title: 'Revisar las cuentas corrientes de los socios',
      tone: liquidated ? 'ok' : 'pending',
      detail: liquidated
        ? `Paquete ${pesos(liquidation.packTotal)}. Portería y estacionamiento ${pesos(collected.porteria)}, aparte. ${liquidation.note}`
        : `${liquidation.statusLabel}. Sin liquidar, las cuentas corrientes no tienen la cuota de este mes.`,
      lines: [
        { label: 'Cuota del mes', amount: collected.cuotaMes },
        { label: 'Atrasadas', amount: collected.atrasadas },
        { label: 'Adelantos', amount: collected.posteriores },
        { label: 'Recargos', amount: collected.recargos },
        { label: 'Reservas de salón', amount: collected.reservas },
      ],
    },
    {
      id: 'summary',
      order: 5,
      title: 'Revisar el resumen mensual',
      tone: closed ? 'ok' : 'pending',
      detail: `Ingresos ${pesos(month.totalIncome)}. Egresos ${pesos(month.totalExpenses)}. Resultado ${pesos(month.resultado)}.`,
      lines: [
        ...incomeLines,
        ...expenseLines,
      ],
    },
    {
      id: 'carry',
      order: 6,
      title: 'Pasar los saldos al mes siguiente',
      tone: closed ? 'ok' : 'pending',
      detail: closed
        ? `Estos saldos de caja abren ${journalMonthLabel(openingKey)}. La cuenta corriente de cada socio sigue con su saldo.`
        : `Al cerrar el mes, estos saldos abren ${journalMonthLabel(openingKey)}.`,
      lines: cashLines.map((line) => ({
        label: `Apertura · ${line.label}`,
        amount: line.amount,
        bank: line.bank,
      })),
    },
  ];

  return {
    monthKey: month.key,
    label: month.label,
    periodFrom: month.periodFrom,
    periodTo: month.periodTo,
    entryCount: month.count,
    closed,
    statusLabel: closed && liquidated && imputed ? 'Para firmar' : (closed ? 'Incompleto' : 'En curso'),
    readyToSign: closed && liquidated && imputed,
    incomeLines,
    expenseLines,
    incomeTotal: roundMoney(month.totalIncome),
    expenseTotal: roundMoney(month.totalExpenses),
    result: roundMoney(month.resultado),
    cashLines,
    cashTotal: roundMoney(cashLines.reduce((sum, line) => sum + line.amount, 0)),
    bankAmount: roundMoney(bank?.amount),
    cashIn: roundMoney(month.totalIncomeCash),
    cashOut: roundMoney(month.cashOut),
    collected,
    liquidation,
    cutoff,
    pendingCount: pending.length,
    pendingTotal,
    steps,
    months: months.map((row) => ({ key: row.key, label: row.label, closed: row.complete })),
  };
}
