import { useEffect, useMemo, useState } from 'react';
import {
  Waves, Search, UserCheck, Upload, UserPlus,
  CheckCircle2, AlertTriangle, X, Trash2, FileHeart,
} from 'lucide-react';
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
  guestDayAccessesForHost,
  searchPoolMembers,
  poolSearchFlags,
  memberPoolHistory,
  isPoolDayCashOpen,
  poolMethodUsesCash,
  poolMethodUsesBank,
  poolMethodLabel,
} from '../../domain/pool/poolAccess';
import {
  applyPoolAccountPass,
  chargePoolCanon,
  withChargedPoolEntry,
} from '../../domain/pool/poolCheckout';
import { verifyPoolCanonCircle } from '../../domain/pool/poolCircle';
import { deliverPaymentReceipt } from '../../domain/payments/deliverPaymentReceipt';
import { poolIngressToAccessLog } from '../../domain/credentials/accessLog';
import { CLUB_BANK_ACCOUNTS } from '../../domain/members/clubBanks';
import { todayISODateAR } from '../../lib/arDate';
import MercadoPagoCheckout from '../MercadoPagoCheckout';
import ModalDialog from '../ModalDialog';
import PaymentMethodTiles from '../PaymentMethodTiles';
import { listPoolAccesses } from '../../data/repos';
import { isDuesExemptMember } from '../../domain/members/dues';

