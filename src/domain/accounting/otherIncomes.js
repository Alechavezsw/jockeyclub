/** Otros ingresos / cobros manuales (estilo LILA). */

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
  varios: 'Varios',
};

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
    createdAt: new Date().toISOString(),
  };
}
