import { useEffect, useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../../domain/accounting/chartOfAccounts';
import { formatCurrency } from '../../domain/accounting/journal';
import { buildLiveBalanceSummary } from '../../domain/accounting/liveMonthlyBalance';
import {
  balanceSectionFamily,
  balanceSectionFamilyLabel,
  balanceSectionItemCount,
} from '../../domain/accounting/monthlyBalance';
import { formatISODateLongAR } from '../../lib/arDate';

function formatPeriod(from, to) {
  if (!from) return '';
  if (!to || to === from) return formatISODateLongAR(from);
  return `${formatISODateLongAR(from)} — ${formatISODateLongAR(to)}`;
}

export default function MonthlyBalanceSummaryPanel({
  journalEntries = [],
  chartOfAccounts = DEFAULT_CHART_OF_ACCOUNTS,
}) {
  const summary = useMemo(
    () => buildLiveBalanceSummary(journalEntries, chartOfAccounts),
    [journalEntries, chartOfAccounts],
  );
  const [openSection, setOpenSection] = useState(null);
  const firstSectionId = summary.sections[0]?.id || null;

  useEffect(() => {
    setOpenSection(firstSectionId);
  }, [firstSectionId]);

  const kpis = [
    {
      id: 'net',
      accent: 'is-net',
      label: 'Ingresos netos',
      value: summary.totalIncome,
      caption: 'Cuentas de ingreso del libro',
    },
    {
      id: 'cash',
      accent: 'is-in',
      label: 'Ingresos en caja',
      value: summary.totalIncomeCash,
      caption: 'Cobrado en caja y bancos',
    },
    {
      id: 'out',
      accent: 'is-out',
      label: 'Egresos',
      value: summary.totalExpenses,
      caption: 'Cuentas de gasto del libro',
    },
    {
      id: 'saldo',
      accent: 'is-cash',
      label: 'Saldos de caja',
      value: summary.cashOnHand,
      caption: summary.periodTo ? `Al ${formatISODateLongAR(summary.periodTo)}` : 'Al último movimiento',
    },
  ];

  return (
    <div className="fade-in mb-folio">
      <header className="mb-folio-head">
        <div>
          <p className="mb-folio-kicker">Balance resumido</p>
          <h3 className="mb-folio-title">Todo el libro</h3>
          <p className="mb-folio-meta">
            {summary.count
              ? `${formatPeriod(summary.periodFrom, summary.periodTo)} · ${summary.months.length} ${summary.months.length === 1 ? 'mes' : 'meses'} · ${summary.count} asientos. Mismo libro que el diario.`
              : 'Mismo libro que el diario: liquidaciones, caja y asientos vivos.'}
          </p>
        </div>
        <span className="mb-folio-seal">{summary.complete ? 'Cerrado' : 'En curso'}</span>
      </header>

      {summary.months.length === 0 ? (
        <p className="mb-folio-status">Todavía no hay asientos en el libro.</p>
      ) : (
        <>
          <dl className="mb-folio-kpis">
            {kpis.map((kpi) => (
              <div key={kpi.id} className={['mb-folio-kpi', kpi.accent].filter(Boolean).join(' ')}>
                <dt>{kpi.label}</dt>
                <dd>{formatCurrency(kpi.value)}</dd>
                <p>{kpi.caption}</p>
              </div>
            ))}
          </dl>

          <ul className="mb-legend" aria-label="Partes del balance">
            <li className="is-cash">Caja</li>
            <li className="is-in">Ingresos</li>
            <li className="is-out">Egresos</li>
          </ul>

          <div className="table-responsive mb-summary-table-wrap">
            <table className="admin-table mb-folio-table mb-summary-table">
              <thead>
                <tr>
                  <th>Mes</th>
                  <th style={{ textAlign: 'right' }}>Ingresos</th>
                  <th style={{ textAlign: 'right' }}>En caja</th>
                  <th style={{ textAlign: 'right' }}>Egresos</th>
                  <th style={{ textAlign: 'right' }}>Resultado</th>
                  <th style={{ textAlign: 'right' }}>Saldo caja</th>
                </tr>
              </thead>
              <tbody>
                {summary.months.map((month) => (
                  <tr key={month.key}>
                    <td>
                      <span className="mb-summary-month">
                        {month.label}
                        <em className={`mb-mix-chip is-${month.complete ? 'cash' : 'in'}`}>
                          {month.complete ? 'Cerrado' : 'En curso'}
                        </em>
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>{formatCurrency(month.totalIncome)}</td>
                    <td style={{ textAlign: 'right' }}>{formatCurrency(month.totalIncomeCash)}</td>
                    <td style={{ textAlign: 'right' }}>{formatCurrency(month.totalExpenses)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>{formatCurrency(month.resultado)}</td>
                    <td style={{ textAlign: 'right' }}>{formatCurrency(month.cashOnHand)}</td>
                  </tr>
                ))}
                <tr className="balance-row-total">
                  <td>Totales</td>
                  <td style={{ textAlign: 'right' }}>{formatCurrency(summary.totalIncome)}</td>
                  <td style={{ textAlign: 'right' }}>{formatCurrency(summary.totalIncomeCash)}</td>
                  <td style={{ textAlign: 'right' }}>{formatCurrency(summary.totalExpenses)}</td>
                  <td style={{ textAlign: 'right' }}>{formatCurrency(summary.resultado)}</td>
                  <td style={{ textAlign: 'right' }}>{formatCurrency(summary.cashOnHand)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="mb-sections">
            {summary.sections.map((section) => {
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
                            {section.lines.map((line) => (
                              <tr
                                key={line.id}
                                className={[
                                  line.kind === 'total' ? 'balance-row-total' : '',
                                  line.kind === 'subtotal' ? 'balance-row-subtotal' : 'balance-row-account',
                                ].filter(Boolean).join(' ')}
                              >
                                <td>{line.label}</td>
                                <td style={{ textAlign: 'right', fontWeight: line.kind === 'item' ? 500 : 700 }}>
                                  {line.amount == null ? '—' : formatCurrency(line.amount)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : null}
                </section>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
