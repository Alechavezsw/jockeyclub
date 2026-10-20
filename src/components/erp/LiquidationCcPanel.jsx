import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { formatCurrency } from '../../domain/accounting/journal';
import {
  buildLiveLiquidationCc,
  filterLiquidationCc,
  liveLiquidationCcBook,
} from '../../domain/accounting/liveLiquidationCc';

const PAGE_SIZE = 40;

export default function LiquidationCcPanel({ members = [] }) {
  const book = useMemo(() => buildLiveLiquidationCc(members), [members]);
  const [periodKey, setPeriodKey] = useState(book.periodKeys[0] || '');
  const [query, setQuery] = useState('');
  const [onlyLiquidation, setOnlyLiquidation] = useState(false);
  const [page, setPage] = useState(0);

  const periodKeysSig = book.periodKeys.join(',');
  useEffect(() => {
    const keys = periodKeysSig ? periodKeysSig.split(',') : [];
    if (!keys.length) {
      setPeriodKey('');
      return;
    }
    setPeriodKey((current) => (keys.includes(current) ? current : keys[0]));
  }, [periodKeysSig]);

  const selected = useMemo(
    () => liveLiquidationCcBook(book, periodKey),
    [book, periodKey],
  );
  const rows = useMemo(
    () => filterLiquidationCc(selected.items, { query, onlyLiquidation }),
    [selected.items, query, onlyLiquidation],
  );
  const summary = selected.summary;
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = rows.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  const kpis = [
    {
      id: 'liq',
      accent: 'is-in',
      label: 'Liquidación',
      value: summary.liquidation,
      caption: `${summary.withLiquidation.toLocaleString('es-AR')} socios con cuota del mes`,
    },
    {
      id: 'prev',
      accent: 'is-cash',
      label: 'Saldo anterior',
      value: summary.previousBalance,
      caption: `${summary.withPrevious.toLocaleString('es-AR')} con meses previos`,
    },
    {
      id: 'net',
      accent: 'is-net',
      label: 'Sin recargos',
      value: summary.withoutSurcharge,
      caption: `Otros ${formatCurrency(summary.others)}`,
    },
    {
      id: 'out',
      accent: 'is-out',
      label: 'Recargos',
      value: summary.surcharge,
      caption: `Intereses ${formatCurrency(summary.interests)}`,
    },
  ];

  return (
    <div className="fade-in mb-folio">
      <header className="mb-folio-head">
        <div>
          <p className="mb-folio-kicker">Cta. cte.</p>
          <h3 className="mb-folio-title">{summary.periodLabel || 'Cuota viva'}</h3>
          <p className="mb-folio-meta">
            Saldo de cuota al {summary.generatedAt}. Recargo 10 % después del 10, en familiar e individual.
          </p>
        </div>
        <span className="mb-folio-seal">Vivo</span>
      </header>

      {book.periods.length > 0 ? (
        <div className="acct-view-strip mb-cc-months" role="tablist" aria-label="Meses de cuota">
          {book.periods.map((period) => (
            <button
              key={period.key}
              type="button"
              role="tab"
              aria-selected={period.key === selected.periodKey}
              className={['acct-view-chip', period.key === selected.periodKey ? 'is-active' : ''].filter(Boolean).join(' ')}
              onClick={() => { setPeriodKey(period.key); setPage(0); }}
            >
              {period.label}
            </button>
          ))}
        </div>
      ) : null}

      <dl className="mb-folio-kpis">
        {kpis.map((kpi) => (
          <div key={kpi.id} className={['mb-folio-kpi', kpi.accent].filter(Boolean).join(' ')}>
            <dt>{kpi.label}</dt>
            <dd>{formatCurrency(kpi.value)}</dd>
            <p>{kpi.caption}</p>
          </div>
        ))}
      </dl>

      <div className="mb-cc-tools">
        <label className="mb-folio-search">
          <Search size={14} aria-hidden="true" />
          <input
            className="form-input"
            placeholder="Socio, DNI o nombre…"
            value={query}
            onChange={(event) => { setQuery(event.target.value); setPage(0); }}
          />
        </label>
        <label className="mb-cc-check">
          <input
            type="checkbox"
            checked={onlyLiquidation}
            onChange={(event) => { setOnlyLiquidation(event.target.checked); setPage(0); }}
          />
          Solo con cuota del mes
        </label>
        <span className="mb-folio-status">
          {rows.length.toLocaleString('es-AR')} de {summary.listedCount.toLocaleString('es-AR')} con saldo
          {' · '}padrón {summary.sourceCount.toLocaleString('es-AR')}
        </span>
      </div>

      <div className="table-responsive">
        <table className="admin-table mb-folio-table">
          <thead>
            <tr>
              <th>Socio</th>
              <th>Nombre</th>
              <th style={{ textAlign: 'right' }}>Saldo ant.</th>
              <th style={{ textAlign: 'right' }}>Liquidación</th>
              <th style={{ textAlign: 'right' }}>Otros</th>
              <th style={{ textAlign: 'right' }}>Intereses</th>
              <th style={{ textAlign: 'right' }}>Sin recargos</th>
              <th style={{ textAlign: 'right' }}>Recargo</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <tr>
                <td colSpan={9} className="mb-folio-empty">
                  {book.debts.length === 0
                    ? 'Nadie tiene saldo de cuota en el padrón vivo.'
                    : 'No hay cuentas con este filtro.'}
                </td>
              </tr>
            ) : (
              pageRows.map((row) => (
                <tr key={row.id}>
                  <td>{row.memberNumber}</td>
                  <td>{row.memberName || '—'}</td>
                  <td style={{ textAlign: 'right' }}>{formatCurrency(row.previousBalance)}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>{formatCurrency(row.liquidation)}</td>
                  <td style={{ textAlign: 'right' }}>{formatCurrency(row.others)}</td>
                  <td style={{ textAlign: 'right' }}>{formatCurrency(row.interests)}</td>
                  <td style={{ textAlign: 'right' }}>{formatCurrency(row.withoutSurcharge)}</td>
                  <td style={{ textAlign: 'right' }}>{formatCurrency(row.surcharge)}</td>
                  <td>{row.standing || '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {rows.length > PAGE_SIZE ? (
        <div className="mb-folio-pager">
          <button type="button" className="btn btn-secondary btn-sm" disabled={safePage === 0} onClick={() => setPage((current) => current - 1)}>
            Anterior
          </button>
          <span>Hoja {safePage + 1} / {totalPages}</span>
          <button type="button" className="btn btn-secondary btn-sm" disabled={safePage >= totalPages - 1} onClick={() => setPage((current) => current + 1)}>
            Siguiente
          </button>
        </div>
      ) : null}
    </div>
  );
}
