/**
 * PDF de ficha individual del socio (padrón). No es recibo de cuota ni credencial.
 */

import { loadJsPdf } from '../../lib/office.js';
import {
  BRAND,
  CLUB_NAME,
  CLUB_SEDE,
  drawReportFooter,
  drawReportHeader,
  loadClubLogoDataUrl,
} from '../reports/pdfBrand.js';
import {
  duesStandingDisplayAmount,
  memberDuesStandingSummary,
} from '../accounting/appMonthlyDebts.js';
import { isDuesExemptMember } from './dues.js';
import { formatInstantAR, todayAR } from '../../lib/arDate.js';
import { getTierDisplayName } from './tiers.js';
import {
  householdRoleLabel,
  isFamilyDependent,
  memberNumberOf,
} from './households.js';
import { membershipTenureLabel } from './membership.js';

function money(amount) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(Number(amount) || 0);
}

function titleCase(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw.replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function formatShortDate(value) {
  const raw = String(value || '').slice(0, 10);
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return raw || '—';
  return `${match[3]}/${match[2]}/${match[1]}`;
}

function statusLabel(status) {
  if (status === 'inactive') return 'Inactivo / baja';
  if (status === 'suspended') return 'Suspendido';
  if (status === 'pending') return 'Pendiente';
  return 'Cuenta habilitada';
}

function fileSlug(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

/**
 * Modelo imprimible de la ficha.
 */
export function buildMemberFichaModel(member, {
  tierCatalog,
  household = [],
  formatCurrency = money,
  asOf = new Date(),
} = {}) {
  if (!member) return null;
  const nro = memberNumberOf(member) || String(member.memberId || '—');
  const tier = getTierDisplayName(member.tier, tierCatalog) || member.tier || '—';
  const role = isFamilyDependent(member)
    ? (householdRoleLabel(member) || 'Integrante')
    : 'Titular';
  const standing = memberDuesStandingSummary(member, { today: asOf });
  const duesExempt = isDuesExemptMember(member);
  const address = [
    member.address,
    [member.city, member.province].filter(Boolean).join(', '),
    member.postalCode ? `CP ${member.postalCode}` : null,
  ].filter(Boolean).join(' · ') || '—';
  const tenure = membershipTenureLabel(member) || '';
  const family = (household || [])
    .map((row) => {
      const id = memberNumberOf(row) || row.memberId || '';
      if (!id || id === nro) return null;
      return {
        name: row.name || row.fullName || row.full_name || `Socio ${id}`,
        memberId: id,
        role: isFamilyDependent(row)
          ? (householdRoleLabel(row) || 'Integrante')
          : 'Titular',
        tier: getTierDisplayName(row.tier, tierCatalog) || row.tier || '',
      };
    })
    .filter(Boolean);

  const duesLine = duesExempt
    ? 'Exento de cuota social'
    : (standing.clear
      ? (standing.title || 'Al día')
      : `${duesStandingDisplayAmount(standing, formatCurrency)} · ${standing.monthsPhrase || standing.hint || 'Con saldo'}`);

  return {
    club: CLUB_NAME,
    title: 'Ficha del socio',
    name: String(member.name || '').trim() || '—',
    memberId: nro,
    tier: `${tier}${role === 'Titular' ? ' (titular)' : ` (${role})`}`,
    status: statusLabel(member.status),
    tenure,
    rows: [
      ['Documento', [member.documentType || 'DNI', member.documentNumber].filter(Boolean).join(' ') || '—'],
      ['Nacimiento', formatShortDate(member.birthDate)],
      ['Género', titleCase(member.gender) || '—'],
      ['Estado civil', titleCase(member.maritalStatus) || '—'],
      ['Nacionalidad', member.nationality || 'Argentina'],
      ['WhatsApp', member.phone || '—'],
      ['Tel. alternativo', member.phoneAlt || '—'],
      ['Email', member.email || '—'],
      ['Domicilio', address],
      ['Ingreso al club', formatShortDate(member.joinDate || member.createdAt) + (tenure ? ` · ${tenure}` : '')],
      ['Categoría', tier],
      ['Rol en el hogar', role],
      ['Estado', statusLabel(member.status)],
      ['Cuota social', duesLine],
      ['Medio de pago', titleCase(member.paymentMethod) || '—'],
      ['Grupo sanguíneo', member.bloodType || member.meta?.bloodType || '—'],
      ['Obra social', member.healthInsurance || member.meta?.healthInsurance || '—'],
      ['Emergencia', [member.emergencyContact, member.emergencyPhone].filter(Boolean).join(' · ') || '—'],
    ],
    family,
    note: 'Documento interno del padrón. No reemplaza la credencial ni el recibo de cuota.',
    issuedAt: formatInstantAR(asOf instanceof Date ? asOf.toISOString() : asOf) || String(asOf),
    fileName: `ficha-socio-${fileSlug(nro)}-${todayAR().replace(/-/g, '')}.pdf`,
  };
}

export async function downloadMemberFichaPdf(member, options = {}) {
  const model = buildMemberFichaModel(member, options);
  if (!model) throw new Error('No hay socio para la ficha.');

  const [{ jsPDF }, logoDataUrl] = await Promise.all([
    loadJsPdf(),
    loadClubLogoDataUrl(),
  ]);
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();

  let y = drawReportHeader(doc, {
    title: model.title,
    subtitle: `${CLUB_NAME} · ${CLUB_SEDE}`,
    metaLine: `Credencial ${model.memberId} · Emitido: ${model.issuedAt}`,
    logoDataUrl,
  });

  y += 2;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(...BRAND.green);
  doc.text(model.name, 14, y);
  y += 7;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(40, 40, 40);
  doc.text(`Nº ${model.memberId} · ${model.tier}`, 14, y);
  y += 5;
  doc.text(model.status, 14, y);
  y += 8;

  doc.setDrawColor(...BRAND.green);
  doc.setLineWidth(0.3);
  doc.line(14, y, pageW - 14, y);
  y += 8;

  for (const [label, value] of model.rows) {
    if (y > 270) {
      drawReportFooter(doc);
      doc.addPage();
      y = drawReportHeader(doc, {
        title: `${model.title} (cont.)`,
        subtitle: `${model.name} · Nº ${model.memberId}`,
        metaLine: model.issuedAt,
        logoDataUrl,
      }) + 4;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...BRAND.muted);
    doc.text(String(label).toUpperCase(), 16, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(30, 30, 30);
    const lines = doc.splitTextToSize(String(value || '—'), pageW - 78);
    doc.text(lines, 62, y);
    y += Math.max(6.2, lines.length * 4.6);
  }

  if (model.family.length) {
    y += 4;
    if (y > 250) {
      drawReportFooter(doc);
      doc.addPage();
      y = drawReportHeader(doc, {
        title: `${model.title} (cont.)`,
        subtitle: `${model.name} · Nº ${model.memberId}`,
        metaLine: model.issuedAt,
        logoDataUrl,
      }) + 4;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...BRAND.green);
    doc.text('Grupo familiar', 14, y);
    y += 6;
    for (const person of model.family) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(30, 30, 30);
      const line = `${person.name} · Nº ${person.memberId} · ${person.role}${person.tier ? ` · ${person.tier}` : ''}`;
      const wrapped = doc.splitTextToSize(line, pageW - 28);
      doc.text(wrapped, 16, y);
      y += Math.max(5.5, wrapped.length * 4.4);
    }
  }

  y += 6;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(100, 100, 100);
  doc.text(model.note, 14, y, { maxWidth: pageW - 28 });

  drawReportFooter(doc);
  doc.save(model.fileName);
  return model;
}
