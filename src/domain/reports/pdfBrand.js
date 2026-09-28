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
export async function loadClubLogoDataUrl() {
  try {
    const res = await fetch(LOGO_URL);
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

/** Pastilla crema para que el logo no se pierda sobre la barra verde. */
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
