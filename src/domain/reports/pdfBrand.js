export const CLUB_NAME = 'Jockey Club San Juan';
export const CLUB_SEDE = 'Sede Rivadavia';
export const LOGO_URL = '/logo-jockey-club.png';

export const BRAND = {
  green: [30, 58, 40],
  gold: [180, 140, 50],
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
  doc.rect(0, 0, pageW, 28, 'F');

  let textX = 14;
  if (logoDataUrl) {
    try {
      doc.addImage(logoDataUrl, 'PNG', 10, 4, 20, 20);
      textX = 34;
    } catch {
      /* logo opcional */
    }
  }

  doc.setTextColor(...BRAND.gold);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(CLUB_NAME, textX, 11);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(230, 230, 220);
  doc.text(CLUB_SEDE, textX, 17);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(255, 255, 255);
  doc.text(title || 'Informe', textX, 24);

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
    doc.text(`${CLUB_NAME} · ${CLUB_SEDE}`, 14, h - 7);
    doc.text(`Página ${i} de ${pageCount}`, w - 14, h - 7, { align: 'right' });
  }
}
