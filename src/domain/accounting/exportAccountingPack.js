import { ACCOUNT_TYPES, getPostableAccounts } from './chartOfAccounts';
import {
  BRAND,
  CLUB_NAME,
  CLUB_SEDE,
  drawReportFooter,
  drawReportHeader,
  loadClubLogoDataUrl,
} from '../reports/pdfBrand';
import {
  buildMayorLedger,
  formatCurrency,
  getAccountBalance,
  postedJournalEntries,
} from './journal';
import { buildResultsInsights, monthLabelAR } from './resultsInsights';
import { todayISODateAR } from '../../lib/arDate';

const TYPE_ORDER = ['asset', 'liability', 'equity', 'income', 'expense'];

function money(n) {
  return formatCurrency(Number(n) || 0);
}

function sumBalances(rows) {
  return rows.reduce((sum, row) => sum + (Number(row.balance) || 0), 0);
}

export function buildAccountingPack(journalEntries = [], chart = []) {
  const postable = getPostableAccounts(chart);
  const rows = postable
    .map((account) => ({
      id: account.id,
      code: account.code || '',
      name: account.name,
      type: account.accountType,
      typeLabel: ACCOUNT_TYPES[account.accountType]?.label || account.accountType,
      nature: ACCOUNT_TYPES[account.accountType]?.nature || 'debit',
      balance: getAccountBalance(account.id, journalEntries, chart),
    }))
    .toSorted((a, b) => {
      const typeDelta = TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type);
      if (typeDelta) return typeDelta;
      return String(a.code).localeCompare(String(b.code), 'es');
    });

  const ofType = (type) => rows.filter((row) => row.type === type);
  const ingresos = ofType('income');
  const gastos = ofType('expense');
  const activos = ofType('asset');
  const pasivos = ofType('liability');
  const patrimonio = ofType('equity');
  const totalIngresos = sumBalances(ingresos);
  const totalGastos = sumBalances(gastos);
  const resultado = totalIngresos - totalGastos;
  const totalActivos = sumBalances(activos);
  const totalPasivos = sumBalances(pasivos);
  const patrimonioBase = sumBalances(patrimonio);
  const patrimonioTotal = patrimonioBase + resultado;
  const pasivoPn = totalPasivos + patrimonioTotal;
  const trial = rows.map((row) => ({
    ...row,
    debe: row.nature === 'debit' ? row.balance : 0,
    haber: row.nature === 'credit' ? row.balance : 0,
  }));
  const trialDebe = trial.reduce((sum, row) => sum + row.debe, 0);
  const trialHaber = trial.reduce((sum, row) => sum + row.haber, 0);
  const mayor = postable
    .map((account) => {
      const ledger = buildMayorLedger(account.id, journalEntries, chart);
      return {
        id: account.id,
        code: account.code || '',
        name: account.name,
        typeLabel: ACCOUNT_TYPES[account.accountType]?.label || '',
        lines: ledger.lines,
        finalBalance: ledger.finalBalance,
      };
    })
    .filter((row) => row.lines.length || row.finalBalance);
  const insights = buildResultsInsights(journalEntries, chart);

  return {
    asientos: postedJournalEntries(journalEntries).length,
    ingresos,
    gastos,
    activos,
    pasivos,
    patrimonio,
    trial,
    mayor,
    insights,
    totals: {
      ingresos: totalIngresos,
      gastos: totalGastos,
      resultado,
      activos: totalActivos,
      pasivos: totalPasivos,
      patrimonioBase,
      patrimonio: patrimonioTotal,
      pasivoPn,
      trialDebe,
      trialHaber,
      squared: Math.abs(totalActivos - pasivoPn) < 0.5,
    },
  };
}

function stampName(slug) {
  return `jockey_club_${slug}_${todayISODateAR()}`;
}

async function writeExcel(sheets, fileName) {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  sheets.forEach((sheet) => {
    const ws = XLSX.utils.aoa_to_sheet(sheet.aoa);
    if (sheet.cols) ws['!cols'] = sheet.cols.map((wch) => ({ wch }));
    if (sheet.filter && sheet.aoa.length > 1) {
      ws['!autofilter'] = { ref: sheet.filter };
    }
    XLSX.utils.book_append_sheet(wb, ws, sheet.name.slice(0, 31));
  });
  XLSX.writeFile(wb, fileName);
  return fileName;
}

