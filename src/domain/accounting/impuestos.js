/**
 * Impuestos (IVA / IIBB) con la operatoria observada en Taxes:
 * libros de comprobantes, alícuotas, percepciones y liquidación por período.
 * La posición se calcula en el dominio; no presenta nada ante ARCA.
 */

import { buildPostedEntry, journalDateKey, normalizeLines, postedJournalEntries } from './journal';
import { DEFAULT_CHART_OF_ACCOUNTS, getAccountById, resolveAccountId } from './chartOfAccounts';
import { formatISODateLongAR, todayISODateAR } from '../../lib/arDate';

export const TAX_ACCOUNT_CODES = {
  ivaCredito: '1.1.04',
  percepciones: '1.1.05',
  cuentasCobrar: '1.1.06',
  proveedores: '2.1.01',
  ivaDebito: '2.1.04',
  ivaPagar: '2.1.05',
  iibbPagar: '2.1.06',
  percDepositar: '2.1.07',
  impuestos: '5.1.06',
  caja: '1.1.01',
  ingresos: '4.1.02',
};

const TAX_CODES = new Set(Object.values(TAX_ACCOUNT_CODES));

export function ensureTaxAccounts(chart = []) {
  const list = Array.isArray(chart) ? [...chart] : [];
  const have = new Set(list.map((account) => account.code));
  DEFAULT_CHART_OF_ACCOUNTS.forEach((account) => {
    if (TAX_CODES.has(account.code) && !have.has(account.code)) {
      list.push(account);
      have.add(account.code);
    }
  });
  return list;
}

export function taxAccountId(chart, key) {
  const code = TAX_ACCOUNT_CODES[key];
  const found = (chart || []).find((account) => account.code === code);
  return found?.id || `coa-${code}`;
}

export const FISCAL_CONDITIONS = [
  { id: 'exento', label: 'Exento' },
  { id: 'responsable_inscripto', label: 'Responsable inscripto' },
  { id: 'monotributo', label: 'Monotributo' },
];

export const DEFAULT_FISCAL_PROFILE = Object.freeze({
  id: 'perfil-fiscal',
  docKind: 'perfil',
  condition: 'exento',
  jurisdiction: 'San Juan',
  iibbPercent: 0,
  pointOfSale: '1',
});

/** Alícuotas de IVA del maestro de Taxes (`system_taxes`). */
export const IVA_ALIQUOTS = [
  { id: 'iva-27', name: 'gravado al 27%', percent: 27, taxableIva: true, taxableIibb: true },
  { id: 'iva-21', name: 'gravado al 21%', percent: 21, taxableIva: true, taxableIibb: true },
  { id: 'iva-10-5', name: 'gravado al 10,5%', percent: 10.5, taxableIva: true, taxableIibb: true },
  { id: 'iva-5', name: 'gravado al 5%', percent: 5, taxableIva: true, taxableIibb: true },
  { id: 'iva-2-5', name: 'gravado al 2,5%', percent: 2.5, taxableIva: true, taxableIibb: true },
  { id: 'iva-0', name: 'gravado al 0%', percent: 0, taxableIva: true, taxableIibb: true },
  { id: 'no-gravado', name: 'no gravado', percent: 0, taxableIva: false, taxableIibb: true },
  { id: 'exento', name: 'Exento', percent: 0, taxableIva: false, taxableIibb: true },
];

export const VOUCHER_BOOKS = [
  { id: 'venta', label: 'Ventas', lines: true },
  { id: 'compra', label: 'Compras', lines: true },
  { id: 'retencion', label: 'Retenciones', lines: false },
  { id: 'sircreb', label: 'SIRCREB', lines: false },
  { id: 'sirtac', label: 'SIRTAC', lines: false },
  { id: 'compensacion', label: 'Compensación', lines: false },
  { id: 'anticipo_ganancias', label: 'Ant. Ganancias', lines: false },
  { id: 'asiento_sueldos', label: 'Asientos de Sueldos', lines: false },
];

export const RECEIPT_LETTERS = [
  { id: 'A', label: 'Factura A', discriminatesIva: true, sign: 1 },
  { id: 'B', label: 'Factura B', discriminatesIva: false, sign: 1 },
  { id: 'C', label: 'Factura C', discriminatesIva: false, sign: 1 },
  { id: 'NCA', label: 'Nota de crédito A', discriminatesIva: true, sign: -1 },
  { id: 'NCB', label: 'Nota de crédito B', discriminatesIva: false, sign: -1 },
  { id: 'NCC', label: 'Nota de crédito C', discriminatesIva: false, sign: -1 },
  { id: 'NDA', label: 'Nota de débito A', discriminatesIva: true, sign: 1 },
  { id: 'TIQUE', label: 'Tique', discriminatesIva: false, sign: 1 },
];

