import { useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { formatCurrency } from '../../domain/accounting/journal';
import { buildResultsInsights, monthLabelAR } from '../../domain/accounting/resultsInsights';

const SOURCE_LABELS = {
  manual: 'Manual',
  eventos: 'Eventos',
  pileta: 'Pileta',
  caja: 'Caja',
  gastos: 'Gastos',
  concesiones: 'Concesiones',
  cuotas: 'Cuotas',
};

const SILK_TONES = ['is-gold', 'is-emerald', 'is-ink', 'is-sand', 'is-pine'];
const SLICE_COLORS = [
  'var(--primary-gold)',
  'var(--emerald-accent)',
  'color-mix(in srgb, var(--text-primary) 68%, var(--primary-gold))',
  'color-mix(in srgb, var(--primary-gold) 58%, var(--bg-tertiary))',
  'color-mix(in srgb, var(--emerald-accent) 58%, var(--bg-tertiary))',
];

const PIE_R = 34;
const PIE_CIRC = 2 * Math.PI * PIE_R;

function sliceColor(index, label, colors) {
  return colors?.[label] || SLICE_COLORS[index % SLICE_COLORS.length];
}

function MixPie({ rows, total, centerLabel, emptyLabel, onOpen, colors }) {
  const [hover, setHover] = useState(null);
  const slices = rows.filter((row) => row.amount > 0);
  const active = hover ? slices.find((row) => row.label === hover) : null;
  const centerName = active
    ? (SOURCE_LABELS[active.label] || active.label)
    : centerLabel;
  const centerValue = active ? formatCurrency(active.amount) : formatCurrency(total);
  const centerPct = active ? pctLabel(active.amount, total) : null;

  return (
    <div className="er-pie">
      <div className="er-pie-ring">
        <svg viewBox="0 0 100 100" width="156" height="156" aria-hidden="true">
          <circle cx="50" cy="50" r={PIE_R} className="er-pie-track" />
          {total > 0 ? slices.reduce((acc, row, index) => {
            const frac = row.amount / total;
            acc.nodes.push(
              <circle
                key={row.label}
                cx="50"
                cy="50"
                r={PIE_R}
                fill="none"
                stroke={sliceColor(index, row.label, colors)}
                strokeWidth={hover === row.label ? 15 : 12}
                strokeDasharray={`${frac * PIE_CIRC} ${PIE_CIRC}`}
                strokeDashoffset={-acc.offset * PIE_CIRC}
                transform="rotate(-90 50 50)"
                className={['er-pie-slice', hover === row.label ? 'is-hot' : ''].filter(Boolean).join(' ')}
                onMouseEnter={() => setHover(row.label)}
                onMouseLeave={() => setHover(null)}
                onClick={onOpen ? () => onOpen(row.label) : undefined}
                style={{ cursor: onOpen ? 'pointer' : 'default' }}
              />,
            );
            acc.offset += frac;
            return acc;
          }, { offset: 0, nodes: [] }).nodes : null}
        </svg>
        <div className="er-pie-center">
          <strong>{centerValue}</strong>
          <span>{centerPct || centerName}</span>
          {centerPct ? <em>{centerName}</em> : null}
        </div>
      </div>
      {slices.length ? (
        <ul className="er-pie-legend">
          {slices.map((row, index) => (
            <li
              key={row.label}
              onMouseEnter={() => setHover(row.label)}
              onMouseLeave={() => setHover(null)}
            >
              <i style={{ background: sliceColor(index, row.label, colors) }} />
              {onOpen ? (
                <button type="button" className="mb-line-btn" onClick={() => onOpen(row.label)}>
                  {SOURCE_LABELS[row.label] || row.label}
                </button>
              ) : (
                <span>{SOURCE_LABELS[row.label] || row.label}</span>
              )}
              <em>{pctLabel(row.amount, total)}</em>
            </li>
          ))}
        </ul>
      ) : (
        <p className="er-empty">{emptyLabel}</p>
      )}
    </div>
  );
}

function pctLabel(part, whole) {
  if (!whole) return '—';
  return `${Math.round((part / whole) * 100)}%`;
}

function signedCurrency(amount) {
  const value = Number(amount) || 0;
  const formatted = formatCurrency(Math.abs(value));
  if (value > 0) return `+${formatted}`;
  if (value < 0) return `−${formatted}`;
  return formatted;
}

function MixList({ rows, total, tone = 'in', onOpen }) {
  if (!rows.length) {
    return <p className="er-empty">Todavía no hay movimientos en esta columna.</p>;
  }
  return (
    <ul className="er-mix">
      {rows.map((row) => {
        const width = total > 0 ? Math.max(2, (row.amount / total) * 100) : 0;
        const Tag = onOpen ? 'button' : 'div';
        return (
          <li key={row.label}>
            <Tag
              type={onOpen ? 'button' : undefined}
              className={['er-mix-row', `is-${tone}`, onOpen ? 'is-link' : ''].filter(Boolean).join(' ')}
              onClick={onOpen ? () => onOpen(row.label) : undefined}
            >
              <span className="er-mix-name">{SOURCE_LABELS[row.label] || row.label}</span>
              <span className="er-mix-track" aria-hidden="true">
                <i style={{ width: `${width}%` }} />
              </span>
              <strong>{formatCurrency(row.amount)}</strong>
              <em>{pctLabel(row.amount, total)}</em>
            </Tag>
          </li>
        );
      })}
    </ul>
  );
}

function SilkBar({ rows, total }) {
  if (!rows.length || !total) return null;
  return (
    <div className="er-silk" role="img" aria-label="Composición de ingresos">
      {rows.map((row, index) => {
        const width = Math.max(1.5, (row.amount / total) * 100);
        return (
          <span
            key={row.label}
            className={SILK_TONES[index % SILK_TONES.length]}
            style={{ width: `${width}%` }}
            title={`${row.label} ${formatCurrency(row.amount)}`}
          />
        );
      })}
    </div>
  );
}

function buildReading({ insights, income, expense, result }) {
  if (!insights.asientos) {
    return 'Todavía no hay asientos oficiales. Cuando se imputen cuotas, reservas o gastos, acá se lee el ejercicio.';
  }
  if (!expense) {
    const lead = insights.topIncome
      ? `${insights.topIncome.label} aporta ${pctLabel(insights.topIncome.amount, income)} del ingreso.`
      : 'Los ingresos ya están imputados.';
    return `${lead} No hay egresos en el diario oficial, así que el superávit coincide con la recaudación: ${formatCurrency(result)}. El margen queda en 100% hasta que se asienten sueldos, mantenimiento o hípica.`;
  }
  const lead = insights.topIncome
    ? `El ingreso vive sobre todo en ${insights.topIncome.label} (${pctLabel(insights.topIncome.amount, income)}).`
    : 'Hay ingresos imputados en varias cuentas.';
  const cover = insights.coverage == null
    ? ''
    : ` El cobro cubre el gasto ${insights.coverage.toFixed(1)} veces.`;
  const pulse = insights.lastDelta == null
    ? ''
    : ` El último mes ${insights.lastDelta >= 0 ? 'mejoró' : 'cedió'} ${formatCurrency(Math.abs(insights.lastDelta))} frente al anterior.`;
  return `${lead} Resultado del ejercicio: ${formatCurrency(result)}.${cover}${pulse}`;
}

export default function ResultsChartsPanel({
  journalEntries = [],
  chartOfAccounts = [],
  accountPlan,
  getAccountBalance,
  totals,
  onOpenAccount,
}) {
  const insights = useMemo(
    () => buildResultsInsights(journalEntries, chartOfAccounts),
    [journalEntries, chartOfAccounts],
  );
  const [openBook, setOpenBook] = useState(true);
  const maxMonth = insights.series.reduce((max, row) => Math.max(max, row.income, row.expense), 0);
  const income = totals?.ingresos ?? insights.income;
  const expense = totals?.gastos ?? insights.expense;
  const result = totals?.resultado ?? insights.result;
  const marginPct = income > 0 ? Math.round((result / income) * 100) : 0;
  const period = insights.firstMonth && insights.lastMonth
    ? (insights.firstMonth === insights.lastMonth
      ? monthLabelAR(insights.firstMonth)
      : `${monthLabelAR(insights.firstMonth)} — ${monthLabelAR(insights.lastMonth)}`)
    : 'Sin asientos oficiales';
  const reading = buildReading({ insights, income, expense, result });

  const ingresos = (accountPlan?.ingresos || [])
    .map((name) => ({ name, amount: getAccountBalance(name) }))
    .toSorted((a, b) => b.amount - a.amount);
  const gastos = (accountPlan?.gastos || [])
    .map((name) => ({ name, amount: getAccountBalance(name) }))
    .toSorted((a, b) => b.amount - a.amount);
  const activos = (accountPlan?.activos || [])
    .map((name) => ({ name, amount: getAccountBalance(name) }))
    .filter((row) => row.amount)
    .toSorted((a, b) => b.amount - a.amount)
    .slice(0, 5);
  const liveAccounts = ingresos.filter((row) => row.amount).length + gastos.filter((row) => row.amount).length;
  const expenseShare = income > 0 ? Math.min(100, (expense / income) * 100) : (expense ? 100 : 0);
  const resultShare = income > 0 ? Math.min(100, (Math.abs(result) / income) * 100) : 0;

  return (
    <div className="fade-in mb-folio er-folio">
      <header className="mb-folio-head">
        <div>
          <p className="mb-folio-kicker">Gestión del ejercicio</p>
          <h3 className="mb-folio-title">{result >= 0 ? 'Superávit' : 'Déficit'}</h3>
          <p className="mb-folio-meta">
            {period}
            {' · '}
            {insights.asientos} asientos oficiales
            {insights.monthCount ? ` · ${insights.monthCount} mes${insights.monthCount === 1 ? '' : 'es'}` : ''}
          </p>
        </div>
        <span className={['mb-folio-seal', result >= 0 ? '' : 'is-warn'].filter(Boolean).join(' ')}>
          Margen {marginPct}%
        </span>
      </header>

      <div className="er-hero">
        <p className="er-hero-kicker">Resultado acumulado</p>
        <p className={['er-hero-figure', result >= 0 ? 'is-net' : 'is-out'].join(' ')}>
          {formatCurrency(result)}
        </p>
        <p className="er-hero-copy">{reading}</p>
        <SilkBar rows={insights.incomeMix} total={insights.income} />
        {insights.incomeMix.length ? (
          <ul className="er-silk-legend">
            {insights.incomeMix.map((row, index) => (
              <li key={row.label}>
                <i className={SILK_TONES[index % SILK_TONES.length]} />
                <button type="button" className="mb-line-btn" onClick={() => onOpenAccount?.(row.label)}>
                  {row.label}
                </button>
                <span>{pctLabel(row.amount, income)}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <dl className="mb-folio-kpis">
        <div className="mb-folio-kpi is-net">
          <dt>Ingresos</dt>
          <dd>{formatCurrency(income)}</dd>
          <p>{insights.incomeMix.length ? `${insights.incomeMix.length} cuentas con movimiento` : 'Sin cobros imputados'}</p>
        </div>
        <div className="mb-folio-kpi is-out">
          <dt>Egresos</dt>
          <dd>{formatCurrency(expense)}</dd>
          <p>{expense ? `${insights.expenseMix.length} cuentas` : 'Sin gastos imputados'}</p>
        </div>
        <div className={['mb-folio-kpi', result >= 0 ? 'is-net' : 'is-out'].filter(Boolean).join(' ')}>
          <dt>Resultado</dt>
          <dd>{formatCurrency(result)}</dd>
          <p>Ingresos menos egresos</p>
        </div>
        <div className="mb-folio-kpi">
          <dt>Cobertura</dt>
          <dd>{insights.coverage == null ? '—' : `${insights.coverage.toFixed(1)}×`}</dd>
          <p>{insights.coverage == null ? 'No hay egresos para cubrir' : 'Veces que el ingreso cubre el gasto'}</p>
        </div>
      </dl>

      <div className="er-highlights">
        <article>
          <p>Mejor mes</p>
          <strong>{insights.bestMonth ? monthLabelAR(insights.bestMonth.month) : '—'}</strong>
          <span>{insights.bestMonth ? formatCurrency(insights.bestMonth.result) : 'Sin serie mensual'}</span>
        </article>
        <article>
          <p>Cuenta líder</p>
          <strong>{insights.topIncome?.label || '—'}</strong>
          <span>
            {insights.topIncome
              ? `${formatCurrency(insights.topIncome.amount)} · ${pctLabel(insights.topIncome.amount, income)}`
              : 'Aún no hay mix de ingresos'}
          </span>
        </article>
        <article>
          <p>Concentración</p>
          <strong>{income ? `${Math.round(insights.concentration * 100)}%` : '—'}</strong>
          <span>{income ? 'Del ingreso en la cuenta principal' : 'Falta recaudación para medirlo'}</span>
        </article>
        <article>
          <p>Ritmo mensual</p>
          <strong>{insights.monthCount ? formatCurrency(insights.avgMonthlyIncome) : '—'}</strong>
          <span>
            {insights.lastDelta == null
              ? 'Promedio de ingresos por mes con asientos'
              : `Último mes ${signedCurrency(insights.lastDelta)} vs. el anterior`}
          </span>
        </article>
      </div>

      <section className="er-block">
        <div className="er-block-head">
          <h4>Tortas del ejercicio</h4>
          <span>{insights.incomeMix.length + insights.expenseMix.length + insights.sourceMix.length} cortes</span>
        </div>
        <div className="er-pies">
          <article>
            <h5>Ingresos</h5>
            <MixPie
              rows={insights.incomeMix}
              total={insights.income}
              centerLabel="Ingresos"
              emptyLabel="Sin cobros para armar la torta."
              onOpen={onOpenAccount}
            />
          </article>
          <article>
            <h5>Resultado</h5>
            <MixPie
              rows={[
                { label: 'Ingresos', amount: income },
                { label: 'Egresos', amount: expense },
              ]}
              total={income + expense}
              centerLabel={result >= 0 ? 'Superávit' : 'Déficit'}
              emptyLabel="Todavía no hay resultado para cortar."
              colors={{
                Ingresos: 'var(--emerald-accent)',
                Egresos: 'color-mix(in srgb, var(--danger-accent) 72%, var(--primary-gold))',
              }}
            />
          </article>
          <article>
            <h5>Origen</h5>
            <MixPie
              rows={insights.sourceMix}
              total={insights.income}
              centerLabel="Cobros"
              emptyLabel="Sin origen de cobro imputado."
            />
          </article>
          <article>
            <h5>Patrimonio</h5>
            <MixPie
              rows={[
                { label: 'Pasivo', amount: totals?.pasivos || 0 },
                { label: 'Patrimonio + resultado', amount: totals?.patrimonio || 0 },
              ]}
              total={totals?.pasivoPn || 0}
              centerLabel="Pasivo + PN"
              emptyLabel="La ecuación todavía no tiene peso."
              colors={{
                Pasivo: 'var(--primary-gold)',
                'Patrimonio + resultado': 'var(--emerald-accent)',
              }}
            />
          </article>
        </div>
      </section>

      <div className="er-flow" aria-label="Cascada de resultado">
        <div className="er-flow-row is-in">
          <span>Ingresos</span>
          <span className="er-flow-track"><i style={{ width: income ? '100%' : '0%' }} /></span>
          <strong>{formatCurrency(income)}</strong>
        </div>
        <div className="er-flow-row is-out">
          <span>Egresos</span>
          <span className="er-flow-track">
            <i style={{ width: `${expenseShare}%` }} />
          </span>
          <strong>{formatCurrency(expense)}</strong>
        </div>
        <div className={['er-flow-row', result >= 0 ? 'is-net' : 'is-out'].join(' ')}>
          <span>Resultado</span>
          <span className="er-flow-track">
            <i style={{ width: `${resultShare}%` }} />
          </span>
          <strong>{formatCurrency(result)}</strong>
        </div>
      </div>

      <div className="er-grid">
        <section className="er-block">
          <h4>De dónde entra</h4>
          <MixList rows={insights.incomeMix} total={insights.income} tone="in" onOpen={onOpenAccount} />
        </section>
        <section className="er-block">
          <h4>En qué se va</h4>
          {insights.expenseMix.length ? (
            <MixList rows={insights.expenseMix} total={insights.expense} tone="out" onOpen={onOpenAccount} />
          ) : (
            <p className="er-empty">
              No hay sueldos, mantenimiento ni hípica imputados. El margen queda entero hasta el primer egreso oficial.
            </p>
          )}
        </section>
        <section className="er-block">
          <h4>Origen del cobro</h4>
          <MixList rows={insights.sourceMix} total={insights.income} tone="gold" />
        </section>
      </div>

      <section className="er-block">
        <div className="er-block-head">
          <h4>Mes a mes</h4>
          <span>
            {insights.surplusMonths
              ? `${insights.surplusMonths} mes${insights.surplusMonths === 1 ? '' : 'es'} en superávit`
              : 'Sin meses con resultado'}
          </span>
        </div>
        {insights.series.length === 0 ? (
          <p className="er-empty">Cuando haya asientos, acá se ve el pulso del año.</p>
        ) : (
          <div className="er-months" role="img" aria-label="Ingresos y egresos por mes">
            {insights.series.map((row) => (
              <div key={row.month} className="er-month">
                <div className="er-month-bars">
                  <span
                    className="is-in"
                    style={{ height: `${maxMonth ? Math.max(4, (row.income / maxMonth) * 100) : 0}%` }}
                    title={`Ingresos ${formatCurrency(row.income)}`}
                  />
                  <span
                    className="is-out"
                    style={{ height: `${maxMonth ? Math.max(row.expense ? 4 : 0, (row.expense / maxMonth) * 100) : 0}%` }}
                    title={`Egresos ${formatCurrency(row.expense)}`}
                  />
                </div>
                <em>{row.label}</em>
                <strong className={row.result >= 0 ? 'is-net' : 'is-out'}>{formatCurrency(row.result)}</strong>
                <small>{formatCurrency(row.income)}</small>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="er-block">
        <div className="er-block-head">
          <h4>Ecuación patrimonial</h4>
          <span className={totals?.squared ? 'is-ok' : 'is-off'}>
            {totals?.squared ? 'Cuadrada' : `Descuadre ${formatCurrency(totals?.balanceDiff || 0)}`}
          </span>
        </div>
        <p className="er-note">
          Activo tiene que igualar pasivo más patrimonio neto, con el resultado del ejercicio ya sumado.
        </p>
        <div className="er-eq-grid">
          <div>
            <p className="er-eq-label">Activo</p>
            <strong className="er-eq-value">{formatCurrency(totals?.activos || 0)}</strong>
            <div className="acct-occ-track" aria-hidden="true">
              <span className="acct-occ-fill is-asset" style={{ width: `${totals?.activoBarPct || 0}%` }} />
            </div>
            <MixList
              rows={activos.map((row) => ({ label: row.name, amount: row.amount }))}
              total={totals?.activos || 0}
              tone="in"
              onOpen={onOpenAccount}
            />
          </div>
          <div>
            <p className="er-eq-label">Pasivo + patrimonio</p>
            <strong className="er-eq-value">{formatCurrency(totals?.pasivoPn || 0)}</strong>
            <div className="acct-occ-track" aria-hidden="true">
              <span className="acct-occ-fill is-equity" style={{ width: `${totals?.pasivoBarPct || 0}%` }} />
            </div>
            <ul className="er-mix">
              <li>
                <div className="er-mix-row is-gold">
                  <span className="er-mix-name">Pasivo</span>
                  <span className="er-mix-track" aria-hidden="true">
                    <i style={{ width: `${totals?.pasivoPn ? Math.max(2, ((totals.pasivos || 0) / totals.pasivoPn) * 100) : 0}%` }} />
                  </span>
                  <strong>{formatCurrency(totals?.pasivos || 0)}</strong>
                  <em>{pctLabel(totals?.pasivos || 0, totals?.pasivoPn || 0)}</em>
                </div>
              </li>
              <li>
                <div className="er-mix-row is-gold">
                  <span className="er-mix-name">Patrimonio + resultado</span>
                  <span className="er-mix-track" aria-hidden="true">
                    <i style={{ width: `${totals?.pasivoPn ? Math.max(2, ((totals.patrimonio || 0) / totals.pasivoPn) * 100) : 0}%` }} />
                  </span>
                  <strong>{formatCurrency(totals?.patrimonio || 0)}</strong>
                  <em>{pctLabel(totals?.patrimonio || 0, totals?.pasivoPn || 0)}</em>
                </div>
              </li>
            </ul>
          </div>
        </div>
      </section>

      <section className={['jd-day', openBook ? 'is-open' : ''].filter(Boolean).join(' ')}>
        <button
          type="button"
          className="jd-day-toggle"
          aria-expanded={openBook}
          onClick={() => setOpenBook((open) => !open)}
        >
          <span>
            Estado de resultados
            <em>{liveAccounts} cuentas con saldo</em>
          </span>
          <ChevronDown size={16} className="jd-day-chevron" aria-hidden="true" />
        </button>
        {openBook ? (
          <div className="jd-day-body">
            <div className="table-responsive">
              <table className="balance-table">
                <tbody>
                  <tr className="balance-row-category">
                    <td>Ingresos</td>
                    <td />
                    <td />
                  </tr>
                  {ingresos.map((row) => (
                    <tr key={row.name} className="balance-row-account">
                      <td>
                        <button type="button" className="mb-line-btn" onClick={() => onOpenAccount?.(row.name)}>
                          {row.name}
                        </button>
                      </td>
                      <td style={{ textAlign: 'right' }}>{formatCurrency(row.amount)}</td>
                      <td />
                    </tr>
                  ))}
                  <tr className="balance-row-subtotal">
                    <td>Total ingresos</td>
                    <td />
                    <td style={{ textAlign: 'right' }}>{formatCurrency(income)}</td>
                  </tr>
                  <tr className="balance-row-category">
                    <td>Egresos</td>
                    <td />
                    <td />
                  </tr>
                  {gastos.map((row) => (
                    <tr key={row.name} className="balance-row-account">
                      <td>
                        <button type="button" className="mb-line-btn" onClick={() => onOpenAccount?.(row.name)}>
                          {row.name}
                        </button>
                      </td>
                      <td style={{ textAlign: 'right' }}>{formatCurrency(row.amount)}</td>
                      <td />
                    </tr>
                  ))}
                  <tr className="balance-row-subtotal">
                    <td>Total egresos</td>
                    <td />
                    <td style={{ textAlign: 'right' }}>{formatCurrency(expense)}</td>
                  </tr>
                  <tr className="balance-row-total">
                    <td>{result >= 0 ? 'Superávit del ejercicio' : 'Déficit del ejercicio'}</td>
                    <td />
                    <td style={{ textAlign: 'right' }}>{formatCurrency(result)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
