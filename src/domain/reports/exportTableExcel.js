function fileSlug(text) {
  return String(text || 'lista')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 48) || 'lista';
}

/**
 * Descarga un Excel de una lista (encabezados + filas).
 */
export async function exportTableExcel({
  title = 'Lista',
  sheetName = 'Lista',
  headers = [],
  rows = [],
  fileName,
} = {}) {
  const XLSX = await import('xlsx');
  const stamp = new Date().toISOString().slice(0, 10);
  const downloadName = fileName || `jockey_club_${fileSlug(title)}_${stamp}.xlsx`;
  const aoa = [headers, ...rows.map((row) => headers.map((_, index) => (
    Array.isArray(row) ? (row[index] ?? '') : ''
  )))];

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = headers.map((header, index) => {
    const widest = aoa.reduce((max, line) => Math.max(max, String(line[index] ?? '').length), String(header).length);
    return { wch: Math.min(48, Math.max(10, widest + 2)) };
  });
  if (aoa.length > 1) {
    const lastCol = String.fromCharCode(64 + Math.min(headers.length, 26));
    ws['!autofilter'] = { ref: `A1:${lastCol}${aoa.length}` };
  }
  XLSX.utils.book_append_sheet(wb, ws, String(sheetName || 'Lista').slice(0, 31));
  XLSX.writeFile(wb, downloadName);
  return { fileName: downloadName, count: rows.length };
}

export function slugForExcel(text) {
  return fileSlug(text);
}