export const PAYMENT_TERMS = [
  { id: 'contado', label: 'Contado' },
  { id: 'cheque', label: 'Cheque' },
  { id: 'transferencia', label: 'Transferencia' },
];

export const RETENTION_SUGGESTIONS = [
  'Retenciones de Ganancias',
  'Retenciones de IVA',
  'Retenciones de SUSS',
  'Retencion IIBB de San Juan',
  'Retencion IIBB de Buenos Aires',
  'Retencion IIBB de Capital Federal',
  'Retencion IIBB de Mendoza',
  'Retencion IIBB de Córdoba',
  'Retencion IIBB de Santa Fe',
];

export function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

export function aliquotById(id) {
  return IVA_ALIQUOTS.find((item) => item.id === id) || IVA_ALIQUOTS.find((item) => item.id === 'exento');
}

export function letterById(id) {
  return RECEIPT_LETTERS.find((item) => item.id === id) || RECEIPT_LETTERS[0];
}

export function chargesIva(condition, aliquot) {
  return condition === 'responsable_inscripto' && aliquot.taxableIva && aliquot.percent > 0;
}

/**
 * Precio de renglón.
 * Factura A: el precio es neto y el IVA se suma.
 * Factura B/C o tique: el precio incluye IVA y se destapa.
 */
export function priceLine({
  quantity = 1,
  unitPrice = 0,
  bonusPercent = 0,
  aliquotId = 'exento',
  iibbPercent = 0,
  discriminatesIva = true,
  condition = 'exento',
} = {}) {
  const aliquot = aliquotById(aliquotId);
  const qty = Number(quantity) || 0;
  const price = Number(unitPrice) || 0;
  const bonus = Math.min(100, Math.max(0, Number(bonusPercent) || 0));
  const base = roundMoney(qty * price * (1 - bonus / 100));
  const rate = (Number(iibbPercent) || 0) / 100;
  const ivaOn = chargesIva(condition, aliquot);

  if (!ivaOn) {
    const iibb = aliquot.taxableIibb ? roundMoney(base * rate) : 0;
    return {
      net: base,
      iva: 0,
      iibb,
      taxableNet: aliquot.taxableIibb ? base : 0,
      total: roundMoney(base + iibb),
      aliquot,
    };
  }

  if (discriminatesIva) {
    const iva = roundMoney(base * (aliquot.percent / 100));
    const iibb = aliquot.taxableIibb ? roundMoney(base * rate) : 0;
    return {
      net: base,
      iva,
      iibb,
      taxableNet: aliquot.taxableIibb ? base : 0,
      total: roundMoney(base + iva + iibb),
      aliquot,
    };
  }

  const net = roundMoney(base / (1 + aliquot.percent / 100));
  const iva = roundMoney(base - net);
  const iibb = aliquot.taxableIibb ? roundMoney(net * rate) : 0;
  return {
    net,
    iva,
    iibb,
    taxableNet: aliquot.taxableIibb ? net : 0,
    total: roundMoney(base + iibb),
    aliquot,
  };
}

/** El importe tipeado en un gasto ya es el total pagado. Si hay crédito fiscal, se destapa. */
export function splitPurchaseTotal(total, aliquotId, condition = 'exento') {
  const amount = roundMoney(total);
  const aliquot = aliquotById(aliquotId);
  if (!chargesIva(condition, aliquot)) {
    return { net: amount, iva: 0, total: amount, aliquot };
  }
  const net = roundMoney(amount / (1 + aliquot.percent / 100));
  return { net, iva: roundMoney(amount - net), total: amount, aliquot };
}

function perceptionTotals(perceptions = [], sign = 1) {
  let percIva = 0;
  let percIibb = 0;
  (perceptions || []).forEach((row) => {
    const amount = roundMoney(row.amount) * sign;
    if (row.kind === 'perc_iva') percIva += amount;
    else percIibb += amount;
  });
  return { percIva: roundMoney(percIva), percIibb: roundMoney(percIibb) };
}

export function voucherTotals(voucher, profile = DEFAULT_FISCAL_PROFILE) {
  const letter = letterById(voucher?.letter || 'A');
  const sign = letter.sign || 1;
  const condition = voucher?.condition || profile?.condition || 'exento';
  const book = VOUCHER_BOOKS.find((item) => item.id === voucher?.book);
  if (!book?.lines) {
    const amount = roundMoney(voucher?.amount) * sign;
    return {
      sign,
      net: 0,
      iva: 0,
      iibb: 0,
      taxableNet: 0,
      percIva: 0,
      percIibb: 0,
      total: amount,
    };
  }

  const iibbPercent = voucher?.iibbPercent != null ? voucher.iibbPercent : (profile?.iibbPercent || 0);
  const acc = { net: 0, iva: 0, iibb: 0, taxableNet: 0, total: 0 };
  (voucher?.lines || []).forEach((line) => {
    const priced = priceLine({
      ...line,
      iibbPercent,
      discriminatesIva: letter.discriminatesIva,
      condition,
    });
    acc.net += priced.net;
    acc.iva += priced.iva;
    acc.iibb += priced.iibb;
    acc.taxableNet += priced.taxableNet;
    acc.total += priced.total;
  });
  const perceptions = perceptionTotals(voucher?.perceptions, 1);
  acc.total += perceptions.percIva + perceptions.percIibb;
  return {
    sign,
    net: roundMoney(acc.net * sign),
    iva: roundMoney(acc.iva * sign),
    iibb: roundMoney(acc.iibb * sign),
    taxableNet: roundMoney(acc.taxableNet * sign),
    percIva: roundMoney(perceptions.percIva * sign),
    percIibb: roundMoney(perceptions.percIibb * sign),
    total: roundMoney(acc.total * sign),
  };
}

