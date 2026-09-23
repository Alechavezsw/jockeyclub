import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ChevronDown, ChevronRight, Search } from 'lucide-react';
import { formatCurrency } from '../../domain/accounting/journal';
import { formatAccessinCashDate } from '../../domain/accounting/cashLedger';
import {
  filterMonthlyBalanceDetailRows,
  loadMonthlyBalanceDetails,
  monthlyBalanceCards,
  monthlyBalanceDetailColumns,
  monthlyBalanceSeed,
  resolveMonthlyBalanceDetail,
} from '../../domain/accounting/monthlyBalance';
import SnapshotGate from '../SnapshotGate';
const PAGE_SIZE = 40;
const SMALL_WORDS = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'por', 'en', 'a']);

function monthHeadingAR(isoFrom) {
  const match = /^(\d{4})-(\d{2})/.exec(String(isoFrom || ''));
  if (!match) return 'Balance mensual';
  const [, year, month] = match;
  const months = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
  ];
  const label = months[Number(month) - 1];
  return label ? `${label} del ${year}` : 'Balance mensual';
}

function prettySectionTitle(title) {
  return String(title || '')
    .toLowerCase()
    .split(/\s+/)
    .map((word, index) => {
      if (index > 0 && SMALL_WORDS.has(word)) return word;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}

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
    <div className="fade-in mb-folio">
      <header className="mb-folio-head">
        <div>
          <button type="button" className="mb-folio-back" onClick={onBack}>
            <ArrowLeft size={14} aria-hidden="true" />
            Volver al balance
          </button>
          <p className="mb-folio-kicker">Detalle del mes</p>
          <h3 className="mb-folio-title">{detail?.title || line.label}</h3>
          <p className="mb-folio-meta">
            {line.label}
            {detail ? ` · ${detail.count.toLocaleString('es-AR')} movimientos · ${formatCurrency(detail.total)}` : ''}
          </p>
        </div>
      </header>

      <label className="mb-folio-search">
        <Search size={14} aria-hidden="true" />
        <input
          className="form-input"
          placeholder="Socio, DNI, concepto…"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setPage(0); }}
        />
      </label>

      {loading ? (
        <p className="mb-folio-status">Cargando detalle…</p>
      ) : null}

      {error ? (
        <p className="mb-folio-status is-error">{error}</p>
      ) : null}

      {!loading && !error && detail ? (
        <>
          <div className="table-responsive">
            <table className="admin-table mb-folio-table">
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
                    <td colSpan={Math.max(columns.length, 1)} className="mb-folio-empty">
                      {detail.count === 0
                        ? 'Esta hoja no tiene movimientos en el período.'
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
                              className="mb-folio-link"
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
            <div className="mb-folio-pager">
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
            <p className="mb-folio-status">Este detalle no está nominado a un socio.</p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

export default function MonthlyBalancePanel(props) {
  // El detalle por hoja (1,5 MB) se baja aparte, al abrir una línea.
  return (
    <SnapshotGate names={['accessinMonthlyBalance']}>
      <MonthlyBalanceContent {...props} />
    </SnapshotGate>
  );
}

function MonthlyBalanceContent({
  snapshot = monthlyBalanceSeed().ACCESSIN_MONTHLY_BALANCE_SNAPSHOT,
  sections = monthlyBalanceSeed().ACCESSIN_MONTHLY_BALANCE_SECTIONS,
  onOpenMember,
}) {
  const cards = useMemo(() => monthlyBalanceCards(snapshot), [snapshot]);
  const [openSections, setOpenSections] = useState(() => new Set(sections[0] ? [sections[0].id] : []));
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
        if (!cancelled) setDetailError('No se pudo cargar el detalle del balance mensual.');
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

  const periodLabel = monthHeadingAR(cards.periodFrom);
  const kpis = [
    {
      id: 'net',
      accent: 'is-net',
      label: 'Ingresos netos',
      value: cards.totalIncome,
      caption: 'Tras imputaciones y saldo a favor',
    },
    {
      id: 'cash',
      accent: '',
      label: 'Ingresos en caja',
      value: cards.totalIncomeCash,
      caption: 'Cobrado por medio, sin netear',
    },
    {
      id: 'out',
      accent: 'is-out',
      label: 'Egresos',
      value: cards.totalExpenses,
      caption: 'Por categoría del período',
    },
    {
      id: 'saldo',
      accent: '',
      label: 'Saldos de caja',
      value: cards.cashOnHand,
      caption: `Cierre ${formatCurrency(cards.closingCash)}`,
    },
  ];

  return (
    <div className="fade-in mb-folio">
      <header className="mb-folio-head">
        <div>
          <p className="mb-folio-kicker">Balance mensual</p>
          <h3 className="mb-folio-title">{periodLabel}</h3>
          <p className="mb-folio-meta">
            {formatAccessinCashDate(cards.periodFrom)} — {formatAccessinCashDate(cards.periodTo)}
            {cards.generatedAt ? ` · Generado el ${cards.generatedAt}` : ''}
            {cards.sourceFolder ? ` · ${cards.sourceFolder}` : ''}
          </p>
        </div>
        {cards.complete ? <span className="mb-folio-seal">Cierre completo</span> : null}
      </header>

      <dl className="mb-folio-kpis">
        {kpis.map((kpi) => (
          <div key={kpi.id} className={['mb-folio-kpi', kpi.accent].filter(Boolean).join(' ')}>
            <dt>{kpi.label}</dt>
            <dd>{formatCurrency(kpi.value)}</dd>
            <p>{kpi.caption}</p>
          </div>
        ))}
      </dl>

      <div className="mb-sections">
        {sections.map((section) => {
          const open = openSections.has(section.id);
          return (
            <section key={section.id} className={['mb-section', open ? 'is-open' : ''].filter(Boolean).join(' ')}>
              <button
                type="button"
                className="mb-section-toggle"
                aria-expanded={open}
                onClick={() => {
                  setOpenSections((current) => (
                    current.has(section.id) ? new Set() : new Set([section.id])
                  ));
                }}
              >
                <span>{prettySectionTitle(section.title)}</span>
                <ChevronDown size={16} className="mb-section-chevron" aria-hidden="true" />
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
