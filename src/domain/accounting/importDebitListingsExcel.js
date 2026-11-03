import { loadXlsx } from '../../lib/office.js';
import {
  parseDebitListingMatrix,
  parseDebitListingSheetName,
} from './debitListings';

/** Período desde el nombre de hoja o, si falta, del nombre de archivo. */
export function periodMetaFromNames(sheetName = '', fileName = '') {
  const fromSheet = parseDebitListingSheetName(sheetName);
  if (fromSheet.year && fromSheet.month) return fromSheet;
  const fromFile = parseDebitListingSheetName(String(fileName || '').replace(/\.[^.]+$/, ''));
  return {
    sheetKind: fromSheet.sheetKind || fromFile.sheetKind || 'credito',
    year: fromFile.year || null,
    month: fromFile.month || null,
    sourceSheet: String(sheetName || fileName || '').trim(),
  };
}

/**
 * Lee un Excel/XLSM con la misma estructura que docs/Debitos/Listados de Debitos 2026.xlsx
 */
export async function parseDebitListingsExcelFile(file) {
  if (!file) throw new Error('Elegí un archivo Excel (.xlsx / .xlsm).');
  const XLSX = await loadXlsx();
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: 'array', cellDates: false });
  if (!wb.SheetNames?.length) throw new Error('El Excel no tiene hojas.');

  const fileName = file.name || 'listado.xlsx';
  const rows = [];
  const sheets = [];
  for (const name of wb.SheetNames) {
    const meta = periodMetaFromNames(name, fileName);
    if (!meta.year || !meta.month) {
      sheets.push({ name, skipped: true, reason: 'sin período en hoja ni archivo' });
      continue;
    }
    const matrix = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' });
    const parsed = parseDebitListingMatrix(matrix, {
      ...meta,
      sourceSheet: name,
    });
    sheets.push({
      name,
      year: meta.year,
      month: meta.month,
      sheetKind: meta.sheetKind,
      count: parsed.length,
    });
    rows.push(...parsed);
  }

  if (!rows.length) {
    throw new Error(
      'No se encontraron filas de planilla. Usá Listados con hojas tipo «Mes Año» / «Mes debito Año».',
    );
  }

  return {
    fileName,
    rows,
    sheets,
    periods: [...new Set(rows.map((r) => `${r.year}-${String(r.month).padStart(2, '0')}`))].toSorted(),
  };
}
