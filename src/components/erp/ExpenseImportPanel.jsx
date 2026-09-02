import { useRef, useState } from 'react';
import { ArrowLeft, Download, FileSpreadsheet, Upload } from 'lucide-react';
import {
  EXPENSE_IMPORT_MODULES,
  EXPENSE_IMPORT_STATUS,
  LISTA_BASE_GASTOS_FILENAME,
  LISTA_BASE_GASTOS_URL,
  buildExpenseImport,
  parseGastosSheetRows,
} from '../../domain/accounting/expenseImport';
import { formatCurrency } from '../../domain/accounting/journal';

function formatDateTime(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('es-AR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function statusClass(status) {
  if (status === 'completed') return 'confirmed';
  if (status === 'partial') return 'pending';
  return 'cancelled';
}

export default function ExpenseImportPanel({
  suppliers = [],
  expenseAccounts = [],
  paymentAccountId = '',
  defaultCategoryAccountId = '',
  imports = [],
  onBack,
  onImportBatch,
}) {
  const fileRef = useRef(null);
  const [module, setModule] = useState('excel_manual_invoice');
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [lastPreview, setLastPreview] = useState(null);

  const processFile = async () => {
    setError('');
    setOk('');
    setLastPreview(null);
    if (!file) {
      setError('Seleccioná un archivo Excel para procesar.');
      return;
    }
    setBusy(true);
    try {
      const XLSX = await import('xlsx');
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array', cellDates: true });
      const sheet = wb.Sheets.GASTOS || wb.Sheets[wb.SheetNames[0]];
      if (!sheet) throw new Error('No se encontró la hoja GASTOS en el archivo.');
      const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
      const rows = parseGastosSheetRows(aoa);
      if (!rows.length) {
        throw new Error('No hay gastos cargados en la hoja GASTOS (solo filas vacías).');
      }
      const built = buildExpenseImport({
        rows,
        suppliers,
        expenseAccounts,
        paymentAccountId,
        defaultCategoryAccountId,
        module,
        fileName: file.name,
      });
      if (!built.expenses.length) {
        throw new Error('Ninguna fila pudo importarse. Revisá proveedor, concepto y monto.');
      }
      setLastPreview(built);
      if (typeof onImportBatch === 'function') {
        await onImportBatch(built);
      }
      setOk(
        `Importados ${built.batch.importedCount} gastos · ${formatCurrency(built.batch.totalAmount)}`
        + (built.errors.length ? ` · ${built.errors.length} aviso(s)` : '')
      );
      setFile(null);
      if (fileRef.current) fileRef.current.value = '';
    } catch (err) {
      setError(err.message || 'No se pudo procesar el archivo.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fade-in supplier-pay-import" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <section className="supplier-pay-import-block">
        <h4 className="supplier-pay-import-title">Importar gastos</h4>
        <div className="supplier-pay-import-form">
          <div className="supplier-pay-import-field">
            <label className="form-label" htmlFor="exi-module">Módulo</label>
            <select
              id="exi-module"
              className="form-input"
              value={module}
              onChange={(e) => setModule(e.target.value)}
            >
              {Object.entries(EXPENSE_IMPORT_MODULES).map(([id, label]) => (
                <option key={id} value={id}>{label}</option>
              ))}
            </select>
          </div>

          <div className="supplier-pay-import-field">
            <label className="form-label" htmlFor="exi-file">Archivo</label>
            <input
              id="exi-file"
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls"
              className="form-input"
              onChange={(e) => {
                setFile(e.target.files?.[0] || null);
                setError('');
                setOk('');
              }}
            />
            <div style={{ marginTop: '0.65rem' }}>
              <a
                className="btn btn-primary btn-sm"
                href={LISTA_BASE_GASTOS_URL}
                download={LISTA_BASE_GASTOS_FILENAME}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <Download size={14} /> Descargar lista base
              </a>
              <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: '0.45rem 0 0' }}>
                Plantilla con hojas GASTOS y PROVEEDORES (incluye N° de comprobante).
              </p>
            </div>
          </div>
        </div>

        {error && <p style={{ color: '#ef4444', margin: 0 }}>{error}</p>}
        {ok && <p style={{ color: 'var(--emerald-accent)', margin: 0 }}>{ok}</p>}

        {lastPreview?.errors?.length > 0 && (
          <div className="supplier-pay-import-warnings">
            <strong>Avisos ({lastPreview.errors.length})</strong>
            <ul>
              {lastPreview.errors.slice(0, 8).map((e) => (
                <li key={`${e.line}-${e.message}`}>Línea {e.line}: {e.message}</li>
              ))}
              {lastPreview.errors.length > 8 && (
                <li>… y {lastPreview.errors.length - 8} más</li>
              )}
            </ul>
          </div>
        )}

        <div className="supplier-pay-import-actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={onBack}>
            <ArrowLeft size={14} /> Volver
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={busy}
            onClick={processFile}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            {busy ? <Upload size={14} /> : <FileSpreadsheet size={14} />}
            {busy ? 'Procesando…' : 'Procesar archivo'}
          </button>
        </div>
      </section>

      <section className="supplier-pay-import-block">
        <h4 className="supplier-pay-import-title">Importaciones anteriores</h4>
        <div className="table-responsive">
          <table className="admin-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Fecha de importación</th>
                <th>Módulo</th>
                <th>Estado</th>
                <th>Importados</th>
                <th>Total importado</th>
              </tr>
            </thead>
            <tbody>
              {imports.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ color: 'var(--text-muted)', padding: '1.5rem 1rem', textAlign: 'center' }}>
                    Aún no se han importado gastos
                  </td>
                </tr>
              ) : (
                imports.map((item, idx) => (
                  <tr key={item.id}>
                    <td>{imports.length - idx}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(item.importedAt)}</td>
                    <td>{item.moduleLabel || EXPENSE_IMPORT_MODULES[item.module] || item.module}</td>
                    <td>
                      <span className={`status-tag ${statusClass(item.status)}`}>
                        {EXPENSE_IMPORT_STATUS[item.status] || item.status}
                      </span>
                    </td>
                    <td style={{ fontWeight: 700 }}>{item.importedCount || 0}</td>
                    <td style={{ fontWeight: 700, color: 'var(--emerald-accent)', whiteSpace: 'nowrap' }}>
                      {formatCurrency(item.totalAmount || 0)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
