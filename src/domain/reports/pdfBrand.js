export const CLUB_NAME = 'Jockey Club San Juan';
export const CLUB_SEDE = 'Sede Rivadavia';
export const LOGO_URL = '/logo-jockey-club.png';

export const BRAND = {
  green: [9, 103, 85],
  gold: [202, 57, 12],
  cream: [245, 230, 180],
  muted: [100, 100, 100],
};

/** Carga el logo institucional como data URL para jsPDF. */
export async function loadClubLogoDataUrl(url = LOGO_URL) {
  try {
    const res = await fetch(url || LOGO_URL);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/**
 * Pastilla crema redondeada — mismo tratamiento que el boleto de pago.
 * El logo va sobre el fondo claro para no perderse en la barra verde.
 */
export function drawLogoPastilla(doc, logoDataUrl, { x = 8, y = 3.4, size = 18 } = {}) {
  const pad = 2.1;
  const box = size + pad * 2;
  doc.setFillColor(255, 250, 244);
  doc.roundedRect(x, y, box, box, 6.2, 6.2, 'F');
  if (logoDataUrl) {
    doc.addImage(logoDataUrl, 'PNG', x + pad, y + pad, size, size);
  }
  return { width: box, height: box, textX: x + box + 4 };
}

/** Pastilla de medio de pago (ej. Transferencia bancaria). */
export function drawLabelPastilla(doc, label, {
  x = 14,
  y = 40,
  fill = [255, 255, 255],
  textColor = BRAND.green,
  border = BRAND.gold,
} = {}) {
  const text = String(label || '').trim();
  if (!text) return { width: 0, height: 0 };
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  const padX = 3.2;
  const h = 6.4;
  const w = Math.min(doc.getTextWidth(text) + padX * 2, 90);
  doc.setFillColor(...fill);
  doc.roundedRect(x, y, w, h, h / 2, h / 2, 'F');
  if (border) {
    doc.setDrawColor(...border);
    doc.setLineWidth(0.35);
    doc.roundedRect(x, y, w, h, h / 2, h / 2, 'S');
  }
  doc.setTextColor(...textColor);
  doc.text(text, x + padX, y + 4.3);
  return { width: w, height: h };
}

/**
 * Encabezado institucional con logo.
 * @returns {number} coordenada Y sugerida para el contenido
 */
export function drawReportHeader(doc, {
  title,
  subtitle = '',
  metaLine = '',
  logoDataUrl = null,
} = {}) {
  const pageW = doc.internal.pageSize.getWidth();
  doc.setFillColor(...BRAND.green);
  doc.rect(0, 0, pageW, 30, 'F');

  let textX = 14;
  if (logoDataUrl) {
    try {
      textX = drawLogoPastilla(doc, logoDataUrl).textX;
    } catch {
      /* logo opcional */
    }
  }

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(CLUB_NAME, textX, 13);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(title || 'Informe', textX, 22);

  let y = 34;
  if (subtitle) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(40, 40, 40);
    doc.text(subtitle, 14, y);
    y += 5;
  }
  if (metaLine) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...BRAND.muted);
    doc.text(metaLine, 14, y);
    y += 5;
  }

  doc.setDrawColor(...BRAND.gold);
  doc.setLineWidth(0.4);
  doc.line(14, y, pageW - 14, y);
  return y + 4;
}

export function drawReportFooter(doc) {
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i += 1) {
    doc.setPage(i);
    const h = doc.internal.pageSize.getHeight();
    const w = doc.internal.pageSize.getWidth();
    doc.setDrawColor(...BRAND.gold);
    doc.setLineWidth(0.3);
    doc.line(14, h - 12, w - 14, h - 12);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...BRAND.muted);
    doc.text(CLUB_NAME, 14, h - 7);
    doc.text(`Página ${i} de ${pageCount}`, w - 14, h - 7, { align: 'right' });
  }
}
