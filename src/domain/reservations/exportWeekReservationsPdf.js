import { loadAutoTable, loadJsPdf } from '../../lib/office.js';
import {
  BRAND,
  drawReportFooter,
  drawReportHeader,
  loadClubLogoDataUrl,
} from '../reports/pdfBrand';
import { todayAR } from '../../lib/arDate';
import { reservationTotalPrice } from './bookingRules';

function parseDay(iso) {
  const key = String(iso || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d, 12, 0, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toIso(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Semana lunes–domingo que contiene el día (YYYY-MM-DD o hoy AR). */
export function weekRangeContaining(isoDay = todayAR()) {
  const base = parseDay(isoDay) || parseDay(todayAR());
  const weekday = base.getDay(); // 0 = domingo
  const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
  const monday = new Date(base);
  monday.setDate(base.getDate() + mondayOffset);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const from = toIso(monday);
  const to = toIso(sunday);
  const label = `${monday.toLocaleDateString('es-AR', {
    day: 'numeric',
    month: 'short',
  })} – ${sunday.toLocaleDateString('es-AR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })}`.replace(/\./g, '');
  return { from, to, label, monday, sunday };
}

function statusLabel(status) {
  if (status === 'confirmed') return 'Confirmada';
  if (status === 'pending') return 'Pendiente';
  if (status === 'rejected') return 'Rechazada';
  if (status === 'cancelled') return 'Cancelada';
  return String(status || '—');
}

function formatMoney(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return '—';
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(v);
}

function formatDayLabel(iso) {
  const date = parseDay(iso);
  if (!date) return iso || '—';
  return date.toLocaleDateString('es-AR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).replace(/\./g, '');
}

export function buildWeekReservationsModel(reservations = [], { weekOf = todayAR() } = {}) {
  const range = weekRangeContaining(weekOf);
  const rows = (Array.isArray(reservations) ? reservations : [])
    .filter((res) => {
      const day = String(res?.date || '').slice(0, 10);
      return day >= range.from && day <= range.to;
    })
    .toSorted((a, b) => {
      const byDate = String(a.date || '').localeCompare(String(b.date || ''));
      if (byDate !== 0) return byDate;
      return String(a.time || '').localeCompare(String(b.time || ''));
    })
    .map((res) => ({
      day: formatDayLabel(res.date),
      date: String(res.date || '').slice(0, 10),
      time: res.time || '—',
      endTime: res.endTime || '',
      facility: res.facilityName || res.facilityId || '—',
      member: res.memberName || '—',
      memberId: res.memberId || '—',
      status: statusLabel(res.status),
      statusRaw: res.status,
      amount: formatMoney(res.chargedPrice || reservationTotalPrice(null, res)),
      notes: String(res.notes || '').trim(),
    }));

  return { ...range, rows, total: rows.length };
}

/** PDF de todas las reservas de la semana (lun–dom). */
export async function exportWeekReservationsPdf(reservations = [], {
  weekOf = todayAR(),
  fileName,
} = {}) {
  const [{ jsPDF }, autoTableMod, logoDataUrl] = await Promise.all([
    loadJsPdf(),
    loadAutoTable(),
    loadClubLogoDataUrl(),
  ]);
  const autoTable = autoTableMod.default;
  const model = buildWeekReservationsModel(reservations, { weekOf });
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const generatedAt = new Date().toLocaleString('es-AR');
  const stamp = model.from.replace(/-/g, '');
  const downloadName = fileName || `jockey_club_reservas_semana_${stamp}.pdf`;

  const startY = drawReportHeader(doc, {
    title: 'Reservas de la semana',
    subtitle: `Semana ${model.label}`,
    metaLine: `${model.total.toLocaleString('es-AR')} reserva${model.total === 1 ? '' : 's'}  ·  ${generatedAt}`,
    logoDataUrl,
  });

  const body = model.rows.map((row) => [
    row.day,
    row.endTime ? `${row.time}–${row.endTime}` : row.time,
    row.facility,
    row.member,
    String(row.memberId),
    row.status,
    row.amount,
    row.notes || '—',
  ]);

  autoTable(doc, {
    startY,
    head: [['Día', 'Horario', 'Espacio', 'Socio', 'Nº', 'Estado', 'Importe', 'Notas']],
    body: body.length
      ? body
      : [['—', '', 'Sin reservas esta semana', '', '', '', '', '']],
    styles: {
      fontSize: 8,
      cellPadding: 2,
      overflow: 'linebreak',
      valign: 'top',
    },
    headStyles: {
      fillColor: BRAND.green,
      textColor: BRAND.cream,
      fontStyle: 'bold',
      valign: 'middle',
    },
    alternateRowStyles: { fillColor: [248, 246, 240] },
    columnStyles: {
      0: { cellWidth: 24 },
      1: { cellWidth: 22 },
      2: { cellWidth: 36 },
      3: { cellWidth: 40 },
      4: { cellWidth: 18 },
      5: { cellWidth: 24 },
      6: { cellWidth: 24, halign: 'right' },
      7: { cellWidth: 'auto', fontSize: 7.5 },
    },
    margin: { left: 12, right: 12 },
    didParseCell(data) {
      if (data.section !== 'body') return;
      if (data.column.index === 5) {
        const status = model.rows[data.row.index]?.statusRaw;
        if (status === 'cancelled' || status === 'rejected') {
          data.cell.styles.textColor = [180, 40, 40];
        } else if (status === 'pending') {
          data.cell.styles.textColor = [180, 110, 20];
        } else if (status === 'confirmed') {
          data.cell.styles.textColor = [20, 120, 80];
        }
      }
      if (data.column.index === 7) {
        const notes = model.rows[data.row.index]?.notes;
        if (notes) {
          data.cell.styles.fontStyle = 'italic';
          data.cell.styles.textColor = [40, 55, 48];
        } else {
          data.cell.styles.textColor = [150, 150, 150];
        }
      }
    },
  });

  drawReportFooter(doc);
  doc.save(downloadName);
  return downloadName;
}