export function periodOf(date) {
  const iso = String(date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
  return iso.slice(0, 7);
}

export function createComprobante(input = {}, profile = DEFAULT_FISCAL_PROFILE) {
  const book = String(input.book || 'venta');
  const known = VOUCHER_BOOKS.some((item) => item.id === book);
  if (!known) throw new Error('Libro de comprobante desconocido.');
  const date = String(input.date || '').slice(0, 10);
  if (!periodOf(date)) throw new Error('La fecha del comprobante es obligatoria.');
  const counterpartyName = String(input.counterpartyName || '').trim();
  if (!counterpartyName) throw new Error('Indique cliente o proveedor.');

  const draft = {
    id: input.id || `cmp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    docKind: 'comprobante',
    book,
    letter: input.letter || 'A',
    pointOfSale: String(input.pointOfSale || profile.pointOfSale || '1').trim(),
    number: String(input.number || '').trim(),
    date,
    period: periodOf(date),
    counterpartyName,
    cuit: String(input.cuit || '').trim(),
    paymentTerm: input.paymentTerm || 'contado',
    condition: input.condition || profile.condition || 'exento',
    iibbPercent: input.iibbPercent != null ? Number(input.iibbPercent) || 0 : Number(profile.iibbPercent) || 0,
    currency: input.currency || 'ARS',
    exchangeRate: Number(input.exchangeRate) || 1,
    lines: (input.lines || []).map((line) => ({
      detail: String(line.detail || '').trim(),
      quantity: Number(line.quantity) || 0,
      unitPrice: Number(line.unitPrice) || 0,
      bonusPercent: Number(line.bonusPercent) || 0,
      aliquotId: line.aliquotId || 'exento',
    })),
    perceptions: (input.perceptions || []).map((row) => ({
      kind: row.kind === 'perc_iva' ? 'perc_iva' : 'perc_iibb',
      name: String(row.name || '').trim(),
      amount: roundMoney(row.amount),
    })).filter((row) => row.amount !== 0),
    amount: roundMoney(input.amount),
    taxKind: input.taxKind || '',
    incomeAccountId: input.incomeAccountId || '',
    expenseAccountId: input.expenseAccountId || '',
    paymentAccountId: input.paymentAccountId || '',
    sourceId: input.sourceId || null,
    journalEntryId: input.journalEntryId || null,
    status: 'recorded',
    notes: String(input.notes || '').trim(),
    createdAt: new Date().toISOString(),
  };

  const totals = voucherTotals(draft, profile);
  if (totals.total === 0 && totals.iva === 0 && totals.iibb === 0) {
    throw new Error('El comprobante no tiene importe.');
  }
  return { ...draft, totals };
}

export function voidComprobante(voucher) {
  if (!voucher) throw new Error('Comprobante no encontrado.');
  if (voucher.status === 'void') return voucher;
  return { ...voucher, status: 'void', updatedAt: new Date().toISOString() };
}

function activeInPeriod(vouchers, period) {
  return (vouchers || []).filter((voucher) => (
    voucher.status !== 'void' && (voucher.period || periodOf(voucher.date)) === period
  ));
}

export function classifyRetention(type) {
  const text = String(type || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  if (text.includes('iva')) return 'iva';
  if (text.includes('iibb') || text.includes('ingreso bruto')) return 'iibb';
  if (text.includes('suss')) return 'suss';
  if (text.includes('gananc')) return 'ganancias';
  return 'otros';
}

function retentionInPeriod(retenciones, period, kind) {
  return (retenciones || [])
    .filter((row) => row.status !== 'void' && periodOf(row.retentionDate) === period)
    .filter((row) => classifyRetention(row.retentionType) === kind)
    .reduce((sum, row) => sum + (Number(row.retentionAmount) || 0), 0);
}

function bookAmount(vouchers, book) {
  return roundMoney(vouchers
    .filter((voucher) => voucher.book === book)
    .reduce((sum, voucher) => sum + (voucherTotals(voucher).total || 0), 0));
}

export function liquidatePeriod({
  period,
  kind = 'iva',
  vouchers = [],
  retenciones = [],
  profile = DEFAULT_FISCAL_PROFILE,
} = {}) {
  if (!/^\d{4}-\d{2}$/.test(String(period || ''))) {
    throw new Error('El período debe tener la forma AAAA-MM.');
  }
  if (kind !== 'iva' && kind !== 'iibb') throw new Error('La liquidación es IVA o IIBB.');

  const rows = activeInPeriod(vouchers, period);
  const ventas = rows.filter((voucher) => voucher.book === 'venta');
  const compras = rows.filter((voucher) => voucher.book === 'compra');
  const sum = (list, field) => roundMoney(list.reduce((acc, voucher) => acc + (voucherTotals(voucher, profile)[field] || 0), 0));

  const retencionesPracticadas = roundMoney(retentionInPeriod(retenciones, period, kind)
    + rows.filter((voucher) => voucher.book === 'retencion' && (voucher.taxKind || kind) === kind)
      .reduce((acc, voucher) => acc + voucherTotals(voucher).total, 0));

  if (kind === 'iva') {
    const debito = sum(ventas, 'iva');
    const credito = sum(compras, 'iva');
    const percepciones = roundMoney(sum(compras, 'percIva') + sum(ventas, 'percIva'));
    const saldo = profile.condition === 'responsable_inscripto'
      ? roundMoney(debito - credito - percepciones)
      : 0;
    return {
      id: `liq-${kind}-${period}`,
      docKind: 'liquidacion',
      period,
      kind,
      status: 'open',
      debito,
      credito,
      percepciones,
      retencionesPracticadas,
      saldo,
      aFavor: saldo < 0 ? roundMoney(Math.abs(saldo)) : 0,
      aPagar: saldo > 0 ? saldo : 0,
      condition: profile.condition,
      createdAt: new Date().toISOString(),
    };
  }

  const determinado = sum(ventas, 'iibb');
  const creditoCompras = sum(compras, 'iibb');
  const percepciones = roundMoney(sum(compras, 'percIibb') + sum(ventas, 'percIibb'));
  const sircreb = bookAmount(rows, 'sircreb');
  const sirtac = bookAmount(rows, 'sirtac');
  const saldo = roundMoney(determinado - creditoCompras - percepciones - sircreb - sirtac);
  return {
    id: `liq-iibb-${period}`,
    docKind: 'liquidacion',
    period,
    kind,
    status: 'open',
    debito: determinado,
    credito: roundMoney(creditoCompras + percepciones + sircreb + sirtac),
    percepciones,
    sircreb,
    sirtac,
    retencionesPracticadas,
    saldo,
    aFavor: saldo < 0 ? roundMoney(Math.abs(saldo)) : 0,
    aPagar: saldo > 0 ? saldo : 0,
    condition: profile.condition,
    createdAt: new Date().toISOString(),
  };
}

export function taxBoard({ vouchers = [], retenciones = [], period, profile = DEFAULT_FISCAL_PROFILE } = {}) {
  const iva = liquidatePeriod({ period, kind: 'iva', vouchers, retenciones, profile });
  const iibb = liquidatePeriod({ period, kind: 'iibb', vouchers, retenciones, profile });
  const rows = activeInPeriod(vouchers, period);
  return {
    period,
    vouchers: rows.length,
    ventas: rows.filter((voucher) => voucher.book === 'venta').length,
    compras: rows.filter((voucher) => voucher.book === 'compra').length,
    iva,
    iibb,
  };
}

function signedParts(parts, sign) {
  return parts
    .map((part) => {
      const amount = roundMoney(part.amount);
      if (!amount) return null;
      const debit = sign >= 0 ? (part.side === 'debit' ? amount : 0) : (part.side === 'credit' ? amount : 0);
      const credit = sign >= 0 ? (part.side === 'credit' ? amount : 0) : (part.side === 'debit' ? amount : 0);
      return { accountId: part.accountId, debit, credit };
    })
    .filter(Boolean);
}

function balanceLines(lines) {
  const next = lines.map((line) => ({ ...line, debit: roundMoney(line.debit), credit: roundMoney(line.credit) }));
  const debit = roundMoney(next.reduce((sum, line) => sum + line.debit, 0));
  const credit = roundMoney(next.reduce((sum, line) => sum + line.credit, 0));
  const diff = roundMoney(debit - credit);
  if (diff !== 0 && next.length) {
    const last = next[next.length - 1];
    if (last.credit) last.credit = roundMoney(last.credit + diff);
    else last.debit = roundMoney(last.debit - diff);
  }
  return next.filter((line) => line.debit || line.credit);
}

export function journalForComprobante(voucher, chart, profile = DEFAULT_FISCAL_PROFILE) {
  const fullChart = ensureTaxAccounts(chart);
  const totals = voucherTotals(voucher, profile);
  const sign = totals.sign || 1;
  const abs = (value) => roundMoney(Math.abs(value));
  const book = voucher.book;
  if (book !== 'venta' && book !== 'compra') {
    throw new Error('Este libro se toma en la liquidación, no genera asiento de comprobante.');
  }

  const parts = book === 'venta'
    ? [
      {
        accountId: voucher.paymentTerm === 'contado'
          ? (voucher.paymentAccountId || taxAccountId(fullChart, 'caja'))
          : taxAccountId(fullChart, 'cuentasCobrar'),
        side: 'debit',
        amount: abs(totals.total),
      },
      {
        accountId: voucher.incomeAccountId || taxAccountId(fullChart, 'ingresos'),
        side: 'credit',
        amount: abs(totals.net),
      },
      { accountId: taxAccountId(fullChart, 'ivaDebito'), side: 'credit', amount: abs(totals.iva) },
      { accountId: taxAccountId(fullChart, 'iibbPagar'), side: 'credit', amount: abs(totals.iibb) },
      { accountId: taxAccountId(fullChart, 'percDepositar'), side: 'credit', amount: abs(totals.percIva + totals.percIibb) },
    ]
    : [
      {
        accountId: voucher.expenseAccountId || taxAccountId(fullChart, 'impuestos'),
        side: 'debit',
        amount: abs(totals.net),
      },
      { accountId: taxAccountId(fullChart, 'ivaCredito'), side: 'debit', amount: abs(totals.iva) },
      { accountId: taxAccountId(fullChart, 'percepciones'), side: 'debit', amount: abs(totals.iibb + totals.percIva + totals.percIibb) },
      {
        accountId: voucher.paymentTerm === 'contado'
          ? (voucher.paymentAccountId || taxAccountId(fullChart, 'caja'))
          : (voucher.paymentAccountId || taxAccountId(fullChart, 'proveedores')),
        side: 'credit',
        amount: abs(totals.total),
      },
    ];

  const lines = balanceLines(signedParts(parts, sign));
  return buildPostedEntry({
    date: voucher.date,
    description: `${book === 'venta' ? 'Venta' : 'Compra'} ${voucher.letter || ''} ${voucher.number || ''} ${voucher.counterpartyName}`.replace(/\s+/g, ' ').trim(),
    lines,
    sourceModule: 'impuestos',
    sourceId: voucher.id,
    chart: fullChart,
  });
}

export function journalForLiquidacion(liquidation, chart) {
  const fullChart = ensureTaxAccounts(chart);
  if (!liquidation || liquidation.status === 'void') throw new Error('Liquidación no encontrada.');
  const pagar = roundMoney(liquidation.aPagar);
  const favor = roundMoney(liquidation.aFavor);
  if (!pagar && !favor && !liquidation.debito && !liquidation.credito) {
    throw new Error('La liquidación no tiene importes para contabilizar.');
  }

  const pagarAccount = liquidation.kind === 'iva' ? 'ivaPagar' : 'iibbPagar';
  const debitoAccount = liquidation.kind === 'iva' ? 'ivaDebito' : 'impuestos';
  const creditoAccount = liquidation.kind === 'iva' ? 'ivaCredito' : 'percepciones';
  const parts = [];
  if (liquidation.kind === 'iibb') {
    // Las ventas ya acreditaron IIBB a pagar. Solo se aplican créditos hasta ese débito.
    const uso = roundMoney(Math.min(Number(liquidation.credito) || 0, Number(liquidation.debito) || 0));
    if (!uso) throw new Error('No hay créditos de IIBB para contabilizar.');
    parts.push({ accountId: taxAccountId(fullChart, 'iibbPagar'), side: 'debit', amount: uso });
    parts.push({ accountId: taxAccountId(fullChart, 'percepciones'), side: 'credit', amount: uso });
  } else {
    parts.push({ accountId: taxAccountId(fullChart, debitoAccount), side: 'debit', amount: roundMoney(Math.abs(liquidation.debito)) });
    parts.push({ accountId: taxAccountId(fullChart, creditoAccount), side: 'credit', amount: roundMoney(Math.abs(liquidation.credito)) });
    parts.push({ accountId: taxAccountId(fullChart, 'percepciones'), side: 'credit', amount: roundMoney(Math.abs(liquidation.percepciones)) });
    if (pagar) parts.push({ accountId: taxAccountId(fullChart, pagarAccount), side: 'credit', amount: pagar });
    if (favor) parts.push({ accountId: taxAccountId(fullChart, 'ivaCredito'), side: 'debit', amount: favor });
  }

  return buildPostedEntry({
    date: `${liquidation.period}-01`,
    description: `Liquidación ${liquidation.kind.toUpperCase()} ${liquidation.period}`,
    lines: balanceLines(signedParts(parts, 1)),
    sourceModule: 'impuestos',
    sourceId: liquidation.id,
    chart: fullChart,
  });
}

export function journalForTaxPayment(liquidation, chart, paymentAccountId) {
  const fullChart = ensureTaxAccounts(chart);
  const amount = roundMoney(liquidation?.aPagar);
  if (amount <= 0) throw new Error('No hay saldo a pagar.');
  const account = liquidation.kind === 'iva' ? 'ivaPagar' : 'iibbPagar';
  return buildPostedEntry({
    date: todayISODateAR(),
    description: `Pago ${liquidation.kind.toUpperCase()} ${liquidation.period}`,
    lines: [
      { accountId: taxAccountId(fullChart, account), debit: amount, credit: 0 },
      { accountId: paymentAccountId || taxAccountId(fullChart, 'caja'), debit: 0, credit: amount },
    ],
    sourceModule: 'impuestos',
    sourceId: liquidation.id,
    chart: fullChart,
  });
}

export function compraFromExpense(expense, profile = DEFAULT_FISCAL_PROFILE) {
  if (!expense?.ivaAliquotId) return null;
  const split = splitPurchaseTotal(expense.amount, expense.ivaAliquotId, expense.fiscalCondition || profile.condition);
  if (!split.iva) return null;
  return createComprobante({
    id: `cmp-exp-${expense.id}`,
    book: 'compra',
    letter: 'A',
    date: expense.expenseDate || expense.date,
    counterpartyName: expense.vendorName || 'Proveedor',
    number: expense.invoiceNumber || '',
    paymentTerm: 'contado',
    condition: 'responsable_inscripto',
    iibbPercent: 0,
    expenseAccountId: expense.categoryAccountId,
    paymentAccountId: expense.paymentAccountId,
    sourceId: expense.id,
    journalEntryId: expense.journalEntryId || null,
    lines: [{
      detail: expense.concept || 'Gasto',
      quantity: 1,
      unitPrice: split.net,
      bonusPercent: 0,
      aliquotId: expense.ivaAliquotId,
    }],
  }, { ...profile, condition: 'responsable_inscripto', iibbPercent: 0 });
}

const MEMBERSHIP_INCOME_GROUPS = new Set(['cuotas']);

export function currentTaxPeriod(today = new Date()) {
  return periodOf(todayISODateAR(today));
}

export function taxPeriodLabel(period) {
  const key = String(period || '').slice(0, 7);
  const long = formatISODateLongAR(`${key}-01`);
  return long.replace(/^\d+ de /, '') || key || '—';
}

/** Ingresos y gastos del libro en el período (las cuotas no se facturan). */
export function journalPeriodBase(entries = [], chart = DEFAULT_CHART_OF_ACCOUNTS, period) {
  const list = chart?.length ? chart : DEFAULT_CHART_OF_ACCOUNTS;
  const incomeBy = new Map();
  const expenseBy = new Map();
  const cashInBy = new Map();
  const cashOutBy = new Map();
  postedJournalEntries(entries).forEach((entry) => {
    if (periodOf(journalDateKey(entry)) !== period) return;
    normalizeLines(entry.lines || [], list).forEach((line) => {
      const accountId = resolveAccountId(list, line.accountId) || line.accountId;
      const account = getAccountById(list, accountId);
      if (!account) return;
      const debit = Number(line.debit) || 0;
      const credit = Number(line.credit) || 0;
      if (account.isCashAccount || account.code === '1.1.03' || /banco/i.test(account.name || '')) {
        if (debit) {
          const prev = cashInBy.get(account.id) || { account, amount: 0 };
          prev.amount = roundMoney(prev.amount + debit);
          cashInBy.set(account.id, prev);
        }
        if (credit) {
          const prev = cashOutBy.get(account.id) || { account, amount: 0 };
          prev.amount = roundMoney(prev.amount + credit);
          cashOutBy.set(account.id, prev);
        }
      }
      if (account.accountType === 'income') {
        const amount = roundMoney(credit - debit);
        if (!amount) return;
        const prev = incomeBy.get(account.id) || { account, amount: 0 };
        prev.amount = roundMoney(prev.amount + amount);
        incomeBy.set(account.id, prev);
      }
      if (account.accountType === 'expense') {
        const amount = roundMoney(debit - credit);
        if (!amount) return;
        const prev = expenseBy.get(account.id) || { account, amount: 0 };
        prev.amount = roundMoney(prev.amount + amount);
        expenseBy.set(account.id, prev);
      }
    });
  });
  const incomeRows = [...incomeBy.values()].filter((row) => row.amount).toSorted((a, b) => b.amount - a.amount);
  const expenseRows = [...expenseBy.values()].filter((row) => row.amount).toSorted((a, b) => b.amount - a.amount);
  const cashInRows = [...cashInBy.values()].filter((row) => row.amount).toSorted((a, b) => b.amount - a.amount);
  const cashOutRows = [...cashOutBy.values()].filter((row) => row.amount).toSorted((a, b) => b.amount - a.amount);
  return {
    income: roundMoney(incomeRows.reduce((sum, row) => sum + row.amount, 0)),
    expense: roundMoney(expenseRows.reduce((sum, row) => sum + row.amount, 0)),
    cashIn: roundMoney(cashInRows.reduce((sum, row) => sum + row.amount, 0)),
    cashOut: roundMoney(cashOutRows.reduce((sum, row) => sum + row.amount, 0)),
    incomeRows,
    expenseRows,
    cashInRows,
    cashOutRows,
  };
}

function coveredSourceIds(vouchers = []) {
  const ids = new Set();
  vouchers.forEach((row) => {
    if (!row || row.status === 'void') return;
    if (row.sourceId) ids.add(String(row.sourceId));
    if (row.id) ids.add(String(row.id));
  });
  return ids;
}

function isLiveExpense(expense) {
  const status = String(expense?.status || '').toLowerCase();
  return status === 'paid' || status === 'approved';
}

/** Compra viva del gasto pagado o aprobado. No se guarda hasta que se registre. */
export function liveCompraFromExpense(expense, profile = DEFAULT_FISCAL_PROFILE) {
  if (!isLiveExpense(expense)) return null;
  const date = String(expense.expenseDate || expense.date || expense.paidAt || '').slice(0, 10);
  if (!periodOf(date)) return null;
  const amount = roundMoney(expense.amount);
  if (amount <= 0) return null;
  const aliquotId = expense.ivaAliquotId || 'exento';
  const split = splitPurchaseTotal(amount, aliquotId, expense.fiscalCondition || profile.condition);
  try {
    return createComprobante({
      id: `cmp-live-exp-${expense.id}`,
      book: 'compra',
      letter: split.iva ? 'A' : 'C',
      date,
      counterpartyName: expense.vendorName || 'Proveedor',
      number: expense.invoiceNumber || '',
      paymentTerm: 'contado',
      condition: profile.condition,
      iibbPercent: 0,
      expenseAccountId: expense.categoryAccountId,
      paymentAccountId: expense.paymentAccountId,
      sourceId: expense.id,
      journalEntryId: expense.journalEntryId || null,
      notes: 'Desde gastos',
      lines: [{
        detail: expense.concept || 'Gasto',
        quantity: 1,
        unitPrice: split.net,
        bonusPercent: 0,
        aliquotId,
      }],
    }, profile);
  } catch {
    return null;
  }
}

/** Venta viva de otro ingreso (eventos, canon, alquileres). Las cuotas no se facturan. */
export function liveVentaFromOtherIncome(item, profile = DEFAULT_FISCAL_PROFILE) {
  if (!item || String(item.status || 'posted').toLowerCase() === 'void') return null;
  if (MEMBERSHIP_INCOME_GROUPS.has(item.group)) return null;
  const date = String(item.date || '').slice(0, 10);
  if (!periodOf(date)) return null;
  const amount = roundMoney(item.amount);
  if (amount <= 0) return null;
  try {
    return createComprobante({
      id: `cmp-live-oi-${item.id}`,
      book: 'venta',
      letter: 'C',
      date,
      counterpartyName: item.payerName || item.concept || 'Ingreso',
      number: item.documentId || item.operationRef || '',
      paymentTerm: item.paymentMethod === 'efectivo' ? 'contado' : 'transferencia',
      condition: profile.condition,
      incomeAccountId: '',
      sourceId: item.id,
      notes: item.concept || 'Desde otros ingresos',
      lines: [{
        detail: item.concept || 'Ingreso',
        quantity: 1,
        unitPrice: amount,
        bonusPercent: 0,
        aliquotId: 'exento',
      }],
    }, profile);
  } catch {
    return null;
  }
}

function activityRow(voucher, profile, origin, originLabel) {
  const totals = voucher.totals || voucherTotals(voucher, profile);
  return {
    id: voucher.id,
    origin,
    originLabel,
    book: voucher.book,
    date: voucher.date,
    party: voucher.counterpartyName,
    concept: voucher.notes || voucher.lines?.[0]?.detail || '',
    number: voucher.number || '',
    net: totals.net,
    iva: totals.iva,
    iibb: totals.iibb,
    total: totals.total,
    official: origin === 'comprobante',
  };
}

export function buildLiveImpuestos({
  vouchers = [],
  retenciones = [],
  expenses = [],
  otherIncomes = [],
  journalEntries = [],
  chartOfAccounts = DEFAULT_CHART_OF_ACCOUNTS,
  profile = DEFAULT_FISCAL_PROFILE,
  period,
  today = new Date(),
} = {}) {
  const month = period || currentTaxPeriod(today);
  const official = (vouchers || []).filter((row) => (
    row?.docKind !== 'perfil'
    && row?.status !== 'void'
    && (row.period || periodOf(row.date)) === month
  ));
  const covered = coveredSourceIds(official);
  const impliedCompras = (expenses || []).flatMap((expense) => {
    if (covered.has(String(expense.id))) return [];
    if (covered.has(`cmp-exp-${expense.id}`) || covered.has(`cmp-live-exp-${expense.id}`)) return [];
    if (periodOf(String(expense.expenseDate || expense.date || expense.paidAt || '').slice(0, 10)) !== month) return [];
    const voucher = liveCompraFromExpense(expense, profile);
    return voucher ? [voucher] : [];
  });
  const impliedVentas = (otherIncomes || []).flatMap((item) => {
    if (covered.has(String(item.id))) return [];
    if (covered.has(`cmp-live-oi-${item.id}`)) return [];
    if (periodOf(item.date) !== month) return [];
    const voucher = liveVentaFromOtherIncome(item, profile);
    return voucher ? [voucher] : [];
  });
  const implied = [...impliedVentas, ...impliedCompras];
  const merged = [...official, ...implied];
  const board = taxBoard({ vouchers: merged, retenciones, period: month, profile });
  const retencionesDelMes = (retenciones || []).filter((row) => (
    row.status !== 'void' && periodOf(row.retentionDate) === month
  ));
  const retencionesAmount = roundMoney(retencionesDelMes.reduce((sum, row) => sum + (Number(row.retentionAmount) || 0), 0));
  const gastosAmount = roundMoney(impliedCompras.reduce((sum, row) => sum + Math.abs(row.totals?.total || 0), 0)
    + official.filter((row) => row.book === 'compra').reduce((sum, row) => sum + Math.abs((row.totals || voucherTotals(row, profile)).total || 0), 0));
  const ingresosAmount = roundMoney(impliedVentas.reduce((sum, row) => sum + Math.abs(row.totals?.total || 0), 0)
    + official.filter((row) => row.book === 'venta').reduce((sum, row) => sum + Math.abs((row.totals || voucherTotals(row, profile)).total || 0), 0));

  const book = journalPeriodBase(journalEntries, chartOfAccounts, month);
  const asBookRow = (row, origin, originLabel, bookKind) => ({
    id: `libro-${origin}-${row.account.id}`,
    origin,
    originLabel,
    book: bookKind,
    date: `${month}-01`,
    party: '—',
    concept: row.account.name,
    number: row.account.code,
    net: row.amount,
    iva: 0,
    iibb: 0,
    total: row.amount,
    official: false,
  });
  const bookRows = [
    ...book.cashInRows.map((row) => asBookRow(row, 'cobro', 'Cobros (tesorería)', 'venta')),
    ...book.cashOutRows.map((row) => asBookRow(row, 'egreso', 'Egresos de tesorería', 'compra')),
    ...book.incomeRows.map((row) => asBookRow(
      row,
      'libro',
      row.account.name === 'Cuotas Sociales' ? 'Cuotas (no se facturan)' : 'Ingreso del libro',
      'venta',
    )),
    ...book.expenseRows.map((row) => asBookRow(row, 'libro', 'Gasto del libro', 'compra')),
  ];

  const detail = [
    ...official.map((row) => activityRow(row, profile, 'comprobante', 'Comprobante')),
    ...impliedVentas.map((row) => activityRow(row, profile, 'ingreso', 'Otros ingresos')),
    ...impliedCompras.map((row) => activityRow(row, profile, 'gasto', 'Gastos')),
    ...retencionesDelMes.map((row) => ({
      id: row.id || `ret-${row.retentionDate}`,
      origin: 'retencion',
      originLabel: 'Retención',
      book: 'retencion',
      date: String(row.retentionDate || '').slice(0, 10),
      party: row.supplierName || row.clientName || 'Agente',
      concept: row.retentionType || 'Retención',
      number: row.paymentOrderNumber || '',
      net: 0,
      iva: classifyRetention(row.retentionType) === 'iva' ? Number(row.retentionAmount) || 0 : 0,
      iibb: classifyRetention(row.retentionType) === 'iibb' ? Number(row.retentionAmount) || 0 : 0,
      total: Number(row.retentionAmount) || 0,
      official: false,
    })),
  ].toSorted((a, b) => String(b.date).localeCompare(String(a.date)) || String(a.party).localeCompare(String(b.party), 'es'));

  return {
    period: month,
    asOfLabel: formatISODateLongAR(todayISODateAR(today)),
    periodLabel: taxPeriodLabel(month),
    officialCount: official.length,
    impliedCount: implied.length,
    gastosCount: impliedCompras.length + official.filter((row) => row.book === 'compra').length,
    gastosAmount,
    ingresosCount: impliedVentas.length + official.filter((row) => row.book === 'venta').length,
    ingresosAmount,
    bookIncome: book.income,
    bookExpense: book.expense,
    cashIn: book.cashIn,
    cashOut: book.cashOut,
    retencionesCount: retencionesDelMes.length,
    retencionesAmount,
    board,
    activity: [...bookRows, ...detail],
    vouchersForLiquidation: merged,
  };
}
