import { useEffect, useMemo, useState } from 'react';
import {
  Waves, Search, UserCheck, Upload, Banknote, QrCode, UserPlus,
  CheckCircle2, AlertTriangle, X, Trash2, FileHeart,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useAuth } from '../../context/AuthContext';
import {
  DEFAULT_POOL_SETTINGS,
  mergePoolSettings,
  evaluatePoolAccess,
  attachPoolMedical,
  enableMemberPoolAccess,
  enableGuestPoolAccess,
  revokePoolAccess,
  listDayAccesses,
  poolDayStats,
  buildPoolMpPayload,
  guestDayAccessesForHost,
  searchPoolMembers,
  memberPoolHistory,
} from '../../domain/pool/poolAccess';
import { poolIngressToAccessLog } from '../../domain/credentials/accessLog';
import { todayISODateAR } from '../../lib/arDate';

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error('Seleccioná un archivo.'));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('No se pudo leer el archivo.'));
    reader.onload = () => resolve(String(reader.result || ''));
    reader.readAsDataURL(file);
  });
}

/**
 * Operación de pileta: habilitar socios con revisación médica,
 * cobro de canon (efectivo / QR MP) e invitados del día.
 */
export default function PoolTab({
  members = [],
  setMembers,
  updateMember = null,
  formatCurrency,
  addJournalEntry,
  poolAccesses = [],
  setPoolAccesses,
  setEntryLogs,
  poolSettings = DEFAULT_POOL_SETTINGS,
  setPoolSettings,
}) {
  const { user } = useAuth();
  const actorName = user?.fullName || user?.name || user?.email || '';
  const today = todayISODateAR();
  const settings = mergePoolSettings(poolSettings);

  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [payMethod, setPayMethod] = useState('efectivo');
  const [guestName, setGuestName] = useState('');
  const [guestMethod, setGuestMethod] = useState('efectivo');
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState('');
  const [error, setError] = useState('');
  const [feeDraft, setFeeDraft] = useState({
    memberDayFee: settings.memberDayFee,
    guestDayFee: settings.guestDayFee,
  });

  useEffect(() => {
    setFeeDraft({
      memberDayFee: settings.memberDayFee,
      guestDayFee: settings.guestDayFee,
    });
  }, [settings.memberDayFee, settings.guestDayFee]);

  const selected = useMemo(
    () => members.find((m) => m.memberId === selectedId) || null,
    [members, selectedId]
  );

  const searchHits = useMemo(() => {
    return searchPoolMembers(members, query, { limit: 50 }).map((member) => ({
      member,
      snap: evaluatePoolAccess(member, { accesses: poolAccesses, today, settings }),
      dues: Number(member.outstandingBalance) || 0,
    }));
  }, [members, query, poolAccesses, today, settings]);

  const eval_ = useMemo(
    () => evaluatePoolAccess(selected, { accesses: poolAccesses, today, settings }),
    [selected, poolAccesses, today, settings]
  );

  const dayList = useMemo(() => listDayAccesses(poolAccesses, today), [poolAccesses, today]);
  const stats = useMemo(() => poolDayStats(poolAccesses, today), [poolAccesses, today]);
  const hostGuests = selected
    ? guestDayAccessesForHost(poolAccesses, selected.memberId, today)
    : [];
  const selectedHistory = useMemo(
    () => (selected ? memberPoolHistory(poolAccesses, selected.memberId).slice(0, 12) : []),
    [poolAccesses, selected],
  );
  const selectedDues = Number(selected?.outstandingBalance) || 0;

  const mpPayload = useMemo(() => {
    if (!selected) return '';
    return buildPoolMpPayload({
      amount: settings.memberDayFee,
      memberId: selected.memberId,
      memberName: selected.name,
      concept: 'Canon pileta',
    });
  }, [selected, settings.memberDayFee]);

  const guestMpPayload = useMemo(() => {
    if (!selected || !guestName.trim()) return '';
    return buildPoolMpPayload({
      amount: settings.guestDayFee,
      memberId: selected.memberId,
      memberName: `${guestName} / ${selected.name}`,
      concept: 'Canon pileta invitado',
    });
  }, [selected, guestName, settings.guestDayFee]);

  const persistMember = async (next) => {
    if (typeof updateMember === 'function') {
      await updateMember(next);
      return;
    }
    setMembers((prev) => prev.map((m) => (m.memberId === next.memberId ? next : m)));
  };

  const showFlash = (msg) => {
    setFlash(msg);
    setTimeout(() => setFlash(''), 3200);
  };

  const handleUploadMedical = async (file) => {
    if (!selected || !file) return;
    setBusy(true);
    setError('');
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const next = attachPoolMedical(selected, {
        fileName: file.name,
        dataUrl,
        actorName,
        validityDays: settings.medicalValidityDays,
      });
      await persistMember(next);
      showFlash(`Revisación médica cargada · ${selected.name}`);
    } catch (err) {
      setError(err?.message || 'No se pudo subir la revisación.');
    } finally {
      setBusy(false);
    }
  };

  const handleEnableMember = async () => {
    if (!selected) return;
    setBusy(true);
    setError('');
    try {
      const { entry, accesses } = enableMemberPoolAccess({
        member: selected,
        accesses: poolAccesses,
        method: payMethod,
        today,
        settings,
        actorName,
      });
      setPoolAccesses(accesses);
      if (typeof setEntryLogs === 'function') {
        const log = poolIngressToAccessLog(entry);
        if (log) setEntryLogs((prev) => [log, ...(prev || [])]);
      }
      if (typeof addJournalEntry === 'function' && entry.payment.amount > 0) {
        addJournalEntry({
          date: today,
          description: `Canon pileta — ${selected.name} (${payMethod === 'mercadopago' ? 'MP QR' : 'Efectivo'})`,
          lines: [
            {
              account: payMethod === 'efectivo' ? 'Caja General' : 'Banco Nación',
              type: 'debit',
              amount: entry.payment.amount,
            },
            { account: 'Reservas e Instalaciones', type: 'credit', amount: entry.payment.amount },
          ],
          sourceModule: 'pileta',
        });
      }
      showFlash(`Acceso habilitado · ${selected.name}`);
    } catch (err) {
      setError(err?.message || 'No se pudo habilitar el acceso.');
    } finally {
      setBusy(false);
    }
  };

  const handleEnableGuest = async () => {
    if (!selected) return;
    setBusy(true);
    setError('');
    try {
      const { entry, accesses } = enableGuestPoolAccess({
        host: selected,
        guestName,
        accesses: poolAccesses,
        method: guestMethod,
        today,
        settings,
        actorName,
      });
      setPoolAccesses(accesses);
      setGuestName('');
      if (typeof setEntryLogs === 'function') {
        const log = poolIngressToAccessLog(entry);
        if (log) setEntryLogs((prev) => [log, ...(prev || [])]);
      }
      if (typeof addJournalEntry === 'function' && entry.payment.amount > 0) {
        addJournalEntry({
          date: today,
          description: `Canon pileta invitado — ${entry.guestName} (anfitrión ${selected.name})`,
          lines: [
            {
              account: guestMethod === 'efectivo' ? 'Caja General' : 'Banco Nación',
              type: 'debit',
              amount: entry.payment.amount,
            },
            { account: 'Reservas e Instalaciones', type: 'credit', amount: entry.payment.amount },
          ],
          sourceModule: 'pileta',
        });
      }
      showFlash(`Invitado habilitado · ${entry.guestName}`);
    } catch (err) {
      setError(err?.message || 'No se pudo habilitar al invitado.');
    } finally {
      setBusy(false);
    }
  };

  const saveFees = () => {
    setPoolSettings?.({
      ...settings,
      memberDayFee: Math.max(0, Number(feeDraft.memberDayFee) || 0),
      guestDayFee: Math.max(0, Number(feeDraft.guestDayFee) || 0),
    });
    showFlash('Tarifas de pileta actualizadas');
  };

  return (
    <div className="fade-in pool-tab">
      <header className="pool-hero glass-card">
        <div className="pool-hero-copy">
          <p className="pool-kicker"><Waves size={14} aria-hidden="true" /> Pileta</p>
          <h2 className="serif-font">{settings.seasonLabel}</h2>
          <p>
            Habilitación de socios con revisación médica, cobro de canon (efectivo o QR Mercado Pago)
            e invitados del día.
          </p>
        </div>
        <div className="pool-hero-kpis">
          <div><strong>{stats.members}</strong><span>Socios hoy</span></div>
          <div><strong>{stats.guests}</strong><span>Invitados</span></div>
          <div><strong>{formatCurrency(stats.collected)}</strong><span>Canon cobrado</span></div>
        </div>
      </header>

      {flash ? <p className="member-action-flash" role="status">{flash}</p> : null}
      {error ? <p className="conc-error" role="alert">{error}</p> : null}

      <div className="pool-layout">
        <section className="glass-card pool-panel">
          <div className="members-search-hero pool-search-hero">
            <label className="members-search-label" htmlFor="pool-search-input">
              Buscar socio de pileta
            </label>
            <div className="members-search-field">
              <Search size={22} className="members-search-icon" aria-hidden="true" />
              <input
                id="pool-search-input"
                className="members-search-input"
                placeholder="Nombre, DNI o Nº de socio…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoComplete="off"
                autoFocus
              />
              {query ? (
                <button type="button" className="members-search-clear" onClick={() => setQuery('')} aria-label="Limpiar">
                  <X size={16} />
                </button>
              ) : null}
            </div>
            <p className="members-search-hint">
              {query.trim()
                ? `${searchHits.length.toLocaleString('es-AR')} coincidencia${searchHits.length === 1 ? '' : 's'}`
                : 'Escribí nombre, DNI o número de socio para ver si pagó, el apto médico y el resto de pileta.'}
            </p>
          </div>
          {searchHits.length > 0 && (
            <ul className="pool-search-hits">
              {searchHits.map(({ member: m, snap, dues }) => (
                <li key={m.memberId}>
                  <button
                    type="button"
                    className={selectedId === m.memberId ? 'is-active' : ''}
                    onClick={() => {
                      setSelectedId(m.memberId);
                      setError('');
                    }}
                  >
                    <strong>{m.name}</strong>
                    <span>
                      Nº {m.memberId}
                      {m.documentNumber ? ` · DNI ${m.documentNumber}` : ''}
                      {' · '}
                      {m.status === 'active' ? 'Activo' : m.status === 'inactive' ? 'Baja' : m.status}
                    </span>
                    <span className="pool-hit-flags">
                      <em className={snap.paidToday ? 'is-ok' : 'is-bad'}>
                        {snap.paidToday ? 'Canon pago' : 'Canon impago'}
                      </em>
                      <em className={snap.medical?.ok ? 'is-ok' : 'is-bad'}>
                        {snap.medical?.ok ? 'Apto médico' : 'Sin apto'}
                      </em>
                      <em className={dues > 0 ? 'is-bad' : 'is-ok'}>
                        {dues > 0 ? `Debe ${formatCurrency(dues)}` : 'Cuota al día'}
                      </em>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {selected ? (
            <div className="pool-selected">
              <header>
                <div>
                  <h4 className="serif-font">{selected.name}</h4>
                  <p>Nº {selected.memberId} · {selected.documentNumber ? `DNI ${selected.documentNumber}` : 'Sin DNI'}</p>
                </div>
                {eval_.alreadyIn ? (
                  <span className="pool-badge pool-badge--ok"><CheckCircle2 size={14} /> En pileta hoy</span>
                ) : (
                  <span className="pool-badge"><UserCheck size={14} /> Seleccionado</span>
                )}
              </header>

              <div className="pool-checklist">
                <div className={`pool-check ${selected.status === 'active' ? 'is-ok' : 'is-bad'}`}>
                  <strong>Estado del socio</strong>
                  <span>{selected.status === 'active' ? 'Cuenta habilitada' : `Estado: ${selected.status}`}</span>
                </div>
                <div className={`pool-check ${selectedDues > 0 ? 'is-bad' : 'is-ok'}`}>
                  <strong>Cuota social</strong>
                  <span>
                    {selectedDues > 0
                      ? `No pagó · saldo ${formatCurrency(selectedDues)}`
                      : 'Pagó / al día'}
                  </span>
                </div>
                <div className={`pool-check ${eval_.paidToday ? 'is-ok' : 'is-bad'}`}>
                  <strong>Canon pileta de hoy</strong>
                  <span>
                    {eval_.paidToday
                      ? `Pagó · ${formatCurrency(settings.memberDayFee)}`
                      : `No pagó · ${formatCurrency(settings.memberDayFee)}`}
                    {eval_.alreadyIn ? ' · ya ingresó' : ''}
                  </span>
                </div>
                <div className={`pool-check ${eval_.medical?.ok ? 'is-ok' : 'is-bad'}`}>
                  <strong>Revisación médica</strong>
                  <span>
                    {eval_.medical?.label}
                    {eval_.medical?.expiresAt ? ` · vence ${eval_.medical.expiresAt}` : ''}
                  </span>
                  {!eval_.medical?.ok ? (
                    <label className="pool-upload">
                      <Upload size={14} />
                      Subir revisación
                      <input
                        type="file"
                        accept="image/*,.pdf,application/pdf"
                        hidden
                        disabled={busy}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          e.target.value = '';
                          if (file) handleUploadMedical(file);
                        }}
                      />
                    </label>
                  ) : (
                    <span className="pool-file-hint">
                      <FileHeart size={13} /> {eval_.medical.doc?.fileName || 'Documento cargado'}
                    </span>
                  )}
                </div>
              </div>

              {!eval_.alreadyIn ? (
                <div className="pool-pay">
                  <p className="ops-muted" style={{ margin: '0 0 0.55rem' }}>
                    Al habilitar se registra el cobro del canon. Completá la revisación médica antes.
                  </p>
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
                  {payMethod === 'mercadopago' ? (
                    <div className="pool-qr-box">
                      <QRCodeSVG value={mpPayload || 'jockey-pool'} size={148} level="M" includeMargin />
                      <p>Mostrá el QR al socio para pagar {formatCurrency(settings.memberDayFee)}</p>
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
                    <UserCheck size={16} /> Habilitar acceso · {formatCurrency(settings.memberDayFee)}
                  </button>
                </div>
              ) : (
                <div className="pool-guests">
                  <h4><UserPlus size={15} /> Invitados del socio</h4>
                  <p className="ops-muted">
                    Hasta {settings.maxGuestsPerMember} por día · {formatCurrency(settings.guestDayFee)} c/u
                  </p>
                  {hostGuests.length > 0 ? (
                    <ul className="pool-guest-list">
                      {hostGuests.map((g) => (
                        <li key={g.id}>
                          <span>{g.guestName}</span>
                          <span>{formatCurrency(g.payment?.amount || 0)} · {g.payment?.method}</span>
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
                  {guestMethod === 'mercadopago' && guestName.trim() ? (
                    <div className="pool-qr-box">
                      <QRCodeSVG value={guestMpPayload || 'jockey-pool-guest'} size={132} level="M" includeMargin />
                      <p>QR invitado · {formatCurrency(settings.guestDayFee)}</p>
                    </div>
                  ) : null}
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy || !guestName.trim() || hostGuests.length >= settings.maxGuestsPerMember}
                    onClick={handleEnableGuest}
                    style={{ width: '100%', marginTop: '0.65rem' }}
                  >
                    <UserPlus size={16} /> Sumar invitado · {formatCurrency(settings.guestDayFee)}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <p className="ops-muted" style={{ marginTop: '1rem' }}>
              Buscá un socio por nombre, DNI o número para ver si pagó pileta, la cuota y el apto médico.
            </p>
          )}

          {selected && selectedHistory.length > 0 ? (
            <section className="pool-history">
              <h4>Historial de pileta</h4>
              <ul>
                {selectedHistory.map((row) => (
                  <li key={row.id}>
                    <strong>
                      {row.kind === 'guest' ? `Invitado ${row.guestName}` : 'Socio'}
                      {row.status === 'revoked' ? ' · revocado' : ''}
                    </strong>
                    <span>
                      {row.date}
                      {' · '}
                      {row.payment?.method === 'asistencia'
                        ? 'Asistió'
                        : `${row.payment?.amount != null ? formatCurrency(row.payment.amount) : 's/importe'} · ${row.payment?.method === 'mercadopago' ? 'Mercado Pago' : (row.payment?.method || '—')}`}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </section>

        <aside className="pool-side">
          <section className="glass-card pool-panel">
            <h3>Ingresos de hoy</h3>
            {dayList.length === 0 ? (
              <p className="ops-muted" style={{ marginTop: '0.65rem' }}>Todavía no hay ingresos registrados.</p>
            ) : (
              <ul className="pool-day-list">
                {dayList.map((a) => (
                  <li key={a.id}>
                    <div>
                      <strong>{a.kind === 'guest' ? a.guestName : a.memberName}</strong>
                      <span>
                        {a.kind === 'guest' ? `Invitado de ${a.memberName}` : 'Socio'}
                        {' · '}
                        {a.payment?.method === 'asistencia'
                          ? 'Asistió'
                          : `${formatCurrency(a.payment?.amount || 0)} · ${a.payment?.method === 'mercadopago' ? 'MP' : 'Efectivo'}`}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      title="Revocar"
                      onClick={() => setPoolAccesses(revokePoolAccess(poolAccesses, a.id))}
                    >
                      <Trash2 size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="glass-card pool-panel">
            <h3>Tarifas del día</h3>
            <div className="pool-fees">
              <label>
                <span>Canon socio</span>
                <input
                  className="form-input"
                  type="number"
                  min={0}
                  value={feeDraft.memberDayFee}
                  onChange={(e) => setFeeDraft((p) => ({ ...p, memberDayFee: e.target.value }))}
                />
              </label>
              <label>
                <span>Canon invitado</span>
                <input
                  className="form-input"
                  type="number"
                  min={0}
                  value={feeDraft.guestDayFee}
                  onChange={(e) => setFeeDraft((p) => ({ ...p, guestDayFee: e.target.value }))}
                />
              </label>
              <button type="button" className="btn btn-secondary" onClick={saveFees}>
                Guardar tarifas
              </button>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
