import { accountLabel, getAccountById } from './chartOfAccounts';
import {
  journalDateKey,
  journalOrdinalMap,
  postedJournalEntries,
  compareJournalOldestFirst,
} from './journal';
import { todayISODateAR } from '../../lib/arDate';

export const JOURNAL_EXCEL_HEADERS = [
  'Asiento',
  'Fecha',
  'Glosa',
  'Cuenta',
  'Debe',
  'Haber',
  'Origen',
];

function lineAmounts(line) {
  if (line.debit != null || line.credit != null) {
    return {
      debe: Number(line.debit) || 0,
      haber: Number(line.credit) || 0,
    };
  }
  const amount = Number(line.amount) || 0;
  return {
    debe: line.type === 'debit' ? amount : 0,
    haber: line.type === 'credit' ? amount : 0,
  };
}

function resolveLineAccount(line, chart) {
  if (line.account) return line.account;
  if (line.accountName) return line.accountName;
  if (chart && line.accountId) {
    const acc = getAccountById(chart, line.accountId);
    if (acc) return accountLabel(acc);
  }
  return line.accountId || '';
}

export function buildJournalExcelAoA(journalEntries = [], { chart = null } = {}) {
  const posted = postedJournalEntries(journalEntries).toSorted(compareJournalOldestFirst);
  const ordinals = journalOrdinalMap(posted);
  let totalDebe = 0;
  let totalHaber = 0;
  const rows = [];

  posted.forEach((entry) => {
    const lines = Array.isArray(entry.lines) ? entry.lines : [];
    lines.forEach((line, idx) => {
      const { debe, haber } = lineAmounts(line);
      totalDebe += debe;
      totalHaber += haber;
      rows.push([
        ordinals.get(entry.id) ?? '',
        journalDateKey(entry),
        idx === 0 ? (entry.description || entry.concept || '') : '',
        resolveLineAccount(line, chart),
        debe || '',
        haber || '',
        idx === 0 ? (entry.sourceModule || '') : '',
      ]);
    });
  });

  return {
    aoa: [JOURNAL_EXCEL_HEADERS, ...rows],
    count: posted.length,
    lineCount: rows.length,
    totalDebe,
    totalHaber,
  };
}

export async function exportJournalExcel(journalEntries = [], {
  chart = null,
  fileName,
} = {}) {
  const XLSX = await import('xlsx');
  const built = buildJournalExcelAoA(journalEntries, { chart });
  const stamp = todayISODateAR();
  const downloadName = fileName || `jockey_club_libro_diario_${stamp}.xlsx`;
  const generatedAt = new Date().toLocaleString('es-AR');

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(built.aoa);
  ws['!cols'] = [10, 12, 48, 36, 14, 14, 14].map((wch) => ({ wch }));
  if (built.aoa.length > 1) {
    ws['!autofilter'] = { ref: `A1:G${built.aoa.length}` };
  }
  XLSX.utils.book_append_sheet(wb, ws, 'Libro diario');

  const resumen = [
    ['Libro diario — Jockey Club San Juan'],
    ['Asientos oficiales, partida doble'],
    [`Generado ${generatedAt}`],
    [],
    ['Asientos', built.count],
    ['Líneas', built.lineCount],
    ['Debe', built.totalDebe],
    ['Haber', built.totalHaber],
  ];
  const wsResumen = XLSX.utils.aoa_to_sheet(resumen);
  wsResumen['!cols'] = [{ wch: 36 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(wb, wsResumen, 'Resumen');

  XLSX.writeFile(wb, downloadName);
  return { fileName: downloadName, ...built };
}
