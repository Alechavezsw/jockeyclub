/** Otros ingresos / cobros manuales (estilo LILA). */

import { money } from '../money';
import { buildPostedEntry } from './journal';
import { todayAR } from '../../lib/arDate';
import { poolGuestQuote } from '../pool/poolAccess';


export const OTHER_INCOME_PAYERS = {
  manual: { label: 'Otro (carga manual)' },
  member: { label: 'Socio' },
  concession: { label: 'Concesión' },
};

export const OTHER_INCOME_GROUPS = {
  uncategorized: 'Sin categorizar',
  cuotas: 'Cuotas y socias',
  eventos: 'Eventos / fiestas',
  deportes: 'Actividades deportivas',
  alquileres: 'Alquileres / salones',
  canon: 'Canon / concesiones',
  /** Rendición del portero: no es cuota ni entra al recaudado. */
  porteria: 'Portería / estacionamiento',
  varios: 'Varios',
};

/** Atajos de carga para la rendición de puerta. */
export const PORTERIA_INCOME_PRESETS = [
  {
    id: 'rendicion-porteria',
    label: 'Rendición portería',
    group: 'porteria',
    payerName: 'Portería',
    concept: 'Rendición portería',
    paymentMethod: 'efectivo',
  },
  {
    id: 'estacionamiento',
    label: 'Estacionamiento',
    group: 'porteria',
    payerName: 'Portería',
    concept: 'Rendición estacionamiento',
    paymentMethod: 'efectivo',
  },
];

/** Talonarios de invitados que portería puede rendir, al precio de temporada. */
export function porteriaGuestBookChoices(settings) {
  return [
    { id: 'guest-book-without', withPool: false },
    { id: 'guest-book-with', withPool: true },
  ].map(({ id, withPool }) => {
    const quote = poolGuestQuote(settings, { withPool, book: true });
    const place = withPool ? 'con pileta' : 'sin pileta';
    return {
      id,
      withPool,
      passes: quote.passes,
      amount: quote.amount,
      label: `Talonario ${quote.passes} invitados ${place}`,
    };
  });
}

export function porteriaGuestBookTotal(choice, quantity = 1) {
  const qty = Math.max(1, Math.floor(Number(quantity) || 1));
  if (!choice) return { quantity: qty, amount: 0, detail: '' };
  const amount = money(choice.amount * qty);
  const detail = qty > 1 ? `${qty} × ${choice.label}` : choice.label;
  return { quantity: qty, amount, detail };
}

export function isPorteriaIncomeItem(item) {
  if (!item || String(item.status || 'posted').toLowerCase() === 'void') return false;
  return item.group === 'porteria'
    || /porter[ií]a|estacionamiento/i.test(String(item.concept || ''));
}

/**
 * Si la nota declara un total (“total … $ 150.000”), lo devolvemos para contrastar
 * con el importe cargado y evitar otro desfasaje en caja.
 */
export function totalAmountHintFromNotes(notes) {
  const blob = String(notes || '');
  const match = blob.match(/total(?:\s+entre\s+efectivo\s+y\s+QR)?[^$0-9]{0,24}\$\s*([\d.]+)/i)
    || blob.match(/total[^$0-9]{0,16}([\d.]+)\s*(?:pesos|$)/i);
  if (!match) return null;
  const raw = String(match[1] || '').replace(/\./g, '');
  const amount = Number(raw);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function porterBookKey(item, porters) {
  const id = String(item?.renderedById || '').trim();
  if (id) return id;
  const name = String(item?.renderedBy || item?.payerName || '').trim().toLowerCase();
  const hit = (porters || []).find((porter) => String(porter?.fullName || '').trim().toLowerCase() === name);
  if (hit?.id) return hit.id;
  return name ? `name:${name}` : '';
}

/** Acumulado de cada portero: lo de hoy y el total de sus rendiciones. */
export function porterIncomeBooks(incomes = [], porters = [], today = '') {
  const day = String(today || '').slice(0, 10);
  const books = new Map();
  for (const porter of porters) {
    const id = String(porter?.id || '').trim();
    const name = String(porter?.fullName || '').trim();
    if (!id || !name) continue;
    books.set(id, { id, name, today: 0, total: 0, count: 0 });
  }
  for (const item of incomes) {
    if (!isPorteriaIncomeItem(item)) continue;
    const amount = money(item.amount);
    if (amount <= 0) continue;
    const key = porterBookKey(item, porters);
    if (!key) continue;
    let book = books.get(key);
    if (!book) {
      const name = String(item.renderedBy || item.payerName || 'Portero').trim();
      book = { id: key, name, today: 0, total: 0, count: 0 };
      books.set(key, book);
    }
    book.total = money(book.total + amount);
    book.count += 1;
    if (day && String(item.date || '').slice(0, 10) === day) {
      book.today = money(book.today + amount);
    }
  }
  return [...books.values()].sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

/**
 * Rendiciones agrupadas por fecha (más nueva primero).
 * Cada día lista lo que rindió cada portero ese día.
 */
export function porterIncomeBooksByDate(incomes = [], porters = []) {
  const byDate = new Map();
  for (const item of incomes) {
    if (!isPorteriaIncomeItem(item)) continue;
    const amount = money(item.amount);
    if (amount <= 0) continue;
    const day = String(item.date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    const key = porterBookKey(item, porters);
    if (!key) continue;
    let dayBooks = byDate.get(day);
    if (!dayBooks) {
      dayBooks = new Map();
      byDate.set(day, dayBooks);
    }
    let book = dayBooks.get(key);
    if (!book) {
      const name = String(item.renderedBy || item.payerName || 'Portero').trim()
        || (porters || []).find((porter) => String(porter?.id || '') === key)?.fullName
        || 'Portero';
      book = { id: key, name, total: 0, count: 0 };
      dayBooks.set(key, book);
    }
    book.total = money(book.total + amount);
    book.count += 1;
  }
  return [...byDate.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, map]) => {
      const books = [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'es'));
      return {
        date,
        books,
        total: money(books.reduce((sum, book) => sum + book.total, 0)),
        count: books.reduce((sum, book) => sum + book.count, 0),
      };
    });
}

