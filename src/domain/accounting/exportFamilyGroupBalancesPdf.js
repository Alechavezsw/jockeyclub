import { loadAutoTable, loadJsPdf } from '../../lib/office.js';
import {

  BRAND,
  CLUB_NAME,
  CLUB_SEDE,
  drawReportFooter,
  drawReportHeader,
  loadClubLogoDataUrl,
} from '../reports/pdfBrand';
import { todayAR } from '../../lib/arDate';

function money(n) {
  return `$ ${Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export async function exportFamilyGroupBalancesPdf({
  groups = [],
  asOfLabel = '',
} = {}) {
  const [{ jsPDF }, autoTableMod, logoDataUrl] = await Promise.all([
    loadJsPdf(),
    loadAutoTable(),
    loadClubLogoDataUrl(),
  ]);
  const autoTable = autoTableMod.default;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const stamp = todayAR();

  autoTable(doc, {
    startY: drawReportHeader(doc, {
      title: 'Saldos de grupo familiar',
      subtitle: `${CLUB_NAME} · ${CLUB_SEDE}`,
      metaLine: `Al ${asOfLabel || stamp}  ·  ${groups.length} grupos`,
      logoDataUrl,
    }),
    head: [['Grupo', 'Socio', 'Integrantes', 'Total']],
    body: groups.map((g) => [
      g.name,
      g.memberNumber || '—',
      String(g.size || (g.months || []).length || '—'),
      money(g.total),
    ]),
    styles: { fontSize: 8, cellPadding: 1.8 },
    headStyles: { fillColor: BRAND.green, textColor: BRAND.cream },
    margin: { left: 14, right: 14 },
  });
  drawReportFooter(doc);
  const fileName = `jockey_club_saldos_grupo_familiar_${stamp}.pdf`;
  doc.save(fileName);
  return fileName;
}
