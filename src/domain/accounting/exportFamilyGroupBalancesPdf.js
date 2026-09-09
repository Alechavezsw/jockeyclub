import {
  BRAND,
  CLUB_NAME,
  CLUB_SEDE,
  drawReportFooter,
  drawReportHeader,
  loadClubLogoDataUrl,
} from '../reports/pdfBrand';
import {
  ACCESSIN_FAMILY_GROUP_BALANCES_BY_NAME,
  ACCESSIN_FAMILY_GROUP_BALANCES_SNAPSHOT,
  normalizeFamilyGroupKey,
} from './familyGroupBalances';

function money(n) {
  return `$ ${Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function listFamilyGroupBalancesForReport({ query = '' } = {}) {
  const q = normalizeFamilyGroupKey(query);
  const seen = new Set();
  const groups = [];
  Object.values(ACCESSIN_FAMILY_GROUP_BALANCES_BY_NAME || {}).forEach((g) => {
    if (!g || seen.has(g.key)) return;
    seen.add(g.key);
    if (q && !g.key.includes(q) && !String(g.name || '').toLowerCase().includes(query.toLowerCase())) return;
    groups.push(g);
  });
  return groups.toSorted((a, b) => Math.abs(b.total) - Math.abs(a.total) || a.name.localeCompare(b.name));
}

export async function exportFamilyGroupBalancesPdf({ query = '' } = {}) {
  const groups = listFamilyGroupBalancesForReport({ query });
  const [{ jsPDF }, autoTableMod, logoDataUrl] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    loadClubLogoDataUrl(),
  ]);
  const autoTable = autoTableMod.default;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const stamp = ACCESSIN_FAMILY_GROUP_BALANCES_SNAPSHOT.asOf || new Date().toISOString().slice(0, 10);

  autoTable(doc, {
    startY: drawReportHeader(doc, {
      title: 'Saldos de grupo familiar',
      subtitle: `${CLUB_NAME} · ${CLUB_SEDE}`,
      metaLine: `Al ${ACCESSIN_FAMILY_GROUP_BALANCES_SNAPSHOT.asOfLabel || stamp}  ·  ${groups.length} grupos`,
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
