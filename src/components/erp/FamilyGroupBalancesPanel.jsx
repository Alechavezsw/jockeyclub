import { useMemo, useState } from 'react';
import { ArrowLeft, Download, Search, Users } from 'lucide-react';
import {
  familyGroupBalancesSeed,
  familyGroupBalancesSummary,
  listFamilyGroupBalances,
} from '../../domain/accounting/familyGroupBalances';
import { exportFamilyGroupBalancesPdf } from '../../domain/accounting/exportFamilyGroupBalancesPdf';
import { createAccountingReportRecord } from '../../domain/accounting/accountingReports';
import { useSnapshotSeed } from '../../hooks/useSnapshots';
import SnapshotGate from '../SnapshotGate';

const PAGE_SIZE = 40;

function money(n) {
  const v = Number(n) || 0;
  const abs = Math.abs(v).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (v < 0) return `$ -${abs}`;
  if (v > 0) return `$ ${abs}`;
  return `$ ${abs}`;
}

export default function FamilyGroupBalancesPanel(props) {
  return (
    <SnapshotGate names={['accessinFamilyGroupBalances']}>
      <FamilyGroupBalancesContent {...props} />
    </SnapshotGate>
  );
}

function FamilyGroupBalancesContent({
  reports = [],
  onRecordReport,
  onOpenMember,
}) {
  useSnapshotSeed(['accessinFamilyGroupBalances'], familyGroupBalancesSeed);
  const [query, setQuery] = useState('');
  const [sign, setSign] = useState('all');
  const [onlyWithBalance, setOnlyWithBalance] = useState(false);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const summary = useMemo(() => familyGroupBalancesSummary(), []);
  const rows = useMemo(
    () => listFamilyGroupBalances({ query, sign, onlyWithBalance }),
    [query, sign, onlyWithBalance],
  );
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = rows.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  const download = async () => {
    setError('');
    setBusy(true);
    try {
      const fileName = await exportFamilyGroupBalancesPdf({ query, sign, onlyWithBalance });
      onRecordReport?.(createAccountingReportRecord({
        reportType: 'family_balances',
        filters: { familyQuery: query, sign, onlyWithBalance },
        summary: `${rows.length} grupos`,
        fileName,
      }));
    } catch (err) {
      setError(err.message || 'No se pudo generar el PDF.');
    } finally {
      setBusy(false);
    }
  };

  if (selected) {
    return (
      <div className="fade-in mb-folio">
        <button type="button" className="mb-folio-back" onClick={() => setSelected(null)}>
          <ArrowLeft size={14} aria-hidden="true" /> Volver al listado
        </button>
        <header className="mb-folio-head">
          <div>
            <p className="mb-folio-kicker">Grupo familiar</p>
            <h3 className="mb-folio-title">{selected.name}</h3>
            <p className="mb-folio-meta">
              {selected.memberNumber ? `Socio ${selected.memberNumber}` : 'Sin nro. de socio en el grupo'}
              {` · al ${summary.asOfLabel}`}
            </p>
          </div>
          <span className={['mb-folio-seal', selected.total > 0 ? 'is-warn' : ''].filter(Boolean).join(' ')}>
            {money(selected.total)}
          </span>
        </header>

        <div className="table-responsive">
          <table className="admin-table cash-lila-table">
            <thead>
              <tr>
                <th>Período</th>
                <th style={{ textAlign: 'right' }}>Capital</th>
              </tr>
            </thead>
            <tbody>
              {(selected.months || []).length === 0 ? (
                <tr>
                  <td colSpan={2} className="mb-folio-empty">Sin períodos.</td>
                </tr>
              ) : (selected.months || []).map((row) => (
                <tr key={row.periodKey || row.periodLabel}>
                  <td>{row.periodLabel}</td>
                  <td style={{
                    textAlign: 'right',
                    fontWeight: 700,
                    color: row.capital > 0 ? 'var(--danger-accent)' : row.capital < 0 ? 'var(--emerald-accent)' : undefined,
                  }}
                  >
                    {money(row.capital)}
                  </td>
                </tr>
              ))}
              <tr>
                <td><strong>Total grupo familiar</strong></td>
                <td style={{ textAlign: 'right', fontWeight: 800 }}>{money(selected.total)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {selected.memberNumber && onOpenMember ? (
          <div className="ar-card-actions" style={{ padding: '0.9rem 0 0' }}>
            <button type="button" className="btn btn-tan" onClick={() => onOpenMember(selected.memberNumber)}>
              Ver socio {selected.memberNumber}
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="fade-in mb-folio">
      <header className="mb-folio-head">
        <div>
          <p className="mb-folio-kicker">Contabilidad</p>
          <h3 className="mb-folio-title">Saldos de grupo familiar</h3>
          <p className="mb-folio-meta">
            Corte al {summary.asOfLabel || '—'}.
            {summary.sourceFile ? ` ${summary.sourceFile.replace(/^LILA\s*[-–]\s*/i, '')}` : ''}
          </p>
        </div>
        <span className="mb-folio-seal">{summary.groupCount.toLocaleString('es-AR')} grupos</span>
      </header>

      {error ? <p className="mb-folio-status is-error" role="alert">{error}</p> : null}

      <dl className="mb-folio-kpis">
        <div className="mb-folio-kpi">
          <dt>Con saldo</dt>
          <dd>{summary.withBalance.toLocaleString('es-AR')}</dd>
        </div>
        <div className="mb-folio-kpi is-out">
          <dt>Deudor</dt>
          <dd>{money(summary.debtTotal)}</dd>
          <p>{summary.debtCount.toLocaleString('es-AR')} grupos</p>
        </div>
        <div className="mb-folio-kpi is-net">
          <dt>A favor</dt>
          <dd>{money(summary.creditTotal)}</dd>
          <p>{summary.creditCount.toLocaleString('es-AR')} grupos</p>
        </div>
        <div className="mb-folio-kpi">
          <dt>Neto</dt>
          <dd>{money(summary.totalBalance)}</dd>
        </div>
      </dl>

      <div className="ar-filters" style={{ alignItems: 'end' }}>
        <label className="ld-search">
          <span className="form-label">Grupo</span>
          <span className="ld-search-field">
            <Search size={14} aria-hidden="true" />
            <input
              className="form-input"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setPage(0); }}
              placeholder="Nombre o nro. de socio"
            />
          </span>
        </label>
        <label>
          <span className="form-label">Saldo</span>
          <select
            className="form-input"
            value={sign}
            onChange={(e) => { setSign(e.target.value); setPage(0); }}
          >
            <option value="all">Todos</option>
            <option value="debt">Deudor</option>
            <option value="credit">A favor</option>
          </select>
        </label>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', paddingBottom: '0.45rem' }}>
          <input
            type="checkbox"
            checked={onlyWithBalance}
            onChange={(e) => { setOnlyWithBalance(e.target.checked); setPage(0); }}
          />
          Solo con movimiento
        </label>
        <button type="button" className="btn btn-tan" disabled={busy} onClick={() => void download()}>
          <Download size={14} aria-hidden="true" />
          {busy ? 'Generando…' : 'PDF'}
        </button>
      </div>

      <p className="mb-folio-meta">
        {rows.length.toLocaleString('es-AR')} grupos en este filtro
        {reports?.length ? ` · ${reports.length} PDF emitidos en la sesión` : ''}
      </p>

      <div className="table-responsive">
        <table className="admin-table cash-lila-table">
          <thead>
            <tr>
              <th>Grupo</th>
              <th>Socio</th>
              <th>Meses</th>
              <th style={{ textAlign: 'right' }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <tr>
                <td colSpan={4} className="mb-folio-empty">No hay grupos con este filtro.</td>
              </tr>
            ) : pageRows.map((g) => (
              <tr key={g.key}>
                <td>
                  <button type="button" className="cash-lila-card-btn" onClick={() => setSelected(g)}>
                    <Users size={13} aria-hidden="true" /> {g.name}
                  </button>
                </td>
                <td>{g.memberNumber || '—'}</td>
                <td>{(g.months || []).length}</td>
                <td style={{
                  textAlign: 'right',
                  fontWeight: 700,
                  color: g.total > 0 ? 'var(--danger-accent)' : g.total < 0 ? 'var(--emerald-accent)' : undefined,
                }}
                >
                  {money(g.total)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {rows.length > PAGE_SIZE ? (
        <div className="cuotas-pager" style={{ marginTop: '0.75rem' }}>
          <button type="button" className="btn btn-secondary btn-sm" disabled={safePage === 0} onClick={() => setPage((p) => p - 1)}>
            Anterior
          </button>
          <span>Hoja {safePage + 1} / {totalPages}</span>
          <button type="button" className="btn btn-secondary btn-sm" disabled={safePage >= totalPages - 1} onClick={() => setPage((p) => p + 1)}>
            Siguiente
          </button>
        </div>
      ) : null}
    </div>
  );
}