async function writePdf({ title, subtitle, columns, body, foot, fileName, landscape = false }) {
  const [{ jsPDF }, autoTableMod, logoDataUrl] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    loadClubLogoDataUrl(),
  ]);
  const autoTable = autoTableMod.default;
  const doc = new jsPDF({
    orientation: landscape ? 'landscape' : 'portrait',
    unit: 'mm',
    format: 'a4',
  });
  const generatedAt = new Date().toLocaleString('es-AR');
  autoTable(doc, {
    startY: drawReportHeader(doc, {
      title,
      subtitle: subtitle || `${CLUB_NAME} · ${CLUB_SEDE}`,
      metaLine: `Contabilidad  ·  Emitido: ${generatedAt}`,
      logoDataUrl,
    }),
    head: [columns],
    body,
    foot: foot ? [foot] : undefined,
    showFoot: foot ? 'lastPage' : undefined,
    styles: { fontSize: 8, cellPadding: 1.6 },
    headStyles: { fillColor: BRAND.green, textColor: 255 },
    footStyles: { fillColor: [245, 242, 232], textColor: BRAND.green, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [252, 250, 244] },
  });
  drawReportFooter(doc);
  doc.save(fileName);
  return fileName;
}

function resultsBody(pack) {
  const body = [
    ...pack.ingresos.map((row) => ['Ingresos', row.name, money(row.balance)]),
    ['Ingresos', 'Total ingresos', money(pack.totals.ingresos)],
    ...pack.gastos.map((row) => ['Egresos', row.name, money(row.balance)]),
    ['Egresos', 'Total egresos', money(pack.totals.gastos)],
    ['Resultado', pack.totals.resultado >= 0 ? 'Superávit' : 'Déficit', money(pack.totals.resultado)],
  ];
  return body;
}

function balanceBody(pack) {
  return [
    ...pack.activos.map((row) => ['Activo', row.name, money(row.balance)]),
    ['Activo', 'Total activo', money(pack.totals.activos)],
    ...pack.pasivos.map((row) => ['Pasivo', row.name, money(row.balance)]),
    ['Pasivo', 'Total pasivo', money(pack.totals.pasivos)],
    ...pack.patrimonio.map((row) => ['Patrimonio', row.name, money(row.balance)]),
    ['Patrimonio', 'Resultado del ejercicio', money(pack.totals.resultado)],
    ['Patrimonio', 'Patrimonio + resultado', money(pack.totals.patrimonio)],
    ['Ecuación', 'Pasivo + PN', money(pack.totals.pasivoPn)],
  ];
}

