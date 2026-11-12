import { loadJsPdf } from '../../lib/office.js';

function formatCurrency(amount) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 0,
  }).format(Number(amount) || 0);
}

const METHOD = {
  transfer: 'Transferencia',
  transferencia: 'Transferencia',
  cash: 'Efectivo',
  efectivo: 'Efectivo',
  debito: 'Débito',
  cheque: 'Cheque',
  mercadopago: 'Mercado Pago',
};

function formatDateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Recibo PDF de cobro de canon de concesión (detalle + trazabilidad). */
export async function downloadCanonReceiptPdf({ concession, payment }) {
  if (!payment) throw new Error('Pago no encontrado.');
  const { jsPDF } = await loadJsPdf();
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const gold = [180, 140, 50];

  doc.setFillColor(6, 14, 10);
  doc.rect(0, 0, 210, 36, 'F');
  doc.setTextColor(...gold);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('JOCKEY CLUB SAN JUAN', 14, 16);
  doc.setFontSize(10);
  doc.setTextColor(220, 220, 220);
  doc.text('Sede Rivadavia · Recibo de canon de concesión', 14, 24);
  doc.text(`N° ${payment.receipt || payment.id}`, 196, 16, { align: 'right' });

  doc.setTextColor(30, 30, 30);
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text('Concesión', 14, 50);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`Nombre: ${concession?.name || '—'}`, 14, 58);
  doc.text(`Concesionario: ${concession?.concessionaire || '—'}`, 14, 64);
  doc.text(`CUIT: ${concession?.cuit || '—'}`, 14, 70);
  doc.text(`Portal: ${concession?.portalCode || '—'}`, 14, 76);
  doc.text(`Ubicación: ${concession?.location || '—'}`, 14, 82);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('Detalle del cobro', 14, 96);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`Período: ${payment.period || '—'}`, 14, 104);
  doc.text(`Fecha del canon: ${payment.date || '—'}`, 14, 110);
  doc.text(`Medio: ${METHOD[payment.method] || payment.method || '—'}`, 14, 116);
  doc.text(`Importe: ${formatCurrency(payment.amount)}`, 14, 122);
  if (payment.note) doc.text(`Nota: ${payment.note}`, 14, 128);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('Trazabilidad', 14, 144);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`Cargó: ${payment.recordedByName || '—'}`, 14, 152);
  doc.text(`Fecha y hora: ${formatDateTime(payment.recordedAt)}`, 14, 158);
  if (payment.cashMovementId) {
    doc.text(`Movimiento de caja: ${payment.cashMovementId}`, 14, 164);
  }
  if (payment.journalEntryId) {
    doc.text(`Asiento: ${payment.journalEntryId}`, 14, payment.cashMovementId ? 170 : 164);
  }

  doc.setDrawColor(...gold);
  doc.setLineWidth(0.4);
  doc.line(14, 180, 196, 180);
  doc.setFontSize(9);
  doc.setTextColor(100, 100, 100);
  doc.text(
    'Comprobante del módulo de Concesiones. El cobro ingresa a caja y queda registrado con fecha, hora y quien lo cargó.',
    14,
    190,
    { maxWidth: 180 },
  );
  doc.text(`Emitido: ${new Date().toLocaleString('es-AR')}`, 14, 200);

  const file = `canon-${payment.receipt || payment.id}.pdf`;
  doc.save(file);
  return file;
}
