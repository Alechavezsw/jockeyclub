import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CalendarDays, ChevronRight, Search } from 'lucide-react';
import { formatCurrency } from '../../domain/accounting/journal';
import { formatAccessinCashDate } from '../../domain/accounting/cashLedger';
import {
  ACCESSIN_MONTHLY_BALANCE_SECTIONS,
  ACCESSIN_MONTHLY_BALANCE_SNAPSHOT,
  filterMonthlyBalanceDetailRows,
  loadMonthlyBalanceDetails,
  monthlyBalanceCards,
  monthlyBalanceDetailColumns,
  resolveMonthlyBalanceDetail,
} from '../../domain/accounting/monthlyBalance';
import LilaSourceNote from './LilaSourceNote';

const PAGE_SIZE = 40;

function formatCell(row, column) {
  const value = row[column.key];
  if (column.money) return formatCurrency(value);
  if (column.key === 'fecha') return formatAccessinCashDate(value);
  if (value == null || value === '') return '—';
  return String(value);
}

function MonthlyBalanceDetailView({ line, detail, loading, error, onBack, onOpenMember }) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);

  const columns = useMemo(() => monthlyBalanceDetailColumns(detail), [detail]);
  const rows = useMemo(
    () => filterMonthlyBalanceDetailRows(detail?.rows || [], query),
    [detail, query]
  );
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = rows.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
  const socioKey = columns.some((col) => col.key === 'nro_de_socio');

  return (
    <div className="fade-in cuotas-panel">
      <div className="cuotas-toolbar">
        <button type="button" className="btn btn-secondary btn-sm" onClick={onBack}>
          <ArrowLeft size={14} /> Volver
        </button>
        <h3 className="cuotas-title" style={{ margin: 0 }}>
          <CalendarDays size={18} /> {detail?.title || line.label}
        </h3>
      </div>

      <p style={{ margin: '0 0 0.85rem', color: 'var(--text-secondary)', fontSize: '0.86rem' }}>
        {line.label}
        {detail ? ` · ${detail.count.toLocaleString('es-AR')} movimientos · ${formatCurrency(detail.total)}` : ''}
      </p>

      <label className="cash-lila-search" style={{ marginBottom: '0.85rem' }}>
        <Search size={14} />
        <input
          className="form-input"
          placeholder="Socio, DNI, concepto…"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setPage(0); }}
        />
      </label>

      {loading ? (
        <p style={{ color: 'var(--text-muted)' }}>Cargando detalle LILA…</p>
      ) : null}

      {error ? (
        <p style={{ color: 'var(--danger, #ef4444)' }}>{error}</p>
      ) : null}

      {!loading && !error && detail ? (
        <>
          <div className="table-responsive">
            <table className="admin-table cash-lila-table">
              <thead>
                <tr>
                  {columns.map((column) => (
                    <th key={column.key} style={column.money ? { textAlign: 'right' } : undefined}>
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pageRows.length === 0 ? (
                  <tr>
                    <td colSpan={Math.max(columns.length, 1)} style={{ color: 'var(--text-muted)' }}>
                      {detail.count === 0
                        ? 'Esta hoja LILA no tiene movimientos en el período.'
                        : 'No hay movimientos con este filtro.'}
                    </td>
                  </tr>
                ) : (
                  pageRows.map((row, index) => (
                    <tr key={`${row.col_0 || row.nro_de_socio || 'row'}-${row.fecha || ''}-${index}`}>
                      {columns.map((column) => (
                        <td key={column.key} style={column.money ? { textAlign: 'right', fontWeight: 700 } : undefined}>
                          {column.key === 'nro_de_socio' && onOpenMember && row.nro_de_socio ? (
                            <button
                              type="button"
                              className="cash-lila-card-btn"
                              onClick={() => onOpenMember(row.nro_de_socio)}
                            >
                              {row.nro_de_socio}
                            </button>
                          ) : formatCell(row, column)}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
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

          {!socioKey && detail.count > 0 ? (
            <p style={{ marginTop: '0.75rem', color: 'var(--text-muted)', fontSize: '0.78rem' }}>
              Este detalle no está nominado a un socio.
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

export default function MonthlyBalancePanel({
  snapshot = ACCESSIN_MONTHLY_BALANCE_SNAPSHOT,
  sections = ACCESSIN_MONTHLY_BALANCE_SECTIONS,
  onOpenMember,
}) {
  const cards = useMemo(() => monthlyBalanceCards(snapshot), [snapshot]);
  const [openSections, setOpenSections] = useState(() => new Set(sections.map((section) => section.id)));
  const [selectedLine, setSelectedLine] = useState(null);
  const [detailsCatalog, setDetailsCatalog] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState('');

  useEffect(() => {
    if (!selectedLine?.detailKey) return undefined;
    let cancelled = false;
    setLoadingDetail(true);
    setDetailError('');
    loadMonthlyBalanceDetails()
      .then((catalog) => {
        if (!cancelled) setDetailsCatalog(catalog);
      })
      .catch(() => {
        if (!cancelled) setDetailError('No se pudo cargar el detalle del Balance Mensual.');
      })
      .finally(() => {
        if (!cancelled) setLoadingDetail(false);
      });
    return () => { cancelled = true; };
  }, [selectedLine?.detailKey]);

  const selectedDetail = resolveMonthlyBalanceDetail(detailsCatalog, selectedLine?.detailKey);

  if (selectedLine) {
    return (
      <MonthlyBalanceDetailView
        line={selectedLine}
        detail={selectedDetail}
        loading={loadingDetail}
        error={detailError}
        onBack={() => setSelectedLine(null)}
        onOpenMember={onOpenMember}
      />
    );
  }

  return (
    <div className="fade-in cuotas-panel">
      <div className="cuotas-toolbar">
        <h3 className="cuotas-title" style={{ margin: 0 }}>
          <CalendarDays size={18} /> {cards.complete ? 'Balance mensual completo' : 'Balance mensual'}
        </h3>
      </div>

      <p style={{ margin: '0 0 0.85rem', color: 'var(--text-secondary)', fontSize: '0.86rem' }}>
        Export LILA · {cards.fileName || 'Balance Mensual'}
        {cards.sourceFolder ? ` · ${cards.sourceFolder}` : ''}
        {' · '}{formatAccessinCashDate(cards.periodFrom)} — {formatAccessinCashDate(cards.periodTo)}
        {cards.generatedAt ? ` · Generado el ${cards.generatedAt}.` : '.'}
      </p>
      <LilaSourceNote
        asOf={formatAccessinCashDate(cards.asOf)}
        period={`${formatAccessinCashDate(cards.periodFrom)} — ${formatAccessinCashDate(cards.periodTo)}`}
        extra="Ingresos netos e ingresos en caja no son el mismo total."
      />

      <div className="cash-lila-cards">
        <div className="cash-lila-card is-total">
          <div className="cash-lila-card-label">Ingresos netos</div>
          <div className="cash-lila-card-value">{formatCurrency(cards.totalIncome)}</div>
          <div className="cash-lila-card-caption">Tras imputaciones y saldo a favor</div>
        </div>
        <div className="cash-lila-card">
          <div className="cash-lila-card-label">Ingresos en caja</div>
          <div className="cash-lila-card-value">{formatCurrency(cards.totalIncomeCash)}</div>
          <div className="cash-lila-card-caption">Cobrado por medio, sin netear</div>
        </div>
        <div className="cash-lila-card">
          <div className="cash-lila-card-label">Egresos</div>
          <div className="cash-lila-card-value">{formatCurrency(cards.totalExpenses)}</div>
          <div className="cash-lila-card-caption">Categorizados en LILA</div>
        </div>
        <div className="cash-lila-card">
          <div className="cash-lila-card-label">Saldos de caja</div>
          <div className="cash-lila-card-value">{formatCurrency(cards.cashOnHand)}</div>
          <div className="cash-lila-card-caption">Cierre {formatCurrency(cards.closingCash)}</div>
        </div>
      </div>

      <div className="mb-sections">
        {sections.map((section) => {
          const open = openSections.has(section.id);
          return (
            <section key={section.id} className="mb-section">
              <button
                type="button"
                className="mb-section-toggle"
                aria-expanded={open}
                onClick={() => {
                  setOpenSections((current) => {
                    const next = new Set(current);
                    if (next.has(section.id)) next.delete(section.id);
                    else next.add(section.id);
                    return next;
                  });
                }}
              >
                {section.title}
                <span>{open ? '−' : '+'}</span>
              </button>
              {open ? (
                <div className="table-responsive">
                  <table className="balance-table">
                    <tbody>
                      {section.lines.map((line) => {
                        const clickable = Boolean(line.detailKey);
                        return (
                          <tr
                            key={line.id}
                            className={[
                              line.kind === 'total' ? 'balance-row-total' : '',
                              line.kind === 'subtotal' ? 'balance-row-subtotal' : 'balance-row-account',
                              clickable ? 'is-clickable' : '',
                            ].filter(Boolean).join(' ')}
                          >
                            <td>
                              {clickable ? (
                                <button
                                  type="button"
                                  className="mb-line-btn"
                                  onClick={() => setSelectedLine(line)}
                                >
                                  {line.label}
                                  <ChevronRight size={14} aria-hidden="true" />
                                </button>
                              ) : line.label}
                            </td>
                            <td style={{ textAlign: 'right', fontWeight: line.kind === 'item' ? 500 : 700 }}>
                              {line.amount == null ? '—' : formatCurrency(line.amount)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}
