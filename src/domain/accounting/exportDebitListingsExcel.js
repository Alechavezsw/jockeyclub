import { loadXlsx } from '../../lib/office.js';
import {
  buildDebitListingMatrix,
  debitListingSheetName,
  monthNameES,
  periodLabelES,
} from './debitListings';

function fileSlug(text) {
  return String(text || 'listado')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 56) || 'listado';
}

function colWidth(matrix, colIndex, fallback = 12) {
  let max = fallback;
  for (const row of matrix || []) {
    const len = String(row?.[colIndex] ?? '').length;
    if (len > max) max = len;
  }
  return Math.min(42, Math.max(fallback, max + 2));
}

/**
 * Descarga Excel con la misma estructura que docs/Debitos/Listados de Debitos 2026.xlsx.
 * @param {{ year: number, month: number, sheets: Array<{ sheetKind: string, rows: object[] }> }} input
 */
export async function exportDebitListingsExcel({
  year,
  month,
  sheets = [],
  fileName,
} = {}) {
  const XLSX = await loadXlsx();
  const y = Number(year);
  const m = Number(month);
  if (!y || !m) throw new Error('Falta el período del listado.');

  const wb = XLSX.utils.book_new();
  let totalRows = 0;

  for (const sheet of sheets) {
    const sheetKind = sheet.sheetKind === 'debito' ? 'debito' : 'credito';
    const rows = sheet.rows || [];
    const matrix = buildDebitListingMatrix(rows, { year: y, month: m, sheetKind });
    totalRows += rows.length;
    const ws = XLSX.utils.aoa_to_sheet(matrix.length ? matrix : [[null]]);
    // Tarjetas como texto (16 dígitos pierden precisión como Number).
    for (let r = 0; r < matrix.length; r += 1) {
      const card = matrix[r]?.[1];
      if (card && /^\d{13,19}$/.test(String(card))) {
        const addr = XLSX.utils.encode_cell({ r, c: 1 });
        ws[addr] = { t: 's', v: String(card) };
      }
    }
    ws['!cols'] = [
      { wch: 6 },
      { wch: colWidth(matrix, 1, 18) },
      { wch: 12 },
      { wch: 12 },
      { wch: 10 },
      { wch: 10 },
      { wch: 10 },
      { wch: 10 },
      { wch: 8 },
      { wch: colWidth(matrix, 9, 22) },
      { wch: colWidth(matrix, 10, 16) },
    ];
    const name = String(sheet.sourceSheet || debitListingSheetName(y, m, sheetKind))
      .trim()
      .slice(0, 31);
    XLSX.utils.book_append_sheet(wb, ws, name || debitListingSheetName(y, m, sheetKind));
  }

  if (!wb.SheetNames.length) {
    throw new Error('No hay hojas para exportar.');
  }

  const stamp = `${monthNameES(m)}_${y}`;
  const downloadName = fileName
    || `Listados de Debitos ${stamp}.xlsx`;
  XLSX.writeFile(wb, downloadName);
  return {
    fileName: downloadName,
    count: totalRows,
    label: periodLabelES(y, m),
    slug: fileSlug(downloadName),
  };
}
