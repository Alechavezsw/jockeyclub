import { useId, useMemo } from 'react';
import {
  formatGuideCount,
  formatGuideMoney,
} from '../../domain/assistant/clubGuide';
import { buildJevForecasts } from '../../domain/assistant/jevForecasts';

function compactMoney(value) {
  const n = Number(value) || 0;
  if (n >= 1_000_000) {
    const millions = n / 1_000_000;
    return `${millions >= 10 ? Math.round(millions) : millions.toFixed(1).replace(/\.0$/, '')} M`;
  }
  if (n >= 1000) return `${Math.round(n / 1000)} mil`;
  return String(Math.round(n));
}

function lanePath(rows, xOf, yOf) {
  return rows.map((row) => `${xOf(row)},${yOf(row.value)}`).join(' ');
}

function CastLane({
  points = [],
  xOf,
  maxValue,
  goal,
  markers = [],
  ticks = [],
  now,
  ariaLabel,
  tone = 'dues',
}) {
  const uid = useId();
  const width = 360;
  const height = 176;
  const pad = { l: 10, r: 36, t: 22, b: 24 };
  const innerW = width - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;
  const max = Math.max(maxValue || 0, ...points.map((row) => row.value), 1);
  const yOf = (value) => pad.t + innerH - (value / max) * innerH;
  const actual = points.filter((row) => row.kind === 'actual');
  const forecast = [
    actual.at(-1),
    ...points.filter((row) => row.kind === 'forecast'),
  ].filter(Boolean);
  const actualPts = lanePath(actual, xOf, yOf);
  const forecastPts = lanePath(forecast, xOf, yOf);
  const rails = [0.25, 0.5, 0.75, 1];

  return (
    <figure className={`jev-cast-lane is-${tone}`}>
      <svg className="jev-cast-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel}>
        <defs>
          <linearGradient id={`${uid}-live`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#096755" stopOpacity="0.38" />
            <stop offset="100%" stopColor="#096755" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={`${uid}-cast`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#CA390C" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#CA390C" stopOpacity="0" />
          </linearGradient>
          <filter id={`${uid}-glow`} x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="2.2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {rails.map((pct) => (
          <line
            key={pct}
            className="jev-cast-rail"
            x1={pad.l}
            y1={yOf(max * pct)}
            x2={width - pad.r}
            y2={yOf(max * pct)}
          />
        ))}
        {goal != null ? (
          <>
            <line className="jev-cast-grid" x1={pad.l} y1={yOf(goal.value)} x2={width - pad.r} y2={yOf(goal.value)} />
            <text className="jev-cast-goal-lbl" x={width - pad.r + 4} y={yOf(goal.value) + 3}>{goal.label}</text>
          </>
        ) : null}
        {markers.map((mark) => (
          <g key={mark.id} className="jev-cast-flag" transform={`translate(${mark.x}, 0)`}>
            <rect className="jev-cast-flag-wash" x="-7" y={pad.t} width="14" height={innerH} />
            <line className="jev-cast-due" x1="0" y1={pad.t} x2="0" y2={height - pad.b} />
            <path className="jev-cast-flag-band" d="M0 6 L30 6 L30 20 L0 20 Z" />
            <text className="jev-cast-flag-txt" x="15" y="16" textAnchor="middle">{mark.label}</text>
          </g>
        ))}
        {actual.length > 1 ? (
          <polygon
            className="jev-cast-wash"
            fill={`url(#${uid}-live)`}
            points={`${actualPts} ${xOf(actual.at(-1))},${yOf(0)} ${xOf(actual[0])},${yOf(0)}`}
          />
        ) : null}
        {forecast.length > 1 ? (
          <polygon
            className="jev-cast-wash"
            fill={`url(#${uid}-cast)`}
            points={`${forecastPts} ${xOf(forecast.at(-1))},${yOf(0)} ${xOf(forecast[0])},${yOf(0)}`}
          />
        ) : null}
        {actual.length > 1 ? <polyline className="jev-cast-actual" points={actualPts} /> : null}
        {forecast.length > 1 ? <polyline className="jev-cast-forecast" points={forecastPts} /> : null}
        {now ? (
          <g filter={`url(#${uid}-glow)`}>
            <circle className="jev-cast-now-ring" cx={now.x} cy={yOf(now.value)} r="8" />
            <circle className="jev-cast-now" cx={now.x} cy={yOf(now.value)} r="4.2" />
            {now.caption ? (
              <text className="jev-cast-hint" x={now.x + 8} y={yOf(now.value) - 8}>{now.caption}</text>
            ) : null}
          </g>
        ) : null}
        {ticks.map((tick) => (
          <text
            key={tick.id}
            className="jev-cast-axis"
            x={tick.x}
            y={height - 6}
            textAnchor={tick.anchor || 'middle'}
          >
            {tick.label}
          </text>
        ))}
      </svg>
    </figure>
  );
}

