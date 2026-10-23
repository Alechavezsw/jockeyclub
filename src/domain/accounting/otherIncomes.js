/** Otros ingresos / cobros manuales (estilo LILA). */

import { buildPostedEntry } from './journal';

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

export const OTHER_INCOME_PAYMENT_METHODS = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  cheque: 'Cheque',
  tarjeta: 'Tarjeta',
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
  date = new Date().toISOString().slice(0, 10),
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
  tarjeta: 'coa-1.1.01',
  transferencia: 'coa-1.1.03',
  mercadopago: 'coa-1.1.03',
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
  const prefix = isPorteria ? 'Rendición portería' : 'Otro ingreso';
  return buildPostedEntry({
    date: String(item.date || '').slice(0, 10),
    description: `${prefix}: ${item.concept}${item.payerName ? ` — ${item.payerName}` : ''}`,
    lines: [
      { accountId: treasuryId, debit: amount, credit: 0 },
      { accountId: incomeId, debit: 0, credit: amount },
    ],
    sourceModule: 'otros_ingresos',
    sourceId: item.id,
    chart,
  });
}
