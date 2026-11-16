import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity,
  BarChart3,
  Clock3,
  Download,
  FileSpreadsheet,
  RefreshCw,
  Sparkles,
  Users,
  Wallet,
} from 'lucide-react';
import {
  buildMemberStatsBundle,
  memberStatsJevPrompt,
} from '../../domain/members/memberStats';
import {
  exportMemberStatsExcel,
  exportMemberStatsPdf,
} from '../../domain/members/exportMemberStats';
import { todayISODateAR } from '../../lib/arDate';

const ENTRY_WINDOWS = [
  { id: 7, label: '7 días' },
  { id: 30, label: '30 días' },
  { id: 90, label: '90 días' },
];

function formatMoney(n) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 0,
  }).format(Number(n) || 0);
}

function formatCount(n) {
  return Number(n || 0).toLocaleString('es-AR');
}

function AgeBars({ buckets = [], max = 1 }) {
  const peak = Math.max(1, max, ...buckets.map((b) => b.count || 0));
  return (
    <div className="ms-stats__bars" role="img" aria-label="Distribución por rango etario">
      {buckets.map((b, i) => {
        const pct = Math.max(2, Math.round(((b.count || 0) / peak) * 100));
        return (
          <div key={b.id} className="ms-stats__bar-row">
            <span className="ms-stats__bar-label">{b.label}</span>
            <div className="ms-stats__bar-track">
              <div
                className="ms-stats__bar-fill"
                style={{
                  width: `${pct}%`,
                  background: `linear-gradient(90deg, hsl(${158 - i * 6} 42% ${28 + i}%), hsl(${158 - i * 6} 48% ${38 + i}%))`,
                }}
              />
            </div>
            <strong className="ms-stats__bar-n tabular-nums">{formatCount(b.count)}</strong>
          </div>
        );
      })}
    </div>
  );
}

function HourSpark({ hours = [] }) {
  const max = Math.max(1, ...hours.map((h) => h.count || 0));
  const w = 560;
  const h = 160;
  const pad = 18;
  const usable = hours.filter((row) => row.hour >= 6 && row.hour <= 22);
  const step = (w - pad * 2) / Math.max(1, usable.length - 1);
  const points = usable.map((row, i) => {
    const x = pad + i * step;
    const y = h - pad - ((row.count || 0) / max) * (h - pad * 2);
    return `${x},${y}`;
  });
  const area = `${pad},${h - pad} ${points.join(' ')} ${pad + (usable.length - 1) * step},${h - pad}`;
  return (
    <svg className="ms-stats__spark" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Ingresos por hora">
      <defs>
        <linearGradient id="msHourFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(224, 165, 38, 0.45)" />
          <stop offset="100%" stopColor="rgba(224, 165, 38, 0)" />
        </linearGradient>
      </defs>
      <polygon points={area} fill="url(#msHourFill)" />
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke="#E0A526"
        strokeWidth="2.4"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {usable.map((row, i) => {
        if ((row.count || 0) <= 0) return null;
        const x = pad + i * step;
        const y = h - pad - ((row.count || 0) / max) * (h - pad * 2);
        return <circle key={row.hour} cx={x} cy={y} r="3.2" fill="#096755" stroke="#F5E6B4" strokeWidth="1.2" />;
      })}
      {usable.filter((_, i) => i % 2 === 0).map((row, i) => {
        const idx = i * 2;
        const x = pad + idx * step;
        return (
          <text key={`t-${row.hour}`} x={x} y={h - 4} textAnchor="middle" fontSize="9" fill="currentColor" opacity="0.55">
            {String(row.hour).padStart(2, '0')}
          </text>
        );
      })}
    </svg>
  );
}