export const PORTERIA_TABLE_PAGE_SIZE = 20;

export const OTHER_INCOME_PAYMENT_METHODS = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  cheque: 'Cheque',
  tarjeta: 'Pago POS',
  pos: 'Pago POS',
  mercadopago: 'Mercado Pago',
  debito: 'Débito automático',
  otro: 'Otro',
};

export const OTHER_INCOME_ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
export const OTHER_INCOME_ATTACHMENT_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
]);

export function validateOtherIncomeAttachment(file) {
  if (!file) throw new Error('Seleccioná un archivo.');
  if (file.size > OTHER_INCOME_ATTACHMENT_MAX_BYTES) {
    throw new Error('El archivo supera 5 MB.');
  }
  const type = file.type || '';
  const name = String(file.name || '').toLowerCase();
  const okType = OTHER_INCOME_ATTACHMENT_TYPES.has(type)
    || name.endsWith('.pdf')
    || name.endsWith('.jpg')
    || name.endsWith('.jpeg')
    || name.endsWith('.png');
  if (!okType) throw new Error('Solo PDF, JPG o PNG.');
  return true;
}

export function lineTotal(line) {
  const qty = Number(line?.quantity) || 0;
  const price = Number(line?.unitPrice) || 0;
  return Math.round(qty * price * 100) / 100;
}

export function linesTotal(lines = []) {
  return (lines || []).reduce((sum, line) => sum + lineTotal(line), 0);
}

