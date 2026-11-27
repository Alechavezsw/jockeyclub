import { useEffect, useMemo, useState } from 'react';
import {
  Waves, Search, UserCheck, Upload, UserPlus,
  CheckCircle2, AlertTriangle, X, Trash2, FileHeart, ClipboardList, Download,
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
  poolSeasonStats,
  poolAccessReportRows,
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
import { downloadPaymentReceiptPdf } from '../../domain/members/exportPaymentReceiptPdf';
import { familyPrincipalOf, memberNumberOf } from '../../domain/members/households';
import { isSupabaseConfigured } from '../../lib/supabase';
import { listHouseholdByPrincipal, listPoolAccesses } from '../../data/repos';
import { poolIngressToAccessLog } from '../../domain/credentials/accessLog';
import { CLUB_BANK_ACCOUNTS } from '../../domain/members/clubBanks';
import { todayISODateAR } from '../../lib/arDate';
import MercadoPagoCheckout from '../MercadoPagoCheckout';
import ModalDialog from '../ModalDialog';
import PaymentMethodTiles from '../PaymentMethodTiles';
import { isDuesExemptMember } from '../../domain/members/dues';

function poolDuesOwed(member) {
  if (!member || isDuesExemptMember(member)) return 0;
  return Number(member.outstandingBalance) || 0;
}

function PoolBoletos({ rows, busyId, onDownload }) {
  if (!rows?.length) return null;
  return (
    <div className="pool-boletos">
      {rows.map((row) => {
        const key = String(row.payment.id || row.payment.receiptNumber || row.member.memberId);
        return (
          <button
            key={key}
            type="button"
            className="btn btn-secondary btn-sm pool-boleto-btn"
            disabled={busyId === key}
            onClick={() => { void onDownload(row.member, row.payment); }}
          >
            <Download size={14} />
            {' '}
            Descargar boleto
            {rows.length > 1 ? ` · ${row.member.name}` : ''}
          </button>
        );
      })}
    </div>
  );
}

function poolBoletoPayment(charged, member, today) {
  return {
    id: charged?.journalEntryId || charged?.cashMovementId || charged?.id,
    receiptNumber: charged?.cashMovementId || charged?.journalEntryId || charged?.id,
    amount: Number(charged?.payment?.amount) || 0,
    date: charged?.date || today,
    method: charged?.payment?.method,
    methodLabel: poolMethodLabel(charged?.payment?.method),
    concept: charged?.payment?.concept || `Canon pileta temporada · ${member?.name || 'socio'}`,
    kind: 'pileta',
  };
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
  const [reportSheet, setReportSheet] = useState('day');
  const [household, setHousehold] = useState([]);
  const [chargeIds, setChargeIds] = useState([]);
  const [boletos, setBoletos] = useState([]);
  const [pdfBusyId, setPdfBusyId] = useState('');

  const selected = useMemo(
    () => members.find((m) => m.memberId === selectedId) || null,
    [members, selectedId]
  );

  const searchHits = useMemo(() => {
    // Misma cota que Acceso / ingreso: pocas mejores coincidencias, no un listado largo.
    return searchPoolMembers(members, query, { limit: 8 }).map((member) => ({
      member,
      snap: evaluatePoolAccess(member, { accesses: poolAccesses, today, settings, members }),
      dues: poolDuesOwed(member),
    }));
  }, [members, query, poolAccesses, today, settings]);

  const roster = useMemo(() => {
    const byId = new Map((members || []).map((row) => [String(row.memberId), row]));
    for (const row of household) {
      if (!byId.has(String(row.memberId))) byId.set(String(row.memberId), row);
    }
    return [...byId.values()];
  }, [members, household]);

  const eval_ = useMemo(
    () => evaluatePoolAccess(selected, { accesses: poolAccesses, today, settings, members: roster }),
    [selected, poolAccesses, today, settings, roster]
  );

  const householdSnaps = useMemo(
    () => household.map((person) => ({
      person,
      snap: evaluatePoolAccess(person, { accesses: poolAccesses, today, settings, members: roster }),
    })),
    [household, poolAccesses, today, settings, roster],
  );

  const chargeTargets = householdSnaps.filter((row) => (
    chargeIds.includes(String(row.person.memberId)) && row.snap.canPayCanon
  ));
  const paying = chargeTargets.length
    ? chargeTargets
    : (eval_.canPayCanon && selected ? [{ person: selected, snap: eval_ }] : []);

  const dayList = useMemo(() => listDayAccesses(poolAccesses, today), [poolAccesses, today]);
  const stats = useMemo(() => poolDayStats(poolAccesses, today), [poolAccesses, today]);
  const seasonStats = useMemo(() => poolSeasonStats(poolAccesses, today), [poolAccesses, today]);
  const reportRows = useMemo(
    () => poolAccessReportRows(poolAccesses, {
      scope: reportSheet === 'season' ? 'season' : 'day',
      today,
    }),
    [poolAccesses, reportSheet, today],
  );
  const hostGuests = selected
    ? guestDayAccessesForHost(poolAccesses, selected.memberId, today)
    : [];
  const selectedHistory = useMemo(
    () => (selected ? memberPoolHistory(poolAccesses, selected.memberId).slice(0, 12) : []),
    [poolAccesses, selected],
  );
  const selectedDues = poolDuesOwed(selected);
  const householdPrincipal = selected
    ? (familyPrincipalOf(selected) || memberNumberOf(selected) || '')
    : '';
  // Lo que dice la base manda: el operario de pileta no puede leer las sesiones de caja y
  // deducirlo de ellas lo mostraría cerrado después de recargar.
  const dayCashOpen = typeof dayCashOpenProp === 'boolean'
    ? dayCashOpenProp
    : isPoolDayCashOpen(cashSessions, cashRegisters);

  useEffect(() => {
    if (typeof onRefreshDayCash === 'function') void onRefreshDayCash();
  }, [onRefreshDayCash]);

  useEffect(() => {
    if (!selected) {
      setHousehold([]);
      setChargeIds([]);
      return undefined;
    }
    const local = (members || []).filter((row) => {
      const self = memberNumberOf(row);
      const group = familyPrincipalOf(row);
      return self === householdPrincipal || group === householdPrincipal;
    });
    setHousehold(local.length ? local : [selected]);
    setChargeIds([String(selected.memberId)]);
    if (!householdPrincipal || !isSupabaseConfigured) return undefined;
    let cancel = false;
    listHouseholdByPrincipal(householdPrincipal).then((rows) => {
      if (cancel || !Array.isArray(rows) || !rows.length) return;
      const byNumber = new Map((members || []).map((row) => [String(row.memberId), row]));
      setHousehold(rows.map((row) => {
        const localRow = byNumber.get(String(row.memberId));
        return localRow
          ? { ...row, ...localRow, birthDate: localRow.birthDate || row.birthDate }
          : row;
      }));
    }).catch(() => {});
    return () => { cancel = true; };
  }, [householdPrincipal]);

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
      showFlash(`Apto médico cargado · ${selected.name}`);
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
      showFlash(`Apto médico · talón ${ticket} · ${selected.name}`);
    } catch (err) {
      setError(err?.message || 'No se pudo marcar la revisación.');
    } finally {
      setBusy(false);
    }
  };

  const rememberBoleto = (charged, member) => {
    const payment = poolBoletoPayment(charged, member, today);
    if (!(payment.amount > 0)) return payment;
    setBoletos((prev) => [ { member, payment }, ...prev.filter((row) => row.payment.id !== payment.id) ]);
    return payment;
  };

  const handleDownloadBoleto = async (member, payment) => {
    if (!member || !payment) return;
    const key = String(payment.id || payment.receiptNumber || member.memberId);
    setPdfBusyId(key);
    setError('');
    try {
      await downloadPaymentReceiptPdf({ member, payment });
    } catch (err) {
      setError(err?.message || 'No se pudo descargar el boleto.');
    } finally {
      setPdfBusyId('');
    }
  };

  const settleCanon = async (person, accesses) => {
    const { entry, accesses: next } = enableMemberPoolAccess({
      member: person,
      accesses,
      method: payMethod,
      today,
      settings,
      actorName,
      members: roster,
      requireMedical: false,
    });
    const amountDue = Number(entry.payment?.amount) || 0;
    if (amountDue <= 0) {
      return { accesses: next, charged: entry, payment: null };
    }
    const charged = await chargePoolCanon({
      entry,
      member: person,
      recordPoolCanon,
      bankId: poolMethodUsesBank(payMethod) ? payBankId : null,
    });
    const circle = verifyPoolCanonCircle({ entry, charged, method: payMethod });
    if (!circle.ok) {
      throw new Error(`Canon incompleto: ${circle.issues.join(' · ')}`);
    }
    for (const row of charged.accountEntries || []) onUpsertMemberAccountEntry?.(row);
    if (typeof setMembers === 'function' && charged.accountEntries?.length) {
      setMembers((prev) => applyPoolAccountPass(prev, charged.accountEntries));
    }
    if (typeof setEntryLogs === 'function') {
      const log = poolIngressToAccessLog(charged);
      if (log) setEntryLogs((prev) => [log, ...(prev || [])]);
    }
    const payment = rememberBoleto(charged, person);
    if (payment.method !== 'mercadopago') {
      void deliverPaymentReceipt({
        member: person,
        payment,
        onSendMessage,
        kind: 'pileta',
      });
    }
    return { accesses: withChargedPoolEntry(next, entry, charged), charged, payment };
  };

  const handleChargeCanon = async (people = []) => {
    if (!people.length) {
      setError('Elegí al menos una persona del grupo con canon pendiente.');
      return;
    }
    if (payMethod === 'mercadopago') {
      setError('Usá el QR de Mercado Pago para este medio.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      let accesses = poolAccesses;
      const names = [];
      for (const person of people) {
        const snap = evaluatePoolAccess(person, {
          accesses,
          today,
          settings,
          members: roster,
        });
        if (!snap.canPayCanon) continue;
        const settled = await settleCanon(person, accesses);
        accesses = settled.accesses;
        setPoolAccesses(accesses);
        names.push(person.name);
      }
      if (!names.length) {
        setError('Esas personas no tienen canon pendiente.');
        return;
      }
      showFlash(names.length > 1
        ? `Canon cobrado · ${names.length} personas`
        : `Canon cobrado · ${names[0] || 'socio'}`);
    } catch (err) {
      setError(err?.message || 'No se pudo cobrar el canon.');
    } finally {
      setBusy(false);
    }
  };

  const handleEnableMember = async (member = selected) => {
    if (!member) return;
    const snap = evaluatePoolAccess(member, { accesses: poolAccesses, today, settings, members: roster });
    if (snap.payBlocked || snap.duesBlocked) {
      setError('En mora · regularizá la cuota para pagar pileta.');
      return;
    }
    if (!snap.medical?.ok) {
      setError('Falta el apto médico para anotar el ingreso.');
      return;
    }
    setSelectedId(member.memberId);
    setBusy(true);
    setError('');
    try {
      if ((Number(snap.seasonAmountDue) || 0) > 0) {
        const settled = await settleCanon(member, poolAccesses);
        setPoolAccesses(settled.accesses);
        showFlash(`Habilitado · ${member.name}`);
        return;
      }
      const { entry, accesses } = enableMemberPoolAccess({
        member,
        accesses: poolAccesses,
        method: payMethod,
        today,
        settings,
        actorName,
        members: roster,
      });
      setPoolAccesses(accesses);
      if (typeof setEntryLogs === 'function') {
        const log = poolIngressToAccessLog(entry);
        if (log) setEntryLogs((prev) => [log, ...(prev || [])]);
      }
      showFlash(`Ingreso anotado · ${member.name}`);
    } catch (err) {
      setError(err?.message || 'No se pudo anotar el ingreso.');
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
          <div className="pool-lanes" aria-hidden="true"><i /><i /><i /><i /></div>
          <p>
            Habilitar cobra el canon de temporada: efectivo en Caja General, transferencia o débito en el banco,
            Pago POS en tarjetas a cobrar. Mercado Pago se acredita cuando confirma. No es la cuota social.
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
                ? (searchHits.length
                  ? `${searchHits.length.toLocaleString('es-AR')} mejor${searchHits.length === 1 ? '' : 'es'} coincidencia${searchHits.length === 1 ? '' : 's'} · afiná con DNI o Nº`
                  : 'Sin coincidencias · probá DNI o número de socio')
                : 'Apellido y nombre, DNI o Nº de socio. Se muestran hasta 8 resultados.'}
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
                      onClick={() => {
                        setSelectedId(m.memberId);
                        setError('');
                      }}
                    >
                      <UserCheck size={15} /> {snap.canPayCanon ? 'Cobrar' : 'Ficha'}
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

              {householdSnaps.length > 0 ? (
                <section className="pool-household" aria-label="Grupo familiar">
                  <h4>Grupo familiar</h4>
                  <ul className="pool-household-list">
                    {householdSnaps.map(({ person, snap }) => {
                      const id = String(person.memberId);
                      const checked = chargeIds.includes(id);
                      const owes = snap.canPayCanon;
                      return (
                        <li key={id} className={id === String(selected.memberId) ? 'is-on' : ''}>
                          <label>
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={busy || !owes}
                              onChange={() => {
                                setChargeIds((curr) => (
                                  curr.includes(id)
                                    ? curr.filter((item) => item !== id)
                                    : [...curr, id]
                                ));
                              }}
                              aria-label={`Cobrar canon de ${person.name}`}
                            />
                          </label>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedId(person.memberId);
                              setError('');
                            }}
                          >
                            <strong>{person.name}</strong>
                            <span>Nº {person.memberId}</span>
                          </button>
                          <em>
                            {owes
                              ? formatCurrency(snap.seasonAmountDue)
                              : (snap.seasonPaid ? 'Abonado' : (snap.seasonReason || 'Sin cargo'))}
                          </em>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ) : null}

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
                  <strong>Apto médico</strong>
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
                      <p className="pool-pay-note">Se puede marcar ahora o después de cobrar el canon.</p>
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
                  {paying.length > 0 ? (
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
                          disabled={busy || !eval_.canPayCanon}
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
                          disabled={
                            busy
                            || (poolMethodUsesCash(payMethod) && !dayCashOpen)
                            || paying.length === 0
                          }
                          onClick={() => { void handleChargeCanon(paying.map((row) => row.person)); }}
                        >
                          <UserCheck size={16} />
                          {' '}
                          Cobrar
                          {paying.length > 1 ? ` ${paying.length}` : ''}
                          {' · '}
                          {formatCurrency(paying.reduce((sum, row) => sum + (Number(row.snap.seasonAmountDue) || 0), 0))}
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
                  {eval_.blockers.filter((line) => line !== eval_.medical?.label).length > 0 ? (
                    <ul className="pool-blockers">
                      {eval_.blockers.filter((line) => line !== eval_.medical?.label).map((b) => (
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

              <PoolBoletos
                rows={boletos.filter((row) => (
                  String(row.member.memberId) === String(selected.memberId)
                  || chargeIds.includes(String(row.member.memberId))
                ))}
                busyId={pdfBusyId}
                onDownload={handleDownloadBoleto}
              />

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
                        {(Number(row.payment?.amount) || 0) > 0 ? (
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm pool-boleto-btn"
                            disabled={pdfBusyId === String(row.journalEntryId || row.cashMovementId || row.id)}
                            onClick={() => { void handleDownloadBoleto(selected, poolBoletoPayment(row, selected, today)); }}
                          >
                            <Download size={13} /> Boleto
                          </button>
                        ) : null}
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
            <p className="ops-muted" style={{ marginTop: '0.45rem' }}>
              {dayList.length
                ? `${dayList.length} · el detalle completo está en Resumen.`
                : 'Todavía no hay ingresos registrados.'}
            </p>
            {dayList.length > 0 ? (
              <ul className="pool-day-list">
                {dayList.slice(0, 8).map((a) => (
                  <li key={a.id}>
                    <div>
                      <strong>{a.kind === 'guest' ? a.guestName : a.memberName}</strong>
                      <span>
                        {a.kind === 'guest' ? `Invitado de ${a.memberName}` : 'Socio'}
                        {' · '}
                        {a.payment?.method === 'asistencia'
                          ? 'Asistió'
                          : `${formatCurrency(a.payment?.amount || 0)} · ${poolMethodLabel(a.payment?.method) || '—'}`}
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
            ) : null}
          </section>
        </aside>
      </div>

      <section className="glass-card pool-panel pool-stats-panel">
        <h3><ClipboardList size={16} aria-hidden="true" /> Resumen</h3>
        <p className="pool-stats-note">
          {seasonStats.live ? 'Temporada en curso' : 'Última temporada'}
          {': '}
          {seasonStats.open}
          {' → '}
          {seasonStats.close}
          . Mismos números que el día y el cobro de pileta; no es la cuota social.
        </p>
        <div className="pool-kpi-grid">
          <article><span>Socios hoy</span><strong>{seasonStats.dayMembers}</strong></article>
          <article><span>Invitados hoy</span><strong>{seasonStats.dayGuests}</strong></article>
          <article><span>Canon hoy</span><strong>{formatCurrency(seasonStats.dayCollected)}</strong></article>
          <article><span>Socios temporada</span><strong>{seasonStats.seasonMembers}</strong></article>
          <article><span>Invitados temporada</span><strong>{seasonStats.seasonGuests}</strong></article>
          <article><span>Ingresos temporada</span><strong>{seasonStats.seasonEntries}</strong></article>
          <article><span>Canon temporada</span><strong>{formatCurrency(seasonStats.seasonCollected)}</strong></article>
          <article><span>Revocados</span><strong>{seasonStats.revoked}</strong></article>
        </div>
        <div className="pool-sheets" role="tablist" aria-label="Hojas de pileta">
          <button
            type="button"
            role="tab"
            aria-selected={reportSheet === 'day'}
            className={reportSheet === 'day' ? 'is-on' : ''}
            onClick={() => setReportSheet('day')}
          >
            Hoy
            <b>{stats.total}</b>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={reportSheet === 'season'}
            className={reportSheet === 'season' ? 'is-on' : ''}
            onClick={() => setReportSheet('season')}
          >
            Temporada
            <b>{seasonStats.seasonEntries}</b>
          </button>
        </div>
        <div className="table-container">
          <table className="admin-table pool-account-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Quién</th>
                <th>Tipo</th>
                <th>Anfitrión</th>
                <th>Importe</th>
                <th>Medio</th>
                <th>Estado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {reportRows.map((row) => (
                <tr key={row.id}>
                  <td>{row.date}</td>
                  <td>
                    <strong>{row.who}</strong>
                    {row.memberId && row.kind === 'Socio' ? (
                      <span className="muted"> Nº {row.memberId}</span>
                    ) : null}
                  </td>
                  <td>{row.kind}</td>
                  <td>{row.host}</td>
                  <td>{row.amount > 0 ? formatCurrency(row.amount) : '—'}</td>
                  <td>{row.method}</td>
                  <td>{row.status}</td>
                  <td>
                    {row.status === 'Activo' && reportSheet === 'day' ? (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        title="Revocar"
                        onClick={() => setPoolAccesses(revokePoolAccess(poolAccesses, row.id))}
                      >
                        <Trash2 size={13} />
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
              {!reportRows.length ? (
                <tr>
                  <td colSpan={8} className="muted">
                    {reportSheet === 'day'
                      ? 'Todavía no hay ingresos de hoy.'
                      : 'Sin ingresos en esta temporada.'}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