export async function exportAccountingReport({
  reportType,
  format = 'pdf',
  journalEntries = [],
  chart = [],
} = {}) {
  const pack = buildAccountingPack(journalEntries, chart);
  const generatedAt = new Date().toLocaleString('es-AR');

  if (reportType === 'results') {
    const fileName = `${stampName('estado_resultados')}.${format === 'xlsx' ? 'xlsx' : 'pdf'}`;
    if (format === 'xlsx') {
      await writeExcel([
        {
          name: 'Resultados',
          cols: [16, 36, 16],
          filter: 'A1:C1',
          aoa: [
            ['Grupo', 'Cuenta', 'Importe'],
            ...pack.ingresos.map((row) => ['Ingresos', row.name, row.balance]),
            ['Ingresos', 'Total ingresos', pack.totals.ingresos],
            ...pack.gastos.map((row) => ['Egresos', row.name, row.balance]),
            ['Egresos', 'Total egresos', pack.totals.gastos],
            ['Resultado', pack.totals.resultado >= 0 ? 'Superávit' : 'Déficit', pack.totals.resultado],
          ],
        },
        {
          name: 'Resumen',
          cols: [28, 18],
          aoa: [
            ['Estado de resultados — Jockey Club San Juan'],
            [`Generado ${generatedAt}`],
            [],
            ['Ingresos', pack.totals.ingresos],
            ['Egresos', pack.totals.gastos],
            ['Resultado', pack.totals.resultado],
            ['Asientos oficiales', pack.asientos],
          ],
        },
      ], fileName);
    } else {
      await writePdf({
        title: 'Estado de resultados',
        subtitle: pack.totals.resultado >= 0 ? 'Superávit del ejercicio' : 'Déficit del ejercicio',
        columns: ['Grupo', 'Cuenta', 'Importe'],
        body: resultsBody(pack),
        fileName,
      });
    }
    return { fileName, summary: money(pack.totals.resultado) };
  }

  if (reportType === 'balance_sheet') {
    const fileName = `${stampName('balance_patrimonial')}.${format === 'xlsx' ? 'xlsx' : 'pdf'}`;
    if (format === 'xlsx') {
      await writeExcel([
        {
          name: 'Patrimonial',
          cols: [16, 36, 16],
          filter: 'A1:C1',
          aoa: [
            ['Grupo', 'Cuenta', 'Importe'],
            ...pack.activos.map((row) => ['Activo', row.name, row.balance]),
            ['Activo', 'Total activo', pack.totals.activos],
            ...pack.pasivos.map((row) => ['Pasivo', row.name, row.balance]),
            ['Pasivo', 'Total pasivo', pack.totals.pasivos],
            ...pack.patrimonio.map((row) => ['Patrimonio', row.name, row.balance]),
            ['Patrimonio', 'Resultado del ejercicio', pack.totals.resultado],
            ['Patrimonio', 'Patrimonio + resultado', pack.totals.patrimonio],
            ['Ecuación', 'Pasivo + PN', pack.totals.pasivoPn],
          ],
        },
        {
          name: 'Resumen',
          cols: [28, 18],
          aoa: [
            ['Balance patrimonial — Jockey Club San Juan'],
            [`Generado ${generatedAt}`],
            [],
            ['Activo', pack.totals.activos],
            ['Pasivo', pack.totals.pasivos],
            ['Patrimonio + resultado', pack.totals.patrimonio],
            ['Ecuación', pack.totals.squared ? 'Cuadrada' : 'Descuadrada'],
          ],
        },
      ], fileName);
    } else {
      await writePdf({
        title: 'Balance patrimonial',
        subtitle: pack.totals.squared ? 'Ecuación cuadrada' : 'Hay descuadre',
        columns: ['Grupo', 'Cuenta', 'Importe'],
        body: balanceBody(pack),
        fileName,
      });
    }
    return { fileName, summary: pack.totals.squared ? 'Cuadrada' : 'Descuadre' };
  }

  if (reportType === 'trial') {
    const fileName = `${stampName('balance_comprobacion')}.${format === 'xlsx' ? 'xlsx' : 'pdf'}`;
    const excelRows = pack.trial.map((row) => [row.code, row.name, row.typeLabel, row.debe, row.haber]);
    if (format === 'xlsx') {
      await writeExcel([
        {
          name: 'Comprobación',
          cols: [12, 36, 18, 14, 14],
          filter: 'A1:E1',
          aoa: [
            ['Código', 'Cuenta', 'Tipo', 'Debe', 'Haber'],
            ...excelRows,
            ['', 'Totales', '', pack.totals.trialDebe, pack.totals.trialHaber],
          ],
        },
      ], fileName);
    } else {
      await writePdf({
        title: 'Balance de comprobación',
        subtitle: 'Saldos por naturaleza de cuenta',
        columns: ['Código', 'Cuenta', 'Tipo', 'Debe', 'Haber'],
        body: pack.trial.map((row) => [row.code, row.name, row.typeLabel, money(row.debe), money(row.haber)]),
        foot: ['', 'Totales', '', money(pack.totals.trialDebe), money(pack.totals.trialHaber)],
        fileName,
        landscape: true,
      });
    }
    return { fileName, summary: `${pack.trial.length} cuentas` };
  }

  if (reportType === 'mayor') {
    const fileName = `${stampName('libro_mayor')}.${format === 'xlsx' ? 'xlsx' : 'pdf'}`;
    const excelRows = pack.mayor.flatMap((account) => (
      account.lines.length
        ? account.lines.map((line, idx) => [
          idx === 0 ? account.code : '',
          idx === 0 ? account.name : '',
          line.date,
          line.description,
          line.debit || '',
          line.credit || '',
          line.balance,
        ])
        : [[account.code, account.name, '', 'Sin movimientos', '', '', account.finalBalance]]
    ));
    if (format === 'xlsx') {
      await writeExcel([
        {
          name: 'Mayor',
          cols: [12, 32, 12, 42, 14, 14, 14],
          filter: 'A1:G1',
          aoa: [
            ['Código', 'Cuenta', 'Fecha', 'Glosa', 'Debe', 'Haber', 'Saldo'],
            ...excelRows,
          ],
        },
      ], fileName);
    } else {
      await writePdf({
        title: 'Libro mayor',
        subtitle: `${pack.mayor.length} cuentas con movimiento o saldo`,
        columns: ['Código', 'Cuenta', 'Fecha', 'Glosa', 'Debe', 'Haber', 'Saldo'],
        body: pack.mayor.flatMap((account) => (
          account.lines.length
            ? account.lines.map((line, idx) => [
              idx === 0 ? account.code : '',
              idx === 0 ? account.name : '',
              line.date,
              line.description,
              line.debit ? money(line.debit) : '',
              line.credit ? money(line.credit) : '',
              money(line.balance),
            ])
            : [[account.code, account.name, '', 'Sin movimientos', '', '', money(account.finalBalance)]]
        )),
        fileName,
        landscape: true,
      });
    }
    return { fileName, summary: `${pack.mayor.length} cuentas` };
  }

  if (reportType === 'gestion') {
    const fileName = `${stampName('gestion_ejercicio')}.${format === 'xlsx' ? 'xlsx' : 'pdf'}`;
    const { insights } = pack;
    if (format === 'xlsx') {
      await writeExcel([
        {
          name: 'Resumen',
          cols: [28, 22],
          aoa: [
            ['Gestión del ejercicio — Jockey Club San Juan'],
            [`Generado ${generatedAt}`],
            [],
            ['Asientos oficiales', insights.asientos],
            ['Ingresos', insights.income],
            ['Egresos', insights.expense],
            ['Resultado', insights.result],
            ['Margen', insights.income ? insights.margin : ''],
            ['Cobertura', insights.coverage ?? ''],
          ],
        },
        {
          name: 'Ingresos',
          cols: [36, 16],
          aoa: [['Cuenta', 'Importe'], ...insights.incomeMix.map((row) => [row.label, row.amount])],
        },
        {
          name: 'Egresos',
          cols: [36, 16],
          aoa: [['Cuenta', 'Importe'], ...insights.expenseMix.map((row) => [row.label, row.amount])],
        },
        {
          name: 'Origen',
          cols: [20, 16],
          aoa: [['Origen', 'Importe'], ...insights.sourceMix.map((row) => [row.label, row.amount])],
        },
        {
          name: 'Meses',
          cols: [14, 14, 14, 14],
          aoa: [
            ['Mes', 'Ingresos', 'Egresos', 'Resultado'],
            ...insights.series.map((row) => [row.month, row.income, row.expense, row.result]),
          ],
        },
      ], fileName);
    } else {
      await writePdf({
        title: 'Gestión del ejercicio',
        subtitle: `${insights.asientos} asientos oficiales`,
        columns: ['Bloque', 'Detalle', 'Importe'],
        body: [
          ['Totales', 'Ingresos', money(insights.income)],
          ['Totales', 'Egresos', money(insights.expense)],
          ['Totales', insights.result >= 0 ? 'Superávit' : 'Déficit', money(insights.result)],
          ...insights.incomeMix.map((row) => ['Ingresos', row.label, money(row.amount)]),
          ...insights.expenseMix.map((row) => ['Egresos', row.label, money(row.amount)]),
          ...insights.sourceMix.map((row) => ['Origen', row.label, money(row.amount)]),
          ...insights.series.map((row) => ['Mes', monthLabelAR(row.month), money(row.result)]),
        ],
        fileName,
      });
    }
    return { fileName, summary: money(insights.result) };
  }

  throw new Error('Ese reporte todavía no se puede exportar.');
}