export function createOtherIncome({
  date = todayAR(),
  payerType = 'manual',
  payerName = '',
  concept = '',
  group = 'uncategorized',
  paymentMethod = 'efectivo',
  amount = 0,
  lines = [],
  documentId = '',
  address = '',
  contact = '',
  operationRef = '',
  notes = '',
  signatureLegend = '',
  attachments = [],
  renderedBy = '',
  renderedById = '',
  receivedBy = '',
  receivedById = '',
  bookNumber = '',
}) {
  if (!OTHER_INCOME_PAYERS[payerType]) throw new Error('Origen inválido.');
  if (!OTHER_INCOME_PAYMENT_METHODS[paymentMethod]) throw new Error('Medio de cobro inválido.');
  if (!OTHER_INCOME_GROUPS[group]) throw new Error('Grupo inválido.');

  const name = String(payerName || '').trim();
  if (payerType === 'manual' && !name) {
    throw new Error('Indicá el nombre (carga manual).');
  }

  const conceptText = String(concept || '').trim();
  if (!conceptText) throw new Error('El concepto es obligatorio.');

  const cleanLines = (lines || [])
    .map((line) => ({
      id: line.id || `oil-${Math.random().toString(36).slice(2, 8)}`,
      description: String(line.description || '').trim(),
      quantity: Number(line.quantity) || 0,
      unitPrice: Number(line.unitPrice) || 0,
    }))
    .filter((line) => line.description || line.quantity || line.unitPrice);

  const fromLines = linesTotal(cleanLines);
  const rawAmount = fromLines > 0 ? fromLines : Number(amount);
  if (!Number.isFinite(rawAmount) || rawAmount <= 0) {
    throw new Error('El importe debe ser mayor a cero.');
  }

  return {
    id: `oi-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    date: String(date || '').slice(0, 10),
    payerType,
    payerTypeLabel: OTHER_INCOME_PAYERS[payerType].label,
    payerName: name || OTHER_INCOME_PAYERS[payerType].label,
    concept: conceptText,
    group,
    groupLabel: OTHER_INCOME_GROUPS[group],
    paymentMethod,
    paymentMethodLabel: OTHER_INCOME_PAYMENT_METHODS[paymentMethod],
    amount: Math.round(rawAmount * 100) / 100,
    lines: cleanLines,
    documentId: String(documentId || '').trim(),
    address: String(address || '').trim(),
    contact: String(contact || '').trim(),
    operationRef: String(operationRef || '').trim(),
    notes: String(notes || '').trim(),
    renderedBy: String(renderedBy || '').trim(),
    renderedById: String(renderedById || '').trim(),
    receivedBy: String(receivedBy || '').trim(),
    receivedById: String(receivedById || '').trim(),
    bookNumber: String(bookNumber || '').trim(),
    signatureLegend: String(signatureLegend || '').trim(),
    attachments: Array.isArray(attachments) ? attachments : [],
    status: 'posted',
    journalEntryId: null,
    createdAt: new Date().toISOString(),
  };
}

const INCOME_ACCOUNT_BY_GROUP = {
  cuotas: 'coa-4.1.01',
  eventos: 'coa-4.1.03',
  deportes: 'coa-4.1.02',
  alquileres: 'coa-4.1.02',
  canon: 'coa-4.1.04',
  porteria: 'coa-4.1.03',
  varios: 'coa-4.1.03',
  uncategorized: 'coa-4.1.03',
};

const TREASURY_ACCOUNT_BY_METHOD = {
  efectivo: 'coa-1.1.01',
  cheque: 'coa-1.1.01',
  tarjeta: 'coa-1.1.09',
  pos: 'coa-1.1.09',
  transferencia: 'coa-1.1.03',
  mercadopago: 'coa-1.1.08',
  debito: 'coa-1.1.03',
  otro: 'coa-1.1.01',
};

export function incomeAccountIdForGroup(group) {
  return INCOME_ACCOUNT_BY_GROUP[group] || INCOME_ACCOUNT_BY_GROUP.uncategorized;
}

export function treasuryAccountIdForMethod(paymentMethod) {
  return TREASURY_ACCOUNT_BY_METHOD[paymentMethod] || TREASURY_ACCOUNT_BY_METHOD.efectivo;
}

/** Debe caja/banco y acredita el ingreso. Fuente distinta de cobranzas de cuota. */
export function journalForOtherIncome(item, chart) {
  if (!item || String(item.status || 'posted').toLowerCase() === 'void') {
    throw new Error('Ingreso no encontrado.');
  }
  const amount = Math.round((Number(item.amount) || 0) * 100) / 100;
  if (amount <= 0) throw new Error('El importe debe ser mayor a cero.');

  const treasuryId = treasuryAccountIdForMethod(item.paymentMethod);
  const incomeId = incomeAccountIdForGroup(item.group);

  const isPorteria = item.group === 'porteria'
    || /porter[ií]a|estacionamiento/i.test(String(item.concept || ''));
  const who = String(item.renderedBy || '').trim();
  const prefix = isPorteria
    ? (/estacionamiento/i.test(String(item.concept || '')) ? 'Rendición estacionamiento' : 'Rendición portería')
    : 'Otro ingreso';
  const book = String(item.bookNumber || '').trim();
  const detail = String(item.notes || '').trim();
  let description = isPorteria && who
    ? `${prefix} — rindió ${who}`
    : `${prefix}: ${item.concept}${item.payerName ? ` — ${item.payerName}` : ''}`;
  const detailAlreadyHasBook = book
    && new RegExp(`talonario\\s*${book.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(detail);
  if (isPorteria && book && !detailAlreadyHasBook) description += ` · talonario ${book}`;
  if (isPorteria && detail) description += ` · ${detail}`;
  return buildPostedEntry({
    date: String(item.date || '').slice(0, 10),
    description,
    lines: [
      { accountId: treasuryId, debit: amount, credit: 0 },
      { accountId: incomeId, debit: 0, credit: amount },
    ],
    sourceModule: 'otros_ingresos',
    sourceId: item.id,
    chart,
  });
}
