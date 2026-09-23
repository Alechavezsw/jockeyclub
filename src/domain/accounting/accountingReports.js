/** Catálogo e historial de reportes de Contabilidad. */

export const ACCOUNTING_REPORT_MODULE = 'contabilidad';

export const ACCOUNTING_REPORT_TYPES = [
  { id: 'diary', label: 'Libro diario' },
  { id: 'mayor', label: 'Libro mayor' },
  { id: 'results', label: 'Estado de resultados' },
  { id: 'balance_sheet', label: 'Balance patrimonial' },
  { id: 'trial', label: 'Balance de comprobación' },
  { id: 'gestion', label: 'Gestión del ejercicio' },
  { id: 'recargos', label: 'Composición de recargos' },
  { id: 'libre_deuda', label: 'Libre deuda' },
  { id: 'detailed_cc', label: 'Cuentas corrientes detalladas' },
  { id: 'family_balances', label: 'Saldo de grupo familiar' },
];

export function accountingReportTypeLabel(id) {
  return ACCOUNTING_REPORT_TYPES.find((t) => t.id === id)?.label || id;
}

function uid() {
  return `arep-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function createAccountingReportRecord({
  reportType,
  filters = {},
  summary = '',
  fileName = '',
} = {}) {
  const type = ACCOUNTING_REPORT_TYPES.some((t) => t.id === reportType) ? reportType : 'recargos';
  return {
    id: uid(),
    module: ACCOUNTING_REPORT_MODULE,
    reportType: type,
    reportTypeLabel: accountingReportTypeLabel(type),
    filters,
    summary: String(summary || '').trim(),
    fileName: String(fileName || '').trim(),
    status: 'completed',
    generatedAt: new Date().toISOString(),
  };
}

export function prependAccountingReport(list = [], record) {
  return [record, ...(list || [])].slice(0, 80);
}

export function reportsForType(list = [], reportType) {
  return (list || []).filter((r) => r && r.reportType === reportType && r.status !== 'deleted');
}

export function formatReportGeneratedAt(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    const months = [
      'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
      'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
    ];
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${d.getDate()} de ${months[d.getMonth()]} del ${d.getFullYear()} a las ${hh}:${mm}`;
  } catch {
    return iso;
  }
}
