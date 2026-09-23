import { useMemo, useState } from 'react';
import {
  PartyPopper, Search, UserCheck, Banknote, QrCode, UserPlus,
  CheckCircle2, AlertTriangle, X, Trash2, Plus,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { formatCurrency } from '../../domain/accounting/journal';
import {
  countRegistrations,
  evaluateEventRegistration,
  buildEventMpPayload,
  listEventRegistrations,
  guestEventRegistrationsForHost,
  buildEventDashboard,
  EVENT_CATEGORY_LABELS,
  DEFAULT_EVENT_SETTINGS,
} from '../../domain/events/clubEvents';

const CATEGORY_TONE = {
  fiesta: 'var(--primary-gold)',
  deportes: 'var(--emerald-accent)',
  institucional: '#3b82f6',
  hipica: '#d97706',
};

function compactArs(amount) {
  const n = Number(amount) || 0;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1).replace('.', ',')} M`;
  if (n >= 1000) return `$${Math.round(n / 1000)} mil`;
  return formatCurrency(n);
}

function EventOccupancyChart({ rows, selectedId, onSelect }) {
  return (
    <article className="events-chart-card">
      <h3>Cupo por evento</h3>
      <p className="events-chart-hint">Tocá una barra para operar ese evento.</p>
      {rows.length === 0 ? (
        <p className="ops-muted">Todavía no hay eventos publicados.</p>
      ) : (
        <ul className="events-occ-list">
          {rows.map((row) => {
            const pct = row.occupancyPct ?? 0;
            const tone = CATEGORY_TONE[row.category] || 'var(--primary-gold)';
            const label = EVENT_CATEGORY_LABELS[row.category] || row.category;
            return (
              <li key={row.id}>
                <button
                  type="button"
                  className={`events-occ-row${selectedId === row.id ? ' is-active' : ''}`}
                  onClick={() => onSelect(row.id)}
                >
                  <span className="events-occ-meta">
                    <strong>{row.title}</strong>
                    <span>
                      {label}
                      {' · '}
                      {row.used}
                      {row.capacity != null ? ` / ${row.capacity}` : ' sin tope'}
                      {row.occupancyPct != null ? ` · ${row.occupancyPct}%` : ''}
                    </span>
                  </span>
                  <span
                    className="events-occ-track"
                    role="meter"
                    aria-label={`Cupo de ${row.title}`}
                    aria-valuemin={0}
                    aria-valuemax={row.capacity || row.used || 0}
                    aria-valuenow={row.used}
                  >
                    <span
                      className="events-occ-fill"
                      style={{
                        width: `${row.capacity != null ? Math.max(pct, row.used > 0 ? 6 : 0) : Math.min(100, row.used * 8)}%`,
                        background: tone,
                      }}
                    />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </article>
  );
}

function EventMixChart({ mix }) {
  const empty = mix.total === 0;
  const memberDeg = empty ? 0 : (mix.members / mix.total) * 360;
  return (
    <article className="events-chart-card">
      <h3>Quién entra</h3>
      <p className="events-chart-hint">Socios titulares e invitados habilitados.</p>
      <div className="events-mix">
        <div
          className="events-mix-donut"
          style={{
            background: empty
              ? 'conic-gradient(var(--border-glass) 0deg 360deg)'
              : `conic-gradient(var(--primary-gold) 0deg ${memberDeg}deg, var(--emerald-accent) ${memberDeg}deg 360deg)`,
          }}
          aria-hidden="true"
        >
          <div className="events-mix-hole">
            <b>{mix.total}</b>
            <span>personas</span>
          </div>
        </div>
        <ul className="events-mix-legend">
          <li>
            <i style={{ background: 'var(--primary-gold)' }} />
            Socios
            <strong>{mix.members}{mix.total ? ` · ${mix.memberPct}%` : ''}</strong>
          </li>
          <li>
            <i style={{ background: 'var(--emerald-accent)' }} />
            Invitados
            <strong>{mix.guests}{mix.total ? ` · ${mix.guestPct}%` : ''}</strong>
          </li>
        </ul>
      </div>
    </article>
  );
}

function EventMoneyChart({ rows, payments, paidTotal, maxCollected }) {
  const max = Math.max(maxCollected, 1);
  const cashPct = paidTotal ? (payments.efectivo / paidTotal) * 100 : 0;
  const mpPct = paidTotal ? (payments.mercadopago / paidTotal) * 100 : 0;
  return (
    <article className="events-chart-card">
      <h3>Recaudación</h3>
      <p className="events-chart-hint">Entradas cobradas por evento y medio de pago.</p>
      <div className="events-money-cols" role="img" aria-label="Recaudación por evento">
        {rows.map((row) => {
          const h = Math.round((row.collected / max) * 92);
          const tone = CATEGORY_TONE[row.category] || 'var(--primary-gold)';
          return (
            <div key={row.id} className="events-money-col">
              <span className="events-money-val">{row.collected > 0 ? compactArs(row.collected) : '—'}</span>
              <span className="events-money-bar-wrap">
                <span
                  className="events-money-bar"
                  style={{ height: `${Math.max(h, row.collected > 0 ? 8 : 2)}px`, background: row.collected > 0 ? tone : 'var(--border-glass)' }}
                />
              </span>
              <span className="events-money-label">{row.title}</span>
            </div>
          );
        })}
      </div>
      <div className="events-pay-split">
        <div className="events-pay-track" aria-hidden="true">
          {paidTotal > 0 ? (
            <>
              <span style={{ width: `${cashPct}%`, background: 'var(--primary-gold)' }} />
              <span style={{ width: `${mpPct}%`, background: 'var(--emerald-accent)' }} />
            </>
          ) : (
            <span style={{ width: '100%', background: 'var(--border-glass)' }} />
          )}
        </div>
        <ul className="events-mix-legend">
          <li>
            <i style={{ background: 'var(--primary-gold)' }} />
            Efectivo
            <strong>{paidTotal ? compactArs(payments.efectivo) : '—'}</strong>
          </li>
          <li>
            <i style={{ background: 'var(--emerald-accent)' }} />
            Mercado Pago
            <strong>{paidTotal ? compactArs(payments.mercadopago) : '—'}</strong>
          </li>
        </ul>
      </div>
    </article>
  );
}

/**
 * Fiestas / eventos: misma lógica operativa que pileta
 * (socio → cobro efectivo/MP → invitados), sin revisación médica.
 */
export default function ClubEventsPanel({
  clubEvents = [],
  eventRegistrations = [],
  members = [],
  addClubEvent,
  registerMemberToEvent,
  revokeEventRegistration,
}) {
  const [selectedEventId, setSelectedEventId] = useState(clubEvents[0]?.id || '');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [payMethod, setPayMethod] = useState('efectivo');
  const [guestName, setGuestName] = useState('');
  const [guestMethod, setGuestMethod] = useState('efectivo');
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState('');
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    title: '',
    category: 'fiesta',
    description: '',
    location: 'Sede Rivadavia',
    startsAt: new Date(Date.now() + 86400000 * 7).toISOString().slice(0, 16),
    capacity: '100',
    ticketPrice: '0',
  });

  const selectedEvent = useMemo(
    () => clubEvents.find((e) => e.id === selectedEventId) || clubEvents[0] || null,
    [clubEvents, selectedEventId]
  );

  const selected = useMemo(
    () => members.find((m) => m.memberId === selectedId) || null,
    [members, selectedId]
  );

  const dash = useMemo(
    () => buildEventDashboard(clubEvents, eventRegistrations),
    [clubEvents, eventRegistrations]
  );
  const stats = dash.ops;
  const selectedRow = useMemo(
    () => dash.byEvent.find((row) => row.id === selectedEvent?.id) || null,
    [dash.byEvent, selectedEvent]
  );

  const searchHits = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return members
      .filter((m) => {
        const blob = `${m.name || ''} ${m.memberId || ''} ${m.documentNumber || ''}`.toLowerCase();
        return blob.includes(q);
      })
      .slice(0, 8);
  }, [members, query]);

  const eval_ = useMemo(
    () => evaluateEventRegistration(selected, selectedEvent, {
      registrations: eventRegistrations,
      maxGuests: DEFAULT_EVENT_SETTINGS.maxGuestsPerMember,
    }),
    [selected, selectedEvent, eventRegistrations]
  );

  const dayList = useMemo(
    () => (selectedEvent ? listEventRegistrations(eventRegistrations, selectedEvent.id) : []),
    [eventRegistrations, selectedEvent]
  );

  const hostGuests = selected && selectedEvent
    ? guestEventRegistrationsForHost(eventRegistrations, selectedEvent.id, selected.memberId)
    : [];

  const ticket = Number(selectedEvent?.ticketPrice) || 0;

  const mpPayload = useMemo(() => {
    if (!selected || !selectedEvent) return '';
    return buildEventMpPayload({
      amount: ticket,
      memberId: selected.memberId,
      memberName: selected.name,
      eventTitle: selectedEvent.title,
    });
  }, [selected, selectedEvent, ticket]);

  const guestMpPayload = useMemo(() => {
    if (!selected || !selectedEvent || !guestName.trim()) return '';
    return buildEventMpPayload({
      amount: ticket,
      memberId: selected.memberId,
      memberName: `${guestName} / ${selected.name}`,
      eventTitle: selectedEvent.title,
    });
  }, [selected, selectedEvent, guestName, ticket]);

  const showFlash = (msg) => {
    setFlash(msg);
    setTimeout(() => setFlash(''), 3200);
  };

  const handleEnableMember = async () => {
    if (!selected || !selectedEvent) return;
    setBusy(true);
    setError('');
    try {
      await registerMemberToEvent({
        eventId: selectedEvent.id,
        memberId: selected.memberId,
        paymentMethod: payMethod,
        kind: 'member',
        members,
      });
      showFlash(`Inscripción · ${selected.name}`);
    } catch (err) {
      setError(err?.message || 'No se pudo inscribir.');
    } finally {
      setBusy(false);
    }
  };

  const handleEnableGuest = async () => {
    if (!selected || !selectedEvent) return;
    setBusy(true);
    setError('');
    try {
      await registerMemberToEvent({
        eventId: selectedEvent.id,
        memberId: selected.memberId,
        guestName,
        paymentMethod: guestMethod,
        kind: 'guest',
        members,
      });
      setGuestName('');
      showFlash(`Invitado sumado · ${guestName.trim()}`);
    } catch (err) {
      setError(err?.message || 'No se pudo sumar al invitado.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fade-in events-tab">
      <header className="events-hero glass-card">
        <div className="pool-hero-copy">
          <p className="events-kicker"><PartyPopper size={14} aria-hidden="true" /> Fiestas y eventos</p>
          <h2 className="serif-font">Cupo, cobro e invitados</h2>
          <p>
            Buscá el socio, cobrá la entrada (efectivo o QR Mercado Pago) y sumá invitados.
            El cupo y la recaudación se actualizan en los gráficos.
          </p>
        </div>
        <div className="pool-hero-kpis">
          <div><strong>{stats.events}</strong><span>Eventos</span></div>
          <div><strong>{stats.totalPeople}</strong><span>Inscriptos</span></div>
          <div><strong>{stats.guests}</strong><span>Invitados</span></div>
          <div><strong>{formatCurrency(stats.collected)}</strong><span>Recaudado</span></div>
        </div>
      </header>

      <section className="events-charts" aria-label="Indicadores de fiestas y eventos">
        <EventOccupancyChart
          rows={dash.byEvent}
          selectedId={selectedEvent?.id}
          onSelect={(id) => {
            setSelectedEventId(id);
            setError('');
          }}
        />
        <EventMixChart mix={dash.mix} />
        <EventMoneyChart
          rows={dash.byEvent}
          payments={dash.payments}
          paidTotal={dash.paidTotal}
          maxCollected={dash.maxCollected}
        />
      </section>

      {flash ? <p className="member-action-flash" role="status">{flash}</p> : null}
      {error ? <p className="conc-error" role="alert">{error}</p> : null}

      <div className="pool-layout">
        <section className="glass-card pool-panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <h3><PartyPopper size={16} /> Evento</h3>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowCreate((v) => !v)}>
              <Plus size={14} /> {showCreate ? 'Cerrar alta' : 'Nuevo evento'}
            </button>
          </div>

          {showCreate ? (
            <form
              className="events-create"
              onSubmit={(e) => {
                e.preventDefault();
                addClubEvent({
                  ...form,
                  startsAt: new Date(form.startsAt).toISOString(),
                });
                setForm((f) => ({ ...f, title: '', description: '' }));
                setShowCreate(false);
                showFlash('Evento creado');
              }}
            >
              <div className="form-group" style={{ marginBottom: 0, gridColumn: '1 / -1' }}>
                <label className="form-label">Título</label>
                <input className="form-input" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Categoría</label>
                <select className="form-input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                  <option value="fiesta">Fiesta</option>
                  <option value="deportes">Deportes</option>
                  <option value="institucional">Institucional</option>
                  <option value="hipica">Hípica</option>
                </select>
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Inicio</label>
                <input type="datetime-local" className="form-input" required value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Cupo</label>
                <input type="number" min="1" className="form-input" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Precio entrada</label>
                <input type="number" min="0" className="form-input" value={form.ticketPrice} onChange={(e) => setForm({ ...form, ticketPrice: e.target.value })} />
              </div>
              <div className="form-group" style={{ marginBottom: 0, gridColumn: '1 / -1' }}>
                <label className="form-label">Descripción</label>
                <textarea className="form-input" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>
              <button type="submit" className="btn btn-primary btn-sm">Crear evento</button>
            </form>
          ) : null}

          <label className="form-group" style={{ display: 'block', marginTop: '0.85rem', marginBottom: 0 }}>
            <span className="form-label">Evento activo</span>
            <select
              className="form-input"
              value={selectedEvent?.id || ''}
              onChange={(e) => {
                setSelectedEventId(e.target.value);
                setError('');
              }}
            >
              {clubEvents.map((ev) => {
                const used = countRegistrations(eventRegistrations, ev.id);
                return (
                  <option key={ev.id} value={ev.id}>
                    {ev.title} · {used}{ev.capacity ? `/${ev.capacity}` : ''} · {ev.ticketPrice > 0 ? formatCurrency(ev.ticketPrice) : 'Libre'}
                  </option>
                );
              })}
            </select>
          </label>

          {selectedEvent ? (
            <div className="events-selected-meter">
              <p className="ops-muted" style={{ margin: 0 }}>
                {new Date(selectedEvent.startsAt).toLocaleString('es-AR')}
                {selectedEvent.location ? ` · ${selectedEvent.location}` : ''}
                {' · '}
                Entrada {ticket > 0 ? formatCurrency(ticket) : 'libre'}
              </p>
              {selectedRow ? (
                <div
                  className="events-occ-track events-occ-track--inline"
                  role="meter"
                  aria-label="Cupo del evento seleccionado"
                  aria-valuemin={0}
                  aria-valuemax={selectedRow.capacity || selectedRow.used || 0}
                  aria-valuenow={selectedRow.used}
                >
                  <span
                    className="events-occ-fill"
                    style={{
                      width: `${selectedRow.occupancyPct != null
                        ? Math.max(selectedRow.occupancyPct, selectedRow.used > 0 ? 6 : 0)
                        : Math.min(100, selectedRow.used * 8)}%`,
                      background: CATEGORY_TONE[selectedRow.category] || 'var(--primary-gold)',
                    }}
                  />
                </div>
              ) : null}
            </div>
          ) : null}

          <h3 style={{ marginTop: '1.15rem' }}><Search size={16} /> Buscar socio</h3>
          <div className="members-search-field" style={{ marginTop: '0.65rem' }}>
            <Search size={18} className="members-search-icon" aria-hidden="true" />
            <input
              className="members-search-input"
              placeholder="Nombre, Nº de socio o DNI…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoComplete="off"
            />
            {query ? (
              <button type="button" className="members-search-clear" onClick={() => setQuery('')} aria-label="Limpiar">
                <X size={14} />
              </button>
            ) : null}
          </div>

          {searchHits.length > 0 && (
            <ul className="pool-search-hits">
              {searchHits.map((m) => (
                <li key={m.memberId}>
                  <button
                    type="button"
                    className={selectedId === m.memberId ? 'is-active' : ''}
                    onClick={() => {
                      setSelectedId(m.memberId);
                      setQuery(m.name);
                      setError('');
                    }}
                  >
                    <strong>{m.name}</strong>
                    <span>Nº {m.memberId} · {m.status === 'active' ? 'Activo' : m.status}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {selected && selectedEvent ? (
            <div className="pool-selected">
              <header>
                <div>
                  <h4 className="serif-font">{selected.name}</h4>
                  <p>Nº {selected.memberId}</p>
                </div>
                {eval_.alreadyIn ? (
                  <span className="pool-badge pool-badge--ok"><CheckCircle2 size={14} /> Inscripto</span>
                ) : (
                  <span className="pool-badge"><UserCheck size={14} /> Seleccionado</span>
                )}
              </header>

              <div className="pool-checklist">
                <div className={`pool-check ${selected.status === 'active' ? 'is-ok' : 'is-bad'}`}>
                  <strong>Estado del socio</strong>
                  <span>{selected.status === 'active' ? 'Cuenta habilitada' : `Estado: ${selected.status}`}</span>
                </div>
                <div className={`pool-check ${eval_.alreadyIn ? 'is-ok' : ''}`}>
                  <strong>Entrada</strong>
                  <span>{ticket > 0 ? formatCurrency(ticket) : 'Sin cargo'} · por persona</span>
                </div>
                <div className="pool-check">
                  <strong>Cupos del evento</strong>
                  <span>
                    {eval_.used}
                    {eval_.capacity != null ? ` / ${eval_.capacity}` : ' (sin tope)'}
                  </span>
                </div>
              </div>

              {!eval_.alreadyIn ? (
                <div className="pool-pay">
                  <p className="ops-muted" style={{ margin: '0 0 0.55rem' }}>
                    Al habilitar se registra la inscripción y, si hay precio, el cobro contable.
                  </p>
                  {ticket > 0 ? (
                    <div className="pool-pay-methods">
                      <button
                        type="button"
                        className={`pool-method ${payMethod === 'efectivo' ? 'is-active' : ''}`}
                        onClick={() => setPayMethod('efectivo')}
                      >
                        <Banknote size={16} /> Efectivo
                      </button>
                      <button
                        type="button"
                        className={`pool-method ${payMethod === 'mercadopago' ? 'is-active' : ''}`}
                        onClick={() => setPayMethod('mercadopago')}
                      >
                        <QrCode size={16} /> Mercado Pago
                      </button>
                    </div>
                  ) : null}
                  {ticket > 0 && payMethod === 'mercadopago' ? (
                    <div className="pool-qr-box">
                      <QRCodeSVG value={mpPayload || 'jockey-event'} size={148} level="M" includeMargin />
                      <p>QR de entrada · {formatCurrency(ticket)}</p>
                    </div>
                  ) : null}
                  {eval_.blockers.length > 0 ? (
                    <ul className="pool-blockers">
                      {eval_.blockers.map((b) => (
                        <li key={b}><AlertTriangle size={13} /> {b}</li>
                      ))}
                    </ul>
                  ) : null}
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy || !eval_.canEnable}
                    onClick={handleEnableMember}
                    style={{ width: '100%', marginTop: '0.65rem' }}
                  >
                    <UserCheck size={16} />
                    {ticket > 0
                      ? `Inscribir · ${formatCurrency(ticket)}`
                      : 'Inscribir (sin cargo)'}
                  </button>
                </div>
              ) : (
                <div className="pool-guests">
                  <h4><UserPlus size={15} /> Invitados del socio</h4>
                  <p className="ops-muted">
                    Hasta {DEFAULT_EVENT_SETTINGS.maxGuestsPerMember} · {ticket > 0 ? formatCurrency(ticket) : 'sin cargo'} c/u
                  </p>
                  {hostGuests.length > 0 ? (
                    <ul className="pool-guest-list">
                      {hostGuests.map((g) => (
                        <li key={g.id}>
                          <span>{g.guestName}</span>
                          <span>{formatCurrency(g.amountPaid || 0)} · {g.paymentMethod || '—'}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="ops-muted">Sin invitados aún.</p>
                  )}
                  <div className="form-group" style={{ marginTop: '0.65rem', marginBottom: 0 }}>
                    <label className="form-label">Nombre del invitado</label>
                    <input
                      className="form-input"
                      value={guestName}
                      onChange={(e) => setGuestName(e.target.value)}
                      placeholder="Apellido y nombre"
                    />
                  </div>
                  {ticket > 0 ? (
                    <div className="pool-pay-methods" style={{ marginTop: '0.55rem' }}>
                      <button
                        type="button"
                        className={`pool-method ${guestMethod === 'efectivo' ? 'is-active' : ''}`}
                        onClick={() => setGuestMethod('efectivo')}
                      >
                        <Banknote size={16} /> Efectivo
                      </button>
                      <button
                        type="button"
                        className={`pool-method ${guestMethod === 'mercadopago' ? 'is-active' : ''}`}
                        onClick={() => setGuestMethod('mercadopago')}
                      >
                        <QrCode size={16} /> Mercado Pago
                      </button>
                    </div>
                  ) : null}
                  {ticket > 0 && guestMethod === 'mercadopago' && guestName.trim() ? (
                    <div className="pool-qr-box">
                      <QRCodeSVG value={guestMpPayload || 'jockey-event-guest'} size={132} level="M" includeMargin />
                      <p>QR invitado · {formatCurrency(ticket)}</p>
                    </div>
                  ) : null}
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy || !guestName.trim() || hostGuests.length >= DEFAULT_EVENT_SETTINGS.maxGuestsPerMember}
                    onClick={handleEnableGuest}
                    style={{ width: '100%', marginTop: '0.65rem' }}
                  >
                    <UserPlus size={16} />
                    {ticket > 0
                      ? `Sumar invitado · ${formatCurrency(ticket)}`
                      : 'Sumar invitado'}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <p className="ops-muted" style={{ marginTop: '1rem' }}>
              Elegí un evento y buscá un socio del padrón para inscribir.
            </p>
          )}
        </section>

        <aside className="pool-side">
          <section className="glass-card pool-panel">
            <h3>Inscriptos del evento</h3>
            {dayList.length === 0 ? (
              <p className="ops-muted" style={{ marginTop: '0.65rem' }}>Todavía no hay inscripciones.</p>
            ) : (
              <ul className="pool-day-list">
                {dayList.map((a) => (
                  <li key={a.id}>
                    <div>
                      <strong>{a.kind === 'guest' ? a.guestName : (a.memberName || a.memberId)}</strong>
                      <span>
                        {a.kind === 'guest' ? `Invitado de ${a.memberName || a.memberId}` : 'Socio'}
                        {' · '}
                        {formatCurrency(a.amountPaid || 0)}
                        {a.paymentMethod ? ` · ${a.paymentMethod === 'mercadopago' ? 'MP' : 'Efectivo'}` : ''}
                      </span>
                    </div>
                    {typeof revokeEventRegistration === 'function' ? (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        title="Revocar"
                        onClick={() => revokeEventRegistration(a.id)}
                      >
                        <Trash2 size={13} />
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="glass-card pool-panel">
            <h3>Agenda</h3>
            <ul className="events-agenda">
              {clubEvents.slice(0, 6).map((ev) => {
                const row = dash.byEvent.find((item) => item.id === ev.id);
                const used = row?.used ?? countRegistrations(eventRegistrations, ev.id);
                const pct = row?.occupancyPct ?? 0;
                return (
                  <li key={ev.id}>
                    <button
                      type="button"
                      className={selectedEvent?.id === ev.id ? 'is-active' : ''}
                      onClick={() => setSelectedEventId(ev.id)}
                    >
                      <strong>{ev.title}</strong>
                      <span>
                        {new Date(ev.startsAt).toLocaleDateString('es-AR')} · {used}
                        {ev.capacity ? `/${ev.capacity}` : ''}
                        {row?.occupancyPct != null ? ` · ${row.occupancyPct}%` : ''}
                      </span>
                      <span className="events-occ-track events-occ-track--agenda" aria-hidden="true">
                        <span
                          className="events-occ-fill"
                          style={{
                            width: `${ev.capacity ? Math.max(pct, used > 0 ? 6 : 0) : Math.min(100, used * 8)}%`,
                            background: CATEGORY_TONE[ev.category] || 'var(--primary-gold)',
                          }}
                        />
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}