function poolDuesOwed(member) {
  if (!member || isDuesExemptMember(member)) return 0;
  return Number(member.outstandingBalance) || 0;
}

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
  recordPoolCanon,
  onUpsertMemberAccountEntry = null,
  cashSessions = [],
  cashRegisters = [],
  onOpenDayCash,
  dayCashOpen: dayCashOpenProp = null,
  onRefreshDayCash,
  poolAccesses = [],
  setPoolAccesses,
  setEntryLogs,
  poolSettings = DEFAULT_POOL_SETTINGS,
  onSendMessage = null,
}) {
  const { user } = useAuth();
  const actorName = user?.fullName || user?.name || user?.email || '';
  const today = todayISODateAR();
  const settings = mergePoolSettings(poolSettings);

  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [guestName, setGuestName] = useState('');
  const [busy, setBusy] = useState(false);
  const [openingCash, setOpeningCash] = useState(false);
  const [flash, setFlash] = useState('');
  const [error, setError] = useState('');
  const [payMethod, setPayMethod] = useState('efectivo');
  const [guestMethod, setGuestMethod] = useState('efectivo');
  const [payBankId, setPayBankId] = useState(CLUB_BANK_ACCOUNTS[0]?.id || 'macro');
  const [guestBankId, setGuestBankId] = useState(CLUB_BANK_ACCOUNTS[0]?.id || 'macro');
  const [medicalTalonario, setMedicalTalonario] = useState('');

  const selected = useMemo(
    () => members.find((m) => m.memberId === selectedId) || null,
    [members, selectedId]
  );

  const searchHits = useMemo(() => {
    return searchPoolMembers(members, query, { limit: 50 }).map((member) => ({
      member,
      snap: evaluatePoolAccess(member, { accesses: poolAccesses, today, settings, members }),
      dues: poolDuesOwed(member),
    }));
  }, [members, query, poolAccesses, today, settings]);

  const eval_ = useMemo(
    () => evaluatePoolAccess(selected, { accesses: poolAccesses, today, settings, members }),
    [selected, poolAccesses, today, settings, members]
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
  const selectedDues = poolDuesOwed(selected);
  // Lo que dice la base manda: el operario de pileta no puede leer las sesiones de caja y
  // deducirlo de ellas lo mostraría cerrado después de recargar.
  const dayCashOpen = typeof dayCashOpenProp === 'boolean'
    ? dayCashOpenProp
    : isPoolDayCashOpen(cashSessions, cashRegisters);

  useEffect(() => {
    if (typeof onRefreshDayCash === 'function') void onRefreshDayCash();
  }, [onRefreshDayCash]);

  useEffect(() => {
    if (dayCashOpen || typeof onOpenDayCash !== 'function') return undefined;
    let cancelled = false;
    setOpeningCash(true);
    void onOpenDayCash()
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setOpeningCash(false);
      });
    return () => { cancelled = true; };
  }, [dayCashOpen, onOpenDayCash]);

  const openDayCash = async () => {
    if (dayCashOpen || openingCash || typeof onOpenDayCash !== 'function') return;
    setOpeningCash(true);
    setError('');
    try {
      await onOpenDayCash();
      showFlash('Caja abierta.');
    } catch (err) {
      setError(err?.message || 'No se pudo asegurar la caja.');
    } finally {
      setOpeningCash(false);
    }
  };

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

  const closeSelected = () => {
    setSelectedId(null);
    setGuestName('');
    setMedicalTalonario('');
    setError('');
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
        talonario: medicalTalonario,
        actorName,
        validityDays: settings.medicalValidityDays,
      });
      await persistMember(next);
      setMedicalTalonario('');
      showFlash(`Revisación médica cargada · ${selected.name}`);
    } catch (err) {
      setError(err?.message || 'No se pudo subir la revisación.');
    } finally {
      setBusy(false);
    }
  };

  const handleMarkMedicalTalonario = async () => {
    if (!selected) return;
    const ticket = String(medicalTalonario || '').trim();
    if (!ticket) {
      setError('Indicá el número del talonario de la revisación.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const next = attachPoolMedical(selected, {
        talonario: ticket,
        actorName,
        validityDays: settings.medicalValidityDays,
      });
      await persistMember(next);
      setMedicalTalonario('');
      showFlash(`Revisación marcada · talón ${ticket} · ${selected.name}`);
    } catch (err) {
      setError(err?.message || 'No se pudo marcar la revisación.');
    } finally {
      setBusy(false);
    }
  };

  const handleEnableMember = async (member = selected) => {
    if (!member) return;
    const snap = evaluatePoolAccess(member, { accesses: poolAccesses, today, settings, members });
    if (snap.payBlocked) {
      setError('En mora · regularizá la cuota para pagar pileta.');
      return;
    }
    if (payMethod === 'mercadopago') {
      setError('Usá el QR de Mercado Pago para este medio.');
      return;
    }
    setSelectedId(member.memberId);
    setBusy(true);
    setError('');
    try {
      const { entry, accesses } = enableMemberPoolAccess({
        member,
        accesses: poolAccesses,
        method: payMethod,
        today,
        settings,
        actorName,
        members,
      });
      const charged = await chargePoolCanon({
        entry,
        member,
        recordPoolCanon,
        bankId: poolMethodUsesBank(payMethod) ? payBankId : null,
      });
      const circle = verifyPoolCanonCircle({ entry, charged, method: payMethod });
      if (!circle.ok) {
        throw new Error(`Canon incompleto: ${circle.issues.join(' · ')}`);
      }
      setPoolAccesses(withChargedPoolEntry(accesses, entry, charged));
      for (const row of charged.accountEntries || []) onUpsertMemberAccountEntry?.(row);
      if (typeof setMembers === 'function' && charged.accountEntries?.length) {
        setMembers((prev) => applyPoolAccountPass(prev, charged.accountEntries));
      }
      if (typeof setEntryLogs === 'function') {
        const log = poolIngressToAccessLog(charged);
        if (log) setEntryLogs((prev) => [log, ...(prev || [])]);
      }
      const amount = Number(charged?.payment?.amount) || 0;
      const method = charged?.payment?.method || payMethod;
      if (amount > 0 && method !== 'mercadopago') {
        void deliverPaymentReceipt({
          member,
          payment: {
            amount,
            date: charged.date || today,
            method,
            methodLabel: poolMethodLabel(method),
            receiptNumber: charged.cashMovementId || charged.journalEntryId || charged.id,
            concept: `Canon pileta · ${member.name || 'socio'}`,
          },
          onSendMessage,
          kind: 'pileta',
        });
      }
      showFlash(`Habilitado · ${member.name} · asiento en caja`);
    } catch (err) {
      setError(err?.message || 'No se pudo habilitar el acceso.');
    } finally {
      setBusy(false);
    }
  };

  const handleEnableGuest = async () => {
    if (!selected) return;
    if (guestMethod === 'mercadopago') {
      setError('Usá el QR de Mercado Pago para este medio.');
      return;
    }
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
      const charged = await chargePoolCanon({
        entry,
        member: selected,
        recordPoolCanon,
        bankId: poolMethodUsesBank(guestMethod) ? guestBankId : null,
      });
      const circle = verifyPoolCanonCircle({ entry, charged, method: guestMethod });
      if (!circle.ok) {
        throw new Error(`Canon incompleto: ${circle.issues.join(' · ')}`);
      }
      setPoolAccesses(withChargedPoolEntry(accesses, entry, charged));
      for (const row of charged.accountEntries || []) onUpsertMemberAccountEntry?.(row);
      if (typeof setMembers === 'function' && charged.accountEntries?.length) {
        setMembers((prev) => applyPoolAccountPass(prev, charged.accountEntries));
      }
      setGuestName('');
      if (typeof setEntryLogs === 'function') {
        const log = poolIngressToAccessLog(charged);
        if (log) setEntryLogs((prev) => [log, ...(prev || [])]);
      }
      const amount = Number(charged?.payment?.amount) || 0;
      const method = charged?.payment?.method || guestMethod;
      if (amount > 0 && method !== 'mercadopago') {
        void deliverPaymentReceipt({
          member: selected,
          payment: {
            amount,
            date: charged.date || today,
            method,
            methodLabel: poolMethodLabel(method),
            receiptNumber: charged.cashMovementId || charged.journalEntryId || charged.id,
            concept: `Canon pileta invitado · ${charged.guestName || 'invitado'}`,
          },
          onSendMessage,
          kind: 'pileta',
        });
      }
      showFlash(`Invitado habilitado · ${charged.guestName}`);
    } catch (err) {
      setError(err?.message || 'No se pudo habilitar al invitado.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fade-in pool-tab">
      <header className="pool-hero glass-card">
        <div className="pool-hero-copy">
          <p className="pool-kicker"><Waves size={14} aria-hidden="true" /> Pileta</p>
          <h2 className="serif-font">{settings.seasonLabel}</h2>
          <p>
            Cada Habilitar acredita el canon en Caja General (o banco / Mercado Pago), deja el asiento en el libro,
            anota el movimiento en la cuenta del socio y manda el comprobante.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-primary pool-day-cash"
          disabled={dayCashOpen || openingCash || typeof onOpenDayCash !== 'function'}
          onClick={openDayCash}
        >
          {dayCashOpen ? 'Caja abierta' : (openingCash ? 'Asegurando caja…' : 'Asegurar caja')}
        </button>
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
                placeholder="Apellido, nombre, DNI o Nº de socio…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoComplete="off"
                autoFocus
              />
              {query ? (
                <button
                  type="button"
                  className="members-search-clear"
                  onClick={() => {
                    setQuery('');
                    closeSelected();
                  }}
                  aria-label="Limpiar"
                >
                  <X size={16} />
                </button>
              ) : null}
            </div>
            <p className="members-search-hint">
              {query.trim()
                ? `${searchHits.length.toLocaleString('es-AR')} coincidencia${searchHits.length === 1 ? '' : 's'}`
                : 'Apellido y nombre, en cualquier orden. También un pedazo de cada uno, el DNI o el número de socio.'}
            </p>
          </div>
          {searchHits.length > 0 && !selected && (
            <ul className="pool-search-hits">
              {searchHits.map(({ member: m, snap, dues }) => (
                <li key={m.memberId} className="pool-search-hit">
                  <button
                    type="button"
                    className={`pool-hit-open${selectedId === m.memberId ? ' is-active' : ''}`}
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
                      {poolSearchFlags(snap, dues, formatCurrency).map((flag) => (
                        <em key={flag.label} className={flag.tone === 'ok' ? 'is-ok' : 'is-bad'}>
                          {flag.label}
                        </em>
                      ))}
                    </span>
                  </button>
                  {snap.alreadyIn ? (
                    <span className="pool-hit-ready">Hoy</span>
                  ) : snap.payBlocked ? (
                    <span className="pool-hit-mora">Mora</span>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-primary pool-hit-enable"
                      disabled={busy || !dayCashOpen || !snap.canEnable}
                      title={dayCashOpen ? (snap.blockers[0] || 'Habilitar ingreso de hoy') : 'Esperando caja…'}
                      onClick={() => handleEnableMember(m)}
                    >
                      <UserCheck size={15} /> Habilitar
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}

          {!selected && searchHits.length === 0 ? (
            <p className="ops-muted" style={{ marginTop: '1rem' }}>
              Buscá un socio por nombre, DNI o número para ver si pagó pileta, la cuota y el apto médico.
            </p>
          ) : null}

          <ModalDialog
            open={Boolean(selected)}
            onClose={closeSelected}
            labelledBy="pool-member-title"
            overlayClassName="modal-overlay pool-member-overlay"
            contentClassName="modal-content glass-panel pool-member-modal"
          >
            {selected ? (
            <div className="pool-selected">
              <header>
                <div>
                  <h4 id="pool-member-title" className="serif-font">{selected.name}</h4>
                  <p>Nº {selected.memberId} · {selected.documentNumber ? `DNI ${selected.documentNumber}` : 'Sin DNI'}</p>
                </div>
                <div className="pool-selected-actions">
                  {eval_.alreadyIn ? (
                    <span className="pool-badge pool-badge--ok"><CheckCircle2 size={14} /> En pileta hoy</span>
                  ) : (
                    <span className="pool-badge"><UserCheck size={14} /> Seleccionado</span>
                  )}
                  <button type="button" className="btn btn-secondary btn-sm" onClick={closeSelected} aria-label="Cerrar ficha">
                    <X size={14} aria-hidden /> Cerrar
                  </button>
                </div>
              </header>
              {error ? <p className="conc-error" role="alert">{error}</p> : null}
              {flash ? <p className="member-action-flash" role="status">{flash}</p> : null}

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
                <div className={`pool-check ${eval_.medical?.ok ? 'is-ok' : 'is-bad'}`}>
                  <strong>Revisación médica</strong>
                  <span>
                    {eval_.medical?.label}
                    {eval_.medical?.expiresAt ? ` · vence ${eval_.medical.expiresAt}` : ''}
                  </span>
                  {eval_.medical?.ok ? (
                    <span className="pool-file-hint">
                      <FileHeart size={13} />{' '}
                      {eval_.medical.doc?.talonario
                        ? `Talón ${eval_.medical.doc.talonario}`
                        : (eval_.medical.doc?.fileName || 'Documento cargado')}
                    </span>
                  ) : (
                    <div className="pool-medical-actions">
                      <div className="pool-talonario-row">
                        <input
                          className="form-input"
                          type="text"
                          inputMode="numeric"
                          autoComplete="off"
                          placeholder="Nº talonario"
                          value={medicalTalonario}
                          disabled={busy}
                          onChange={(e) => setMedicalTalonario(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              void handleMarkMedicalTalonario();
                            }
                          }}
                          aria-label="Número del talonario de revisación médica"
                        />
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          disabled={busy || !String(medicalTalonario || '').trim()}
                          onClick={() => void handleMarkMedicalTalonario()}
                        >
                          Marcar
                        </button>
                      </div>
                      <label className="pool-upload">
                        <Upload size={14} />
                        Subir archivo
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
                    </div>
                  )}
                </div>
                <div className={`pool-check ${eval_.seasonPaid || eval_.paidToday ? 'is-ok' : 'is-bad'}`}>
                  <strong>Canon de temporada</strong>
                  <span>
                    {eval_.seasonPaid || eval_.paidToday
                      ? `Abonado${eval_.seasonReason ? ` · ${eval_.seasonReason}` : ''}`
                      : `Pendiente · ${formatCurrency(eval_.seasonAmountDue ?? settings.memberSeasonFee)}`}
                    {eval_.alreadyIn ? ' · ya ingresó hoy' : ''}
                  </span>
                </div>
              </div>

              {eval_.payBlocked && !eval_.alreadyIn ? (
                <p className="pool-mora-lock" role="status">
                  <AlertTriangle size={16} aria-hidden />
                  En mora. No puede pagar pileta hasta regularizar la cuota social.
                </p>
              ) : !eval_.alreadyIn ? (
                <div className="pool-pay">
                  {(Number(eval_.seasonAmountDue) || 0) > 0 ? (
                    <>
                      <PaymentMethodTiles
                        value={payMethod}
                        onChange={setPayMethod}
                        disabled={busy}
                        ariaLabel="Método de pago del canon de temporada"
                      />
                      {payMethod === 'efectivo' ? (
                        <p className="pool-pay-note">
                          Confirme el cobro en efectivo. Se registrará en <strong>Caja General</strong>.
                        </p>
                      ) : null}
                      {poolMethodUsesBank(payMethod) ? (
                        <div className="form-group" style={{ marginBottom: '0.85rem' }}>
                          <label className="form-label" htmlFor="pool-pay-bank">Alias</label>
                          <select
                            id="pool-pay-bank"
                            className="form-input"
                            value={payBankId}
                            onChange={(e) => setPayBankId(e.target.value)}
                            disabled={busy}
                          >
                            {CLUB_BANK_ACCOUNTS.map((bank) => (
                              <option key={bank.id} value={bank.id}>
                                {bank.alias || bank.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      ) : null}
                      {payMethod === 'tarjeta' || payMethod === 'pos' ? (
                        <p className="pool-pay-note">
                          Pago POS: queda en <strong>Tarjetas a cobrar</strong> con el asiento y el ingreso.
                        </p>
                      ) : null}
                      {payMethod === 'mercadopago' ? (
                        <MercadoPagoCheckout
                          kind="pool"
                          mode="qr"
                          amount={Number(eval_.seasonAmountDue) || 0}
                          memberNumber={selected.memberId}
                          concept={`Canon pileta temporada · ${selected.name}`}
                          disabled={busy || !eval_.canEnable || !(Number(eval_.seasonAmountDue) > 0)}
                          onApproved={async () => {
                            const rows = await listPoolAccesses();
                            setPoolAccesses(rows);
                            showFlash(`Pago Mercado Pago · ${selected.name}`);
                          }}
                        />
                      ) : (
                        <button
                          type="button"
                          className="btn btn-primary pool-enable-btn"
                          disabled={busy || (poolMethodUsesCash(payMethod) && !dayCashOpen) || !eval_.canEnable}
                          onClick={() => handleEnableMember(selected)}
                        >
                          <UserCheck size={16} /> Habilitar · {formatCurrency(eval_.seasonAmountDue)}
                        </button>
                      )}
                    </>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-primary pool-enable-btn"
                      disabled={busy || !eval_.canEnable}
                      onClick={() => handleEnableMember(selected)}
                    >
                      <UserCheck size={16} /> Habilitar ingreso
                    </button>
                  )}
                  {eval_.blockers.length > 0 ? (
                    <ul className="pool-blockers">
                      {eval_.blockers.map((b) => (
                        <li key={b}><AlertTriangle size={13} /> {b}</li>
                      ))}
                    </ul>
                  ) : null}
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
                  <PaymentMethodTiles
                    value={guestMethod}
                    onChange={setGuestMethod}
                    disabled={busy}
                    ariaLabel="Método de pago del invitado"
                  />
                  {guestMethod === 'efectivo' ? (
                    <p className="pool-pay-note">
                      Confirme el cobro en efectivo. Se registrará en <strong>Caja General</strong>.
                    </p>
                  ) : null}
                  {poolMethodUsesBank(guestMethod) ? (
                    <div className="form-group" style={{ marginBottom: '0.85rem' }}>
                      <label className="form-label" htmlFor="pool-guest-bank">Alias</label>
                      <select
                        id="pool-guest-bank"
                        className="form-input"
                        value={guestBankId}
                        onChange={(e) => setGuestBankId(e.target.value)}
                        disabled={busy}
                      >
                        {CLUB_BANK_ACCOUNTS.map((bank) => (
                          <option key={bank.id} value={bank.id}>
                            {bank.alias || bank.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : null}
                  {guestMethod === 'mercadopago' ? (
                    <MercadoPagoCheckout
                      kind="pool"
                      mode="qr"
                      amount={settings.guestDayFee}
                      memberNumber={selected.memberId}
                      guestName={guestName}
                      concept={`Canon pileta invitado · ${guestName || 'invitado'}`}
                      disabled={busy || !guestName.trim() || hostGuests.length >= settings.maxGuestsPerMember}
                      onApproved={async () => {
                        const rows = await listPoolAccesses();
                        setPoolAccesses(rows);
                        setGuestName('');
                        showFlash('Invitado pago por Mercado Pago');
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={busy || (poolMethodUsesCash(guestMethod) && !dayCashOpen) || !guestName.trim() || hostGuests.length >= settings.maxGuestsPerMember}
                      onClick={handleEnableGuest}
                      style={{ width: '100%', marginTop: '0.65rem' }}
                    >
                      <UserPlus size={16} /> Sumar invitado · {formatCurrency(settings.guestDayFee)}
                    </button>
                  )}
                </div>
              )}

              {selectedHistory.length > 0 ? (
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
            </div>
            ) : null}
          </ModalDialog>
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
        </aside>
      </div>
    </div>
  );
}