function HorizonChart({ horizon }) {
  const width = 360;
  const pad = { l: 10, r: 36 };
  const innerW = width - pad.l - pad.r;
  const x = (day) => pad.l + ((day - 1) / Math.max(1, horizon.lastDay - 1)) * innerW;
  const xOf = (row) => x(row.day);
  const lastActual = horizon.points.filter((row) => row.kind === 'actual').at(-1);
  const due = horizon.points.find((row) => row.day === horizon.dueDay);

  return (
    <CastLane
      tone="dues"
      points={horizon.points}
      xOf={xOf}
      maxValue={horizon.liquidated}
      goal={horizon.liquidated > 0 ? { value: horizon.liquidated, label: 'liq.' } : null}
      markers={[{ id: 'due', x: x(horizon.dueDay), label: 'el 10' }]}
      ticks={[
        { id: 'start', x: pad.l, label: '1', anchor: 'start' },
        { id: 'due', x: x(horizon.dueDay), label: String(horizon.dueDay) },
        { id: 'end', x: width - pad.r, label: String(horizon.lastDay), anchor: 'end' },
      ]}
      now={lastActual ? {
        x: x(lastActual.day),
        value: lastActual.value,
        caption: `hoy ${compactMoney(lastActual.value)}`,
      } : null}
      ariaLabel={`${horizon.verdict} Al 10: ${compactMoney(due?.value || horizon.forecastDue)}.`}
    />
  );
}

function PoolChart({ pool }) {
  const width = 360;
  const pad = { l: 10, r: 36 };
  const innerW = width - pad.l - pad.r;
  const last = Math.max(1, pool.points.length - 1);
  const x = (index) => pad.l + (index / last) * innerW;
  const xOf = (row) => x(Math.max(0, pool.points.indexOf(row)));
  const lastActual = pool.points.filter((row) => row.kind === 'actual').at(-1);
  const monthTicks = pool.months.map((month, index) => ({
    id: month.key,
    x: x(Math.round((index / Math.max(1, pool.months.length - 1)) * last)),
    label: month.label,
    anchor: index === 0 ? 'start' : (index === pool.months.length - 1 ? 'end' : 'middle'),
  }));

  return (
    <CastLane
      tone="pool"
      points={pool.points}
      xOf={xOf}
      maxValue={Math.max(pool.forecastVisits, pool.visitsPrev, 1)}
      goal={pool.forecastVisits > 0 ? { value: pool.forecastVisits, label: 'cierre' } : null}
      markers={[
        { id: 'open', x: x(0), label: 'abre' },
        { id: 'close', x: x(last), label: 'cierra' },
      ]}
      ticks={monthTicks}
      now={lastActual ? {
        x: xOf(lastActual),
        value: lastActual.value,
        caption: `${lastActual.value} pases`,
      } : null}
      ariaLabel={pool.verdict}
    />
  );
}

function SeasonMonths({ months }) {
  const max = Math.max(1, ...months.flatMap((row) => [row.visits, row.prevVisits]));
  return (
    <div className="jev-cast-season" role="img" aria-label="Pases por mes de la temporada">
      {months.map((row) => (
        <div key={row.key} className="jev-cast-season-col">
          <div className="jev-cast-season-stack">
            {row.prevVisits > 0 ? (
              <i className="is-prev" style={{ height: `${(row.prevVisits / max) * 100}%` }} />
            ) : null}
            <i className="is-now" style={{ height: `${(Math.max(row.visits, 0.04) / max) * 100}%` }} />
          </div>
          <span>{row.label}</span>
        </div>
      ))}
    </div>
  );
}

