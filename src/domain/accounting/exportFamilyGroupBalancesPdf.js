import {
  BRAND,
  CLUB_NAME,
  CLUB_SEDE,
  drawReportFooter,
  drawReportHeader,
  loadClubLogoDataUrl,
} from '../reports/pdfBrand';
import { requireSnapshots } from '../../data/snapshots';
import { familyGroupBalancesSeed, listFamilyGroupBalances } from './familyGroupBalances';

function money(n) {
  return `$ ${Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function listFamilyGroupBalancesForReport({ query = '', onlyWithBalance = false, sign = 'all' } = {}) {
  return listFamilyGroupBalances({ query, onlyWithBalance, sign });
}

export async function exportFamilyGroupBalancesPdf({ query = '', onlyWithBalance = false, sign = 'all' } = {}) {
  await requireSnapshots(['accessinFamilyGroupBalances']);
  const snapshot = familyGroupBalancesSeed().ACCESSIN_FAMILY_GROUP_BALANCES_SNAPSHOT;
  const groups = listFamilyGroupBalances({ query, onlyWithBalance, sign });
  const [{ jsPDF }, autoTableMod, logoDataUrl] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    loadClubLogoDataUrl(),
  ]);
  const autoTable = autoTableMod.default;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const stamp = snapshot.asOf || new Date().toISOString().slice(0, 10);

  autoTable(doc, {
    startY: drawReportHeader(doc, {
      title: 'Saldos de grupo familiar',
      subtitle: `${CLUB_NAME} · ${CLUB_SEDE}`,
      metaLine: `Al ${snapshot.asOfLabel || stamp}  ·  ${groups.length} grupos`,
      logoDataUrl,
    }),
    head: [['Grupo', 'Meses', 'Total']],
    body: groups.map((g) => [g.name, String((g.months || []).length), money(g.total)]),
    styles: { fontSize: 8, cellPadding: 1.8 },
    headStyles: { fillColor: BRAND.green, textColor: BRAND.cream },
    margin: { left: 14, right: 14 },
  });
  drawReportFooter(doc);
  const fileName = `jockey_club_saldos_grupo_familiar_${stamp}.pdf`;
  doc.save(fileName);
  return fileName;
}