function PayColumns({ series = [] }) {
  const max = Math.max(1, ...series.map((m) => m.amount || 0));
  const w = 560;
  const h = 170;
  const pad = 20;
  const gap = 10;
  const barW = Math.max(18, (w - pad * 2 - gap * (series.length - 1)) / Math.max(1, series.length));
  return (
    <svg className="ms-stats__spark" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Pagos por mes">
      {series.map((m, i) => {
        const bh = ((m.amount || 0) / max) * (h - pad * 2);
        const x = pad + i * (barW + gap);
        const y = h - pad - bh;
        return (
          <g key={m.key}>
            <rect
              x={x}
              y={y}
              width={barW}
              height={Math.max(2, bh)}
              rx="6"
              fill={i === series.length - 1 ? '#E0A526' : '#0B8B6C'}
              opacity={0.92}
            />
            <text x={x + barW / 2} y={h - 5} textAnchor="middle" fontSize="9" fill="currentColor" opacity="0.6">
              {String(m.label || '').replace(/\s+\d{4}$/, '')}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/**
 * Escritorio Estadísticas bajo Socios: edades, horarios, pagos — en vivo + PDF/Excel + JEV.
 */
export default function MembersStatsPanel({
  members = [],
  membersLoading = false,
  entryLogs = [],
  formatCurrency = formatMoney,
}) {
  const navigate = useNavigate();
  const [entryDays, setEntryDays] = useState(30);
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState('');
  const [flash, setFlash] = useState('');

  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const bundle = useMemo(
    () => buildMemberStatsBundle(members, entryLogs, {
      entryDays,
      today: todayISODateAR(),
    }),
    [members, entryLogs, entryDays, tick],
  );

  const ages = bundle.ages;
  const entries = bundle.entries;
  const payments = bundle.payments;
  const clock = useMemo(() => new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }), [tick, bundle.generatedAt]);

  async function runExport(kind) {
    setBusy(kind);
    setFlash('');
    try {
      if (kind === 'pdf') await exportMemberStatsPdf(bundle);
      else await exportMemberStatsExcel(bundle);
      setFlash(kind === 'pdf' ? 'PDF listo.' : 'Excel listo.');
    } catch (err) {
      setFlash(err?.message || 'No se pudo exportar.');
    } finally {
      setBusy('');
    }
  }

  function openJev() {
    try {
      sessionStorage.setItem('jockey-jev-draft', memberStatsJevPrompt(bundle));
    } catch {
      /* ignore */
    }
    navigate('/panel/jev');
  }

  return (
    <div className="ms-stats fade-in">
      <header className="ms-stats__hero">
        <div className="ms-stats__hero-copy">
          <p className="ms-stats__eyebrow">Socios · en vivo</p>
          <h2 className="ms-stats__title">Estadísticas del padrón</h2>
          <p className="ms-stats__lead">
            Edades, rangos etarios, horarios de ingreso y pagos — recalculados del padrón y los molinetes.
            Actualizado {clock}.
          </p>
        </div>
        <div className="ms-stats__hero-actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setTick((n) => n + 1)}>
            <RefreshCw size={14} /> Actualizar
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={Boolean(busy)}
            onClick={() => runExport('excel')}
          >
            <FileSpreadsheet size={14} /> {busy === 'excel' ? 'Excel…' : 'Excel'}
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={Boolean(busy)}
            onClick={() => runExport('pdf')}
          >
            <Download size={14} /> {busy === 'pdf' ? 'PDF…' : 'PDF'}
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={openJev}>
            <Sparkles size={14} /> Preguntar a JEV
          </button>
        </div>
      </header>

      {flash ? <p className="ms-stats__flash" role="status">{flash}</p> : null}
      {membersLoading ? (
        <p className="ms-stats__loading" role="status">Cargando padrón…</p>
      ) : null}

      <div className="ms-stats__kpis">
        <article className="ms-stats__kpi">
          <Users size={16} aria-hidden />
          <span>Activos</span>
          <strong className="tabular-nums">{formatCount(ages.activos)}</strong>
        </article>
        <article className="ms-stats__kpi">
          <BarChart3 size={16} aria-hidden />
          <span>Con edad</span>
          <strong className="tabular-nums">{formatCount(ages.withAge)}</strong>
          <em>sin edad {formatCount(ages.sinEdad)}</em>
        </article>
        <article className="ms-stats__kpi">
          <Activity size={16} aria-hidden />
          <span>Edad media</span>
          <strong className="tabular-nums">{ages.averageAge ?? '—'}</strong>
          <em>mediana {ages.medianAge ?? '—'}</em>
        </article>
        <article className="ms-stats__kpi">
          <Clock3 size={16} aria-hidden />
          <span>Ingresos {entryDays}d</span>
          <strong className="tabular-nums">{formatCount(entries.total)}</strong>
          <em>pico {entries.peakHour?.label || '—'}</em>
        </article>
        <article className="ms-stats__kpi">
          <Wallet size={16} aria-hidden />
          <span>Con deuda</span>
          <strong className="tabular-nums">{formatCount(payments.withDebt)}</strong>
          <em>{formatCurrency(payments.debtAmount)}</em>
        </article>
      </div>

      <div className="ms-stats__grid">
        <section className="ms-stats__card ms-stats__card--ages">
          <div className="ms-stats__card-head">
            <h3>Rangos etarios</h3>
            <p>Misma partición del informe integral · 4+ = {formatCount(ages.census4plus)}</p>
          </div>
          <AgeBars buckets={ages.buckets} />
        </section>

        <section className="ms-stats__card">
          <div className="ms-stats__card-head">
            <h3>Horarios de ingreso</h3>
            <div className="ms-stats__seg" role="group" aria-label="Ventana de ingresos">
              {ENTRY_WINDOWS.map((w) => (
                <button
                  key={w.id}
                  type="button"
                  className={entryDays === w.id ? 'is-on' : undefined}
                  onClick={() => setEntryDays(w.id)}
                >
                  {w.label}
                </button>
              ))}
            </div>
          </div>
          <HourSpark hours={entries.hours} />
          <p className="ms-stats__note">
            OK {formatCount(entries.granted)} · denegados {formatCount(entries.denied)}
            {entries.peakHour ? ` · hora pico ${entries.peakHour.label}` : ''}
          </p>
        </section>

        <section className="ms-stats__card">
          <div className="ms-stats__card-head">
            <h3>Pagos (historial de fichas)</h3>
            <p>{formatCount(payments.payments)} cobros · {formatCurrency(payments.amount)}</p>
          </div>
          <PayColumns series={payments.monthSeries} />
          <ul className="ms-stats__methods">
            {(payments.methods || []).slice(0, 5).map((m) => (
              <li key={m.id}>
                <span>{m.label}</span>
                <strong className="tabular-nums">{formatCurrency(m.amount)}</strong>
              </li>
            ))}
          </ul>
        </section>

        <section className="ms-stats__card ms-stats__card--cats">
          <div className="ms-stats__card-head">
            <h3>Categorías del padrón</h3>
            <p>Titulares y grupo familiar vivos</p>
          </div>
          <div className="ms-stats__cats">
            {(bundle.categories || []).slice(0, 10).map((c) => (
              <div key={c.label} className="ms-stats__cat">
                <strong>{c.label}</strong>
                <span className="tabular-nums">{formatCount(c.count)}</span>
                <em>{formatCount(c.withAge)} con edad · {formatCount(c.sinEdad)} sin</em>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