function WeekBars({ week }) {
  const max = Math.max(1, ...week.days.flatMap((row) => [row.door, row.bookings, row.pool]), week.next.door);
  return (
    <div className="jev-cast-bars" role="img" aria-label="Puerta, reservas y pileta de los últimos siete días">
      {week.days.map((row) => (
        <div key={row.date} className="jev-cast-col">
          <div className="jev-cast-stack">
            <i style={{ height: `${(row.door / max) * 100}%` }} className="is-door" />
            <i style={{ height: `${(row.bookings / max) * 100}%` }} className="is-book" />
            <i style={{ height: `${(row.pool / max) * 100}%` }} className="is-pool" />
          </div>
          <span>{row.label}</span>
        </div>
      ))}
      <div className="jev-cast-col is-next">
        <div className="jev-cast-stack">
          <i style={{ height: `${(week.next.door / max) * 100}%` }} className="is-door" />
          <i style={{ height: `${(week.next.bookings / max) * 100}%` }} className="is-book" />
          <i style={{ height: `${(week.next.pool / max) * 100}%` }} className="is-pool" />
        </div>
        <span>próx.</span>
      </div>
    </div>
  );
}

function MixChart({ padron }) {
  const total = Math.max(1, padron.slices.reduce((sum, row) => sum + row.value, 0));
  let offset = 0;
  return (
    <div className="jev-cast-mix">
      <svg viewBox="0 0 36 36" className="jev-cast-donut" aria-hidden="true">
        {padron.slices.map((slice) => {
          const pct = (slice.value / total) * 100;
          const dash = `${pct} ${100 - pct}`;
          const circle = (
            <circle
              key={slice.id}
              className={`jev-cast-arc is-${slice.tone}`}
              r="15.9"
              cx="18"
              cy="18"
              pathLength="100"
              strokeDasharray={dash}
              strokeDashoffset={-offset}
            />
          );
          offset += pct;
          return circle;
        })}
      </svg>
      <ul>
        {padron.slices.map((slice) => (
          <li key={slice.id}>
            <i className={`is-${slice.tone}`} />
            <span>{slice.label}</span>
            <b className="tabular-nums">{formatGuideCount(slice.value)}</b>
          </li>
        ))}
        <li>
          <i className="is-debt" />
          <span>Con saldo</span>
          <b className="tabular-nums">{formatGuideCount(padron.deudores)}</b>
        </li>
      </ul>
    </div>
  );
}

function HistoryBars({ bars }) {
  const max = Math.max(1, ...bars.map((row) => row.value));
  return (
    <div className="jev-cast-history" role="img" aria-label="Liquidado de los últimos meses">
      {bars.map((row) => (
        <div key={row.key} className={`jev-cast-hist${row.current ? ' is-now' : ''}`}>
          <i style={{ height: `${(row.value / max) * 100}%` }} />
          <span>{row.label}</span>
        </div>
      ))}
    </div>
  );
}

