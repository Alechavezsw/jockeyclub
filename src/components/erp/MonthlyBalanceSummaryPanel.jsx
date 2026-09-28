import { useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { formatCurrency } from '../../domain/accounting/journal';
import { formatAccessinCashDate } from '../../domain/accounting/cashLedger';
import {
  monthlyBalanceSummaryCards,
  monthlyBalanceSummarySeed,
} from '../../domain/accounting/monthlyBalanceSummary';
import SnapshotGate from '../SnapshotGate';

const SMALL_WORDS = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'por', 'en', 'a']);

function monthHeadingAR(isoFrom) {
  const match = /^(\d{4})-(\d{2})/.exec(String(isoFrom || ''));
  if (!match) return 'Balance resumido';
  const [, year, month] = match;
  const months = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
  ];
  const label = months[Number(month) - 1];
  return label ? `${label} del ${year}` : 'Balance resumido';
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

export default function MonthlyBalanceSummaryPanel(props) {
  return (
    <SnapshotGate names={['accessinMonthlyBalanceSummary']}>
      <MonthlyBalanceSummaryContent {...props} />
    </SnapshotGate>
  );
}

function MonthlyBalanceSummaryContent({
  snapshot = monthlyBalanceSummarySeed().ACCESSIN_MONTHLY_BALANCE_SUMMARY_SNAPSHOT,
  sections = monthlyBalanceSummarySeed().ACCESSIN_MONTHLY_BALANCE_SUMMARY_SECTIONS,
}) {
  const cards = useMemo(() => monthlyBalanceSummaryCards(snapshot), [snapshot]);
  const [openSections, setOpenSections] = useState(() => new Set(sections[0] ? [sections[0].id] : []));

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
          <p className="mb-folio-kicker">Balance general resumido</p>
          <h3 className="mb-folio-title">{periodLabel}</h3>
          <p className="mb-folio-meta">
            {formatAccessinCashDate(cards.periodFrom)} — {formatAccessinCashDate(cards.periodTo)}
            {cards.generatedAt ? ` · Generado el ${cards.generatedAt}` : ''}
          </p>
        </div>
        <span className="mb-folio-seal">Resumen LILA</span>
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
              ) : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}
