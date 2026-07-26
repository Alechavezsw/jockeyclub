import { jsPDF } from 'jspdf';

function formatCurrency(amount) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 0,
  }).format(Number(amount) || 0);
}

const METHOD = {
  transferencia: 'Transferencia bancaria',
  efectivo: 'Efectivo',
  debito: 'Débito automático',
  tarjeta: 'Tarjeta',
  caja: 'Caja / Secretaría',
  mercadopago: 'Mercado Pago',
};

/** Recibo PDF de un pago de socio. */
export function downloadPaymentReceiptPdf({ member, payment }) {
  if (!payment) throw new Error('Pago no encontrado.');
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
  doc.text('Sede Rivadavia · Comprobante de pago', 14, 24);
  doc.text(`N° ${payment.receipt || payment.id}`, 196, 16, { align: 'right' });

  doc.setTextColor(30, 30, 30);
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text('Datos del socio', 14, 50);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`Nombre: ${member?.name || '—'}`, 14, 58);
  doc.text(`Credencial: ${member?.memberId || '—'}`, 14, 64);
  doc.text(`Categoría: ${(member?.tier || '').toUpperCase()}`, 14, 70);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('Detalle del pago', 14, 86);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`Concepto: ${payment.concept || 'Cuota social'}`, 14, 94);
  doc.text(`Fecha: ${payment.date}`, 14, 100);
  doc.text(`Medio: ${METHOD[payment.method] || payment.method || '—'}`, 14, 106);
  doc.text(`Importe: ${formatCurrency(payment.amount)}`, 14, 112);
  doc.text(`Estado: ${(payment.status || 'paid').toUpperCase()}`, 14, 118);

  doc.setDrawColor(...gold);
  doc.setLineWidth(0.4);
  doc.line(14, 128, 196, 128);

  doc.setFontSize(9);
  doc.setTextColor(100, 100, 100);
  doc.text(
    'Comprobante emitido por el Portal del Socio. Conservelo como constancia de pago.',
    14,
    138,
    { maxWidth: 180 }
  );
  doc.text(`Emitido: ${new Date().toLocaleString('es-AR')}`, 14, 148);

  const file = `recibo-${payment.receipt || payment.id}.pdf`;
  doc.save(file);
  return file;
}