export default function JevForecastRoom({
  brief = {},
  cashMovements = [],
  feePeriods = [],
  reservations = [],
  entryLogs = [],
  poolAccesses = [],
  poolSettings = {},
  goToTab,
}) {
  const forecast = useMemo(() => buildJevForecasts({
    today: brief.today,
    collected: brief.collected,
    liquidated: brief.liquidated,
    cashMovements,
    feePeriods,
    reservations,
    entryLogs,
    poolAccesses,
    poolSettings,
    activos: brief.activos,
    bien: brief.bien,
    fichas: brief.fichas,
    deudores: brief.deudores,
  }), [brief, cashMovements, feePeriods, reservations, entryLogs, poolAccesses, poolSettings]);

  const { horizon, door, padron, liquidations, pool } = forecast;
  const poolCall = pool.live ? formatGuideCount(pool.forecastVisits) : formatGuideCount(pool.daysUntilOpen);

  return (
    <section className="jev-cast" aria-label="Predicciones de Jev">
      <header className="jev-cast-hero">
        <div>
          <p className="jev-desk-kicker">Predicciones</p>
          <h2 className="jev-desk-name">El 10</h2>
          <p className="jev-desk-sub">{horizon.verdict}</p>
        </div>
        <p className="jev-cast-call tabular-nums">{horizon.pctDue}%</p>
      </header>

      <div className="jev-cast-board">
        <article className="jev-cast-card is-wide is-split">
          <div>
            <header>
              <p>Recaudación del mes</p>
              <b>La calle llena es lo cobrado. La punteada corre hasta el 10 y el 31.</b>
            </header>
            <HorizonChart horizon={horizon} />
          </div>
          <div className="jev-cast-side">
            <dl>
              <div>
                <dt>Hoy</dt>
                <dd className="tabular-nums">{formatGuideMoney(horizon.collected)}</dd>
              </div>
              <div>
                <dt>Al 10</dt>
                <dd className="tabular-nums">{formatGuideMoney(horizon.forecastDue)}</dd>
              </div>
              <div>
                <dt>Al 31</dt>
                <dd className="tabular-nums">{formatGuideMoney(horizon.forecastMonth)}</dd>
              </div>
              <div>
                <dt>Ritmo / día</dt>
                <dd className="tabular-nums">{formatGuideMoney(horizon.pace)}</dd>
              </div>
            </dl>
            {typeof goToTab === 'function' ? (
              <button type="button" className="jev-slip-go" onClick={() => goToTab('dues')}>
                Ir a Cuotas
              </button>
            ) : null}
          </div>
        </article>

        <article className="jev-cast-card is-wide is-split is-pool">
          <div>
            <header>
              <p>Temporada de pileta</p>
              <b>{pool.verdict}</b>
            </header>
            <PoolChart pool={pool} />
            <SeasonMonths months={pool.months} />
            <ul className="jev-cast-legend">
              <li><i className="is-pool" /> Temporada pasada</li>
              <li><i className="is-door" /> Esta ronda</li>
            </ul>
          </div>
          <div className="jev-cast-side">
            <p className="jev-cast-pool-call tabular-nums" aria-hidden="true">{poolCall}</p>
            <p className="jev-cast-pool-note">{pool.live ? 'pases al cierre' : 'días para abrir'}</p>
            <dl>
              <div>
                <dt>Abre</dt>
                <dd>1 dic</dd>
              </div>
              <div>
                <dt>Cierra</dt>
                <dd>31 mar</dd>
              </div>
              <div>
                <dt>Socio</dt>
                <dd className="tabular-nums">{formatGuideMoney(pool.memberFee)}</dd>
              </div>
              <div>
                <dt>Invitado</dt>
                <dd className="tabular-nums">{formatGuideMoney(pool.guestFee)}</dd>
              </div>
              <div>
                <dt>Pases est.</dt>
                <dd className="tabular-nums">{formatGuideCount(pool.forecastVisits)}</dd>
              </div>
              <div>
                <dt>Canon est.</dt>
                <dd className="tabular-nums">{formatGuideMoney(pool.forecastCanon)}</dd>
              </div>
            </dl>
            {typeof goToTab === 'function' ? (
              <button type="button" className="jev-slip-go" onClick={() => goToTab('pool')}>
                Ir a Pileta
              </button>
            ) : null}
          </div>
        </article>

        <article className="jev-cast-card">
          <header>
            <p>Puerta de la semana</p>
            <b>Siete días reales y el promedio para la próxima.</b>
          </header>
          <WeekBars week={door} />
          <ul className="jev-cast-legend">
            <li><i className="is-door" /> Portería</li>
            <li><i className="is-book" /> Reservas</li>
            <li><i className="is-pool" /> Pileta</li>
          </ul>
        </article>

        <article className="jev-cast-card">
          <header>
            <p>Padrón</p>
            <b>{padron.okPct} de cada 100 fichas activas están en orden.</b>
          </header>
          <MixChart padron={padron} />
        </article>

        <article className="jev-cast-card is-wide">
          <header>
            <p>Liquidado reciente</p>
            <b>Meses ya cerrados en el libro. Octubre es el que se está cobrando.</b>
          </header>
          <HistoryBars bars={liquidations} />
        </article>
      </div>
    </section>
  );
}
