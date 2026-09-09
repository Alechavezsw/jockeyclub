import {
  BRAND,
  CLUB_NAME,
  CLUB_SEDE,
  drawReportFooter,
  drawReportHeader,
  loadClubLogoDataUrl,
} from '../reports/pdfBrand';
import { lookupDetailedCc, periodLabelFromKey } from './detailedCurrentAccounts';

function money(n) {
  return `$ ${Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export async function exportDetailedCcPdf(memberNumber) {
  const detail = lookupDetailedCc(memberNumber);
  if (!detail) throw new Error('Socio. Es obligatorio');
  const [{ jsPDF }, autoTableMod, logoDataUrl] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    loadClubLogoDataUrl(),
  ]);
  const autoTable = autoTableMod.default;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const stamp = new Date().toISOString().slice(0, 10);

  autoTable(doc, {
    startY: drawReportHeader(doc, {
      title: 'Cuenta corriente detallada',
      subtitle: `${CLUB_NAME} · ${CLUB_SEDE}`,
      metaLine: `${detail.memberNumber} · ${detail.memberName}  ·  Adeudado ${money(detail.totalOwed)}`,
      logoDataUrl,
    }),
    head: [['#', 'Período', 'Fecha', 'Monto', 'Pago', 'Adeudado']],
    body: (detail.lines || []).map((l) => [
      String(l.id),
      periodLabelFromKey(l.periodKey),
      l.feeDate || '—',
      money(l.amount),
      money(l.paid),
      money(l.owed),
    ]),
    styles: { fontSize: 8, cellPadding: 1.8 },
    headStyles: { fillColor: BRAND.green, textColor: BRAND.cream },
    margin: { left: 14, right: 14 },
  });
  drawReportFooter(doc);
  const fileName = `jockey_club_cc_detallada_${detail.memberNumber}_${stamp}.pdf`;
  doc.save(fileName);
  return fileName;
}
