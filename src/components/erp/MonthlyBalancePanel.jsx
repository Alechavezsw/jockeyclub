import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ChevronDown, ChevronRight, Search } from 'lucide-react';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../../domain/accounting/chartOfAccounts';
import { formatCurrency } from '../../domain/accounting/journal';
import {
  buildLiveMonthlyBalances,
  filterLiveBalanceDetailRows,
  liveMonthlyBalanceDetail,
} from '../../domain/accounting/liveMonthlyBalance';
import {
  balanceSectionFamily,
  balanceSectionFamilyLabel,
  balanceSectionItemCount,
} from '../../domain/accounting/monthlyBalance';
import { formatISODateLongAR } from '../../lib/arDate';

const PAGE_SIZE = 40;

function formatPeriod(from, to) {
  if (!from) return '';
  if (!to || to === from) return formatISODateLongAR(from);
  return `${formatISODateLongAR(from)} — ${formatISODateLongAR(to)}`;
}

function formatCell(row, column) {
  const value = row[column.key];
  if (column.money) return formatCurrency(value);
  if (column.key === 'fecha') return value ? formatISODateLongAR(value) : '—';
  if (value == null || value === '') return '—';
  return String(value);
}

function MonthlyBalanceDetailView({ line, chart, onBack }) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const detail = useMemo(() => liveMonthlyBalanceDetail(line, chart), [line, chart]);
  const rows = useMemo(
    () => filterLiveBalanceDetailRows(detail.rows, query),
    [detail.rows, query],
  );
  const columns = detail.columns;
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = rows.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  return (
    <div className="fade-in mb-folio">
      <header className="mb-folio-head">
        <div>
          <button type="button" className="mb-folio-back" onClick={onBack}>
            <ArrowLeft size={14} aria-hidden="true" />
            Volver al balance
          </button>
          <p className="mb-folio-kicker">Detalle del mes</p>
          <h3 className="mb-folio-title">{detail.title}</h3>
          <p className="mb-folio-meta">
            {line.label}
            {` · ${detail.count.toLocaleString('es-AR')} movimientos · ${formatCurrency(detail.total)}`}
          </p>
        </div>
      </header>

      <label className="mb-folio-search">
        <Search size={14} aria-hidden="true" />
        <input
          className="form-input"
          placeholder="Asiento o fecha…"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setPage(0);
          }}
        />
      </label>

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
                    ? 'Esta cuenta no tiene movimientos en el mes.'
                    : 'No hay movimientos con este filtro.'}
                </td>
              </tr>
            ) : (
              pageRows.map((row, index) => (
                <tr key={`${row.fecha || 'row'}-${row.glosa}-${index}`}>
                  {columns.map((column) => (
                    <td key={column.key} style={column.money ? { textAlign: 'right', fontWeight: 700 } : undefined}>
                      {formatCell(row, column)}
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

function MonthKpis({ month }) {
  const kpis = [
    {
      id: 'net',
      accent: 'is-net',
      label: 'Ingresos netos',
      value: month.totalIncome,
      caption: 'Cuentas de ingreso del mes',
    },
    {
      id: 'cash',
      accent: 'is-in',
      label: 'Ingresos en caja',
      value: month.totalIncomeCash,
      caption: 'Cobrado en caja y bancos',
    },
    {
      id: 'out',
      accent: 'is-out',
      label: 'Egresos',
      value: month.totalExpenses,
      caption: 'Cuentas de gasto del mes',
    },
    {
      id: 'saldo',
      accent: 'is-cash',
      label: 'Saldos de caja',
      value: month.cashOnHand,
      caption: month.periodTo ? `Al ${formatISODateLongAR(month.periodTo)}` : 'Al cierre del mes',
    },
  ];

  return (
    <dl className="mb-folio-kpis">
      {kpis.map((kpi) => (
        <div key={kpi.id} className={['mb-folio-kpi', kpi.accent].filter(Boolean).join(' ')}>
          <dt>{kpi.label}</dt>
          <dd>{formatCurrency(kpi.value)}</dd>
          <p>{kpi.caption}</p>
        </div>
      ))}
    </dl>
  );
}

export default function MonthlyBalancePanel({
  journalEntries = [],
  chartOfAccounts = DEFAULT_CHART_OF_ACCOUNTS,
}) {
  const months = useMemo(
    () => buildLiveMonthlyBalances(journalEntries, chartOfAccounts),
    [journalEntries, chartOfAccounts],
  );
  const [openMonth, setOpenMonth] = useState(null);
  const [pickedMonth, setPickedMonth] = useState(false);
  const [openSection, setOpenSection] = useState(null);
  const [selectedLine, setSelectedLine] = useState(null);

  const newestKey = months[0]?.key || null;
  const visibleMonth = pickedMonth ? openMonth : newestKey;
  const selectedMonth = months.find((month) => month.key === visibleMonth) || months[0];

  const firstSectionId = selectedMonth?.sections[0]?.id || null;
  useEffect(() => {
    setOpenSection(firstSectionId);
  }, [visibleMonth, firstSectionId]);

  if (selectedLine) {
    return (
      <MonthlyBalanceDetailView
        line={selectedLine}
        chart={chartOfAccounts}
        onBack={() => setSelectedLine(null)}
      />
    );
  }

  return (
    <div className="fade-in mb-folio">
      <header className="mb-folio-head">
        <div>
          <p className="mb-folio-kicker">Balance mensual</p>
          <h3 className="mb-folio-title">Mes por mes</h3>
          <p className="mb-folio-meta">
            Mismo libro que el diario: liquidaciones, caja y asientos vivos. El ingreso contable y el cobro en caja van aparte.
          </p>
        </div>
      </header>

      <ul className="mb-legend" aria-label="Partes del balance">
        <li className="is-cash">Caja</li>
        <li className="is-in">Ingresos</li>
        <li className="is-out">Egresos</li>
      </ul>

      {months.length === 0 ? (
        <p className="mb-folio-status">Todavía no hay asientos en el libro.</p>
      ) : (
        <div className="jd-days">
          {months.map((month) => {
            const monthOpen = visibleMonth === month.key;
            return (
              <section key={month.key} className={['jd-month', monthOpen ? 'is-open' : ''].filter(Boolean).join(' ')}>
                <button
                  type="button"
                  className="jd-month-toggle"
                  aria-expanded={monthOpen}
                  onClick={() => {
                    const next = visibleMonth === month.key ? null : month.key;
                    setPickedMonth(true);
                    setOpenMonth(next);
                    setOpenSection(next ? month.sections[0]?.id || null : null);
                    setSelectedLine(null);
                  }}
                >
                  <span>
                    {month.label}
                    <em>{month.count === 1 ? '1 asiento' : `${month.count} asientos`}</em>
                    <i className={`mb-mix-chip is-${month.complete ? 'cash' : 'in'}`}>
                      {month.complete ? 'Mes cerrado' : 'Mes en curso'}
                    </i>
                  </span>
                  <ChevronDown size={16} className="jd-day-chevron" aria-hidden="true" />
                </button>
                {monthOpen ? (
                  <div className="jd-month-body">
                    <p className="jd-day-caption">
                      <time dateTime={month.periodFrom || undefined}>
                        {formatPeriod(month.periodFrom, month.periodTo)}
                      </time>
                      <em>Resultado {formatCurrency(month.resultado)}</em>
                    </p>
                    <MonthKpis month={month} />
                    <div className="mb-sections">
                      {month.sections.map((section) => {
                        const open = openSection === section.id;
                        const family = section.family || balanceSectionFamily(section);
                        const count = balanceSectionItemCount(section);
                        return (
                          <section
                            key={section.id}
                            className={['mb-section', `is-${family}`, open ? 'is-open' : ''].filter(Boolean).join(' ')}
                          >
                            <button
                              type="button"
                              className="mb-section-toggle"
                              aria-expanded={open}
                              onClick={() => setOpenSection(open ? null : section.id)}
                            >
                              <span>
                                {section.title}
                                <em>{count === 1 ? '1 línea' : `${count} líneas`}</em>
                                <i className={`mb-mix-chip is-${family}`}>{balanceSectionFamilyLabel(family)}</i>
                              </span>
                              <ChevronDown size={16} className="mb-section-chevron" aria-hidden="true" />
                            </button>
                            {open ? (
                              <div className="mb-section-body">
                                <div className="table-responsive">
                                  <table className="balance-table">
                                    <tbody>
                                      {section.lines.map((line) => {
                                        const clickable = Boolean(line.accountId || line.detailKind);
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
                                                  onClick={() => setSelectedLine({
                                                    ...line,
                                                    entries: line.detailKind === 'cash'
                                                      ? (month.entriesThrough || month.entries)
                                                      : month.entries,
                                                  })}
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
                              </div>
                            ) : null}
                          </section>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
