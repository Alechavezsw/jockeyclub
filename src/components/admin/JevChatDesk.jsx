import { useEffect, useMemo, useRef, useState } from 'react';
import { askJevChat } from '../../data/jevChat';
import {
  composeInsight,
  formatGuideCount,
  formatGuideMoney,
  mergeJevReply,
  monthReading,
  openingBriefing,
} from '../../domain/assistant/clubGuide';
import { todayISODateAR } from '../../lib/arDate';

const STARTERS = [
  { id: 'mes', label: 'El mes', ask: 'Leé octubre: liquidado, recaudado y si llegamos al 10.' },
  { id: 'mirar', label: 'Qué conviene', ask: '¿Qué conviene mirar ahora en el club?' },
  { id: 'puerta', label: 'La puerta', ask: '¿Qué pasó hoy en portería y pileta?' },
  { id: 'usar', label: 'Enseñame', ask: 'Enseñame a cobrar, liquidar y usar la puerta.' },
  { id: 'manual', label: 'Manual', ask: null, room: 'manual' },
];

function slipTime(iso = new Date()) {
  return new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
}

function JevTile({ label, value, hint, meter }) {
  return (
    <div className="jev-tile">
      <span>{label}</span>
      <b className="tabular-nums">{value}</b>
      {hint ? <em>{hint}</em> : null}
      {meter != null ? (
        <i className="jev-tile-meter" aria-hidden="true">
          <i style={{ width: `${Math.max(0, Math.min(100, meter))}%` }} />
        </i>
      ) : null}
    </div>
  );
}

function JevSlip({ row, goToTab }) {
  return (
    <article className={`jev-slip is-${row.role}`}>
      <p className="jev-slip-meta">
        <span>{row.role === 'user' ? 'Consulta' : 'Dictamen'}</span>
        <time dateTime={row.at}>{slipTime(row.at)}</time>
        {row.source === 'gemini' ? <em>Jev</em> : row.role === 'assistant' ? <em>del libro</em> : null}
      </p>
      {row.verdict ? <h3 className="jev-slip-verdict">{row.verdict}</h3> : null}
      <p className="jev-slip-text">{row.text}</p>
      {row.figures?.length ? (
        <dl className="jev-slip-figures">
          {row.figures.map((item) => (
            <div key={`${item.label}-${item.value}`}>
              <dt>{item.label}</dt>
              <dd className="tabular-nums">{item.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {row.next ? <p className="jev-slip-next">{row.next}</p> : null}
      {row.go && typeof goToTab === 'function' ? (
        <button type="button" className="jev-slip-go" onClick={() => goToTab(row.go, row.focus || null)}>
          Ir a esa sección
        </button>
      ) : null}
    </article>
  );
}

export default function JevChatDesk({
  brief = {},
  goToTab,
  onOpenManual,
}) {
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [messages, setMessages] = useState(() => [
    {
      id: 'open',
      role: 'assistant',
      source: 'libro',
      at: new Date().toISOString(),
      ...openingBriefing({ ...brief, today: todayISODateAR() }),
    },
  ]);
  const scroller = useRef(null);
  const reading = useMemo(() => monthReading({ ...brief, today: brief.today || todayISODateAR() }), [brief]);
  const tiles = useMemo(() => ([
    {
      label: 'El mes',
      value: `${reading.pct}%`,
      hint: `${formatGuideMoney(reading.collected)} de ${formatGuideMoney(reading.liquidated)}`,
      meter: reading.pct,
    },
    {
      label: reading.due.phase === 'after' ? 'Venció' : 'Vence',
      value: reading.due.dueLabel,
      hint: reading.due.phase === 'before'
        ? `Faltan ${reading.due.daysUntil} días`
        : reading.due.phase === 'today'
          ? 'Es hoy'
          : `Hace ${reading.due.daysSince} días`,
    },
    {
      label: 'Padrón',
      value: brief.bien != null ? formatGuideCount(brief.bien) : '—',
      hint: brief.activos != null ? `${formatGuideCount(brief.activos)} activos` : 'Leyendo fichas',
    },
  ]), [brief.activos, brief.bien, reading]);

  useEffect(() => {
    const open = openingBriefing({ ...brief, today: brief.today || todayISODateAR() });
    setMessages((curr) => curr.map((row) => (
      row.id === 'open'
        ? { ...row, ...open, source: 'libro' }
        : row
    )));
  }, [brief.activos, brief.bien, brief.collected, brief.deudores, brief.fichas, brief.liquidated, brief.monthLabel, brief.today]);

  useEffect(() => {
    const node = scroller.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages, busy]);

  const send = async (raw) => {
    const text = String(raw || input).trim();
    if (!text || busy) return;
    setInput('');
    setError('');
    const userMsg = { id: `u-${Date.now()}`, role: 'user', at: new Date().toISOString(), text };
    setMessages((curr) => [...curr, userMsg]);
    setBusy(true);
    const history = [...messages, userMsg]
      .filter((row) => row.id !== 'open')
      .slice(-8)
      .map((row) => ({ role: row.role, content: row.text }));
    const local = composeInsight(text, { ...brief, today: brief.today || todayISODateAR() });
    try {
      const reply = await askJevChat({ messages: history, brief });
      const merged = mergeJevReply(local, reply);
      setMessages((curr) => [...curr, {
        id: `a-${Date.now()}`,
        role: 'assistant',
        at: new Date().toISOString(),
        ...merged,
      }]);
    } catch (err) {
      if (local?.text || local?.verdict) {
        setMessages((curr) => [...curr, {
          id: `a-${Date.now()}`,
          role: 'assistant',
          source: 'libro',
          at: new Date().toISOString(),
          ...local,
        }]);
      } else {
        setError(err?.message || 'Jev no pudo leer el libro.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="jev-desk" aria-label="Jev, consulta del club">
      <header className="jev-desk-plate">
        <div>
          <p className="jev-desk-kicker">Consulta</p>
          <h2 className="jev-desk-name">Jev</h2>
          <p className="jev-desk-sub">Lee el club entero. Dice qué falta. El Manual de al lado tiene cada oficio.</p>
        </div>
        <p className="jev-desk-live" aria-live="polite">
          <i />
          <span>En el libro</span>
        </p>
      </header>

      <div className="jev-desk-board" aria-label="Lectura en vivo">
        {tiles.map((tile) => (
          <JevTile key={tile.label} {...tile} />
        ))}
      </div>

      <div className="jev-desk-log" ref={scroller}>
        {messages.map((row) => (
          <JevSlip key={row.id} row={row} goToTab={goToTab} />
        ))}
        {busy ? <p className="jev-desk-wait">Jev está cruzando el libro…</p> : null}
      </div>

      <div className="jev-desk-starters">
        {STARTERS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              if (item.room === 'manual') {
                onOpenManual?.();
                return;
              }
              send(item.ask);
            }}
            disabled={busy && item.room !== 'manual'}
          >
            {item.label}
          </button>
        ))}
      </div>

      <form
        className="jev-desk-form"
        onSubmit={(event) => {
          event.preventDefault();
          void send(input);
        }}
      >
        <label className="jev-desk-field">
          <span>Consultá el libro</span>
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void send(input);
              }
            }}
            rows={2}
            placeholder="Número de socio, el mes, o cómo se hace algo"
            disabled={busy}
          />
        </label>
        <button type="submit" className="jev-desk-send" disabled={busy || !input.trim()}>
          Dictaminar
        </button>
      </form>
      {error ? <p className="jev-desk-error">{error}</p> : null}
    </section>
  );
}
