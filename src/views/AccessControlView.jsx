import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, CheckCircle2, AlertCircle, Camera, CameraOff, History, CalendarRange,
} from 'lucide-react';
import { parseCredentialQRPayload } from '../domain/credentials/qr';
import { createCredentialVerifier } from '../domain/credentials/credentialCheck';
import { parseGuestPassPayload, isGuestPassValid } from '../domain/credentials/guestPass';
import {
  accessLogsForClubDay,
  buildAccessLogEntry,
  GATE_HISTORY_PAGE,
  recentEntryFor,
  recentEntryLabel,
  tierToGroup,
} from '../domain/credentials/accessLog';
import { todayISODateAR } from '../lib/arDate';
import { mergePoolSearchHits, mergePoolSettings, searchPoolMembers } from '../domain/pool/poolAccess';
import { isPoolSeasonLive } from '../domain/pool/poolSeason';
import { accountHolderOf, SEASON_DUES_GATE_COPY, seasonDuesGate } from '../domain/pool/seasonDuesGate';
import { isActiveReservation, reservationDay } from '../domain/reservations/memberBookings';
import {
  getGuestPassById,
  getMemberByNumber,
  searchMembersDirectory,
  verifyMemberCredential,
} from '../data/repos';
import { isSupabaseConfigured } from '../lib/supabase';
import { useWakeLock } from '../hooks/useWakeLock';
import QrLiveScanner from '../components/QrLiveScanner';

function reservationStatusLabel(status) {
  const s = String(status || 'confirmed').toLowerCase();
  if (s === 'pending') return 'Pendiente';
  if (s === 'approved' || s === 'confirmed') return 'OK';
  return s || 'OK';
}

/** Cuánto queda el cartel. Una credencial distinta lo reemplaza al instante; la misma no se vuelve a leer. */
const COOLDOWN_MS = 2200;

let sharedAudioCtx = null;

/** Un solo AudioContext para todo el turno: crear uno por lectura los acumulaba hasta que el navegador dejaba de sonar. */
function audioContext() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') sharedAudioCtx = new Ctx();
  if (sharedAudioCtx.state === 'suspended') void sharedAudioCtx.resume();
  return sharedAudioCtx;
}

function playBeep(success) {
  try {
    navigator.vibrate?.(success ? 40 : [60, 40, 60]);
  } catch {
    /* sin vibración */
  }
  try {
    const audioCtx = audioContext();
    if (!audioCtx) return;
    if (success) {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.005, audioCtx.currentTime + 0.18);
      osc.start(audioCtx.currentTime);
      osc.stop(audioCtx.currentTime + 0.18);
    } else {
      const buzz = (delay) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(140, audioCtx.currentTime + delay);
        gain.gain.setValueAtTime(0.12, audioCtx.currentTime + delay);
        gain.gain.exponentialRampToValueAtTime(0.005, audioCtx.currentTime + delay + 0.22);
        osc.start(audioCtx.currentTime + delay);
        osc.stop(audioCtx.currentTime + delay + 0.22);
      };
      buzz(0);
      buzz(0.24);
    }
  } catch {
    /* ignore */
  }
}

/**
 * Página de acceso / molinete — responsive (móvil, tablet y escritorio).
 * Lee el QR de la tarjeta virtual del socio.
 */
export default function AccessControlView({
  members = [],
  entryLogs = [],
  setEntryLogs,
  formatCurrency,
  guestPasses = [],
  poolSettings,
  reservations = [],
  operatorName = '',
}) {
  const navigate = useNavigate();
  const cooldownTimerRef = useRef(null);
  const lastPayloadRef = useRef({ raw: '', at: 0 });
  const lastAdmitRef = useRef({ id: '', at: 0 });
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [result, setResult] = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const [remoteHits, setRemoteHits] = useState([]);
  const [manualHint, setManualHint] = useState('');
  const [cameraLive, setCameraLive] = useState(false);
  const [scannerGen, setScannerGen] = useState(0);
  const [clubDay, setClubDay] = useState(() => todayISODateAR());
  const [historyShown, setHistoryShown] = useState(GATE_HISTORY_PAGE);
  const manualRef = useRef(null);
  const poolCfg = mergePoolSettings(poolSettings);

  // Cuánto dura el cartel. No frena la cámara: la credencial siguiente lo reemplaza al instante.
  const beginCooldown = useCallback((ms = COOLDOWN_MS) => {
    if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current);
    cooldownTimerRef.current = setTimeout(() => {
      setResult(null);
      cooldownTimerRef.current = null;
    }, ms);
  }, []);

  const [verifier] = useState(() => createCredentialVerifier({
    verifyRemote: verifyMemberCredential,
    fetchMember: getMemberByNumber,
  }));

  // La pantalla de la tablet no se duerme mientras el molinete está abierto.
  useWakeLock(true);

  const stopCamera = useCallback(() => {
    setCameraOn(false);
    setCameraLive(false);
    setCameraError('');
  }, []);

  const admitMember = useCallback((member) => {
    if (!member) return;
    // La misma ficha dos veces en un instante (doble toque, doble lectura) cuenta una sola vez.
    const nowMs = Date.now();
    if (lastAdmitRef.current.id === member.memberId && nowMs - lastAdmitRef.current.at < 1500) return;
    lastAdmitRef.current = { id: member.memberId, at: nowMs };

    const isSuspended = member.status !== 'active';
    const duesGate = seasonDuesGate(member, { today: clubDay, settings: poolCfg, members });
    // El adherente no tiene cuenta propia: la deuda y la mora son las del titular.
    const holder = accountHolderOf(member, members);
    const owed = Number(holder?.outstandingBalance) || 0;
    const hasDebt = owed > 0;
    const isAllowed = !isSuspended && !duesGate.blocked;
    const status = isAllowed ? 'granted' : 'denied';
    const debtNote = holder !== member ? 'Deuda del titular' : 'Deuda';
    const notes = isSuspended
      ? 'Cuenta suspendida'
      : duesGate.blocked
        ? duesGate.reason
        : hasDebt
          ? `Ingreso OK · ${debtNote} ${formatCurrency(owed)}`
          : 'Acceso aprobado · Sin deuda pendiente';

    // Misma credencial dos veces en poco rato: un QR prestado o mandado por WhatsApp se nota así.
    // Solo avisa; quien decide es el portero (puede haber salido y vuelto).
    const repeat = isAllowed ? recentEntryFor(entryLogs, member.memberId) : null;
    const warning = repeat ? recentEntryLabel(repeat) : '';

    setResult({
      status,
      title: isAllowed ? (hasDebt ? 'ACCESO CON DEUDA' : 'ACCESO AUTORIZADO') : (duesGate.blocked ? 'ACCESO DENEGADO · MORA' : 'ACCESO DENEGADO'),
      detail: `${member.name} · ${isAllowed ? (member.tier?.toUpperCase() || 'SOCIO') : notes}`,
      warning,
      memberName: member.name,
      photo: member.photo,
    });
    playBeep(isAllowed);
    setEntryLogs((prev) => [
      buildAccessLogEntry({
        memberName: member.name,
        memberId: member.memberId,
        role: tierToGroup(member.tier),
        group: tierToGroup(member.tier),
        activity: isSuspended
          ? 'Acceso denegado'
          : duesGate.blocked
            ? 'Acceso denegado · mora'
            : hasDebt
              ? 'Ingreso con deuda'
              : 'Ingreso sede',
        status,
        notes: warning ? `${notes} · ${warning}` : notes,
        operator: operatorName,
      }),
      ...(prev || []),
    ]);
    setManualCode('');
    setManualHint('');
    setRemoteHits([]);
    beginCooldown(warning ? COOLDOWN_MS + 1200 : COOLDOWN_MS);
  }, [formatCurrency, setEntryLogs, beginCooldown, clubDay, poolCfg, members, entryLogs, operatorName]);

  /** Lectura que no se pudo resolver por falta de conexión: no es un rechazo, y se anota aparte. */
  const showUnverified = useCallback((who, detail, notes) => {
    setResult({
      status: 'denied',
      tone: 'warn',
      title: 'NO SE PUDO VERIFICAR',
      detail,
      memberName: null,
    });
    playBeep(false);
    setEntryLogs((prev) => [
      buildAccessLogEntry({
        memberName: who,
        memberId: null,
        role: '—',
        group: '—',
        activity: 'Sin verificar',
        status: 'denied',
        notes,
        operator: operatorName,
      }),
      ...(prev || []),
    ]);
    beginCooldown(4000);
  }, [setEntryLogs, beginCooldown, operatorName]);

  const processPayload = useCallback(async (raw, { allowUnsignedNumber = false } = {}) => {
    const text = String(raw || '');
    // La misma credencial todavía frente a la cámara no se procesa de nuevo; una distinta sí, al instante.
    const nowMs = Date.now();
    if (lastPayloadRef.current.raw === text && nowMs - lastPayloadRef.current.at < COOLDOWN_MS) return;
    lastPayloadRef.current = { raw: text, at: nowMs };

    const guestParsed = parseGuestPassPayload(text);
    if (guestParsed) {
      let pass = (guestPasses || []).find((p) => p.id === guestParsed.id);
      let lookupFailed = false;
      if (!pass && isSupabaseConfigured) {
        // La lista de pases se carga al entrar: uno que el socio generó después no está. Se pide a la base.
        try {
          pass = await getGuestPassById(guestParsed.id);
        } catch {
          lookupFailed = true;
        }
      }
      let host = members.find((m) => m.memberId === guestParsed.hostMemberId);
      if (!host && isSupabaseConfigured && pass) {
        try {
          host = await getMemberByNumber(guestParsed.hostMemberId);
        } catch {
          lookupFailed = true;
        }
      }
      if (!pass && lookupFailed) {
        showUnverified(
          'Invitado',
          'Sin conexión para consultar el pase. Reintentá en unos segundos o dejalo pasar con el socio anfitrión.',
          'Pase de invitado sin verificar: sin conexión',
        );
        return;
      }
      const hostBlocked = host
        ? seasonDuesGate(host, { today: clubDay, settings: poolCfg, members }).blocked
        : false;
      const valid = pass && isGuestPassValid(pass, { parsed: guestParsed }) && host?.status === 'active' && !hostBlocked;
      setResult({
        status: valid ? 'granted' : 'denied',
        title: valid ? 'INVITADO AUTORIZADO' : (hostBlocked ? 'ANFITRIÓN EN MORA' : 'PASE INVÁLIDO'),
        detail: valid
          ? `${pass.guestName} · invitado de ${host?.name || 'socio'}`
          : hostBlocked
            ? 'El socio anfitrión no regularizó la cuota del mes.'
            : 'Pase vencido, revocado o no registrado.',
        memberName: pass?.guestName || null,
      });
      playBeep(valid);
      setEntryLogs((prev) => [
        buildAccessLogEntry({
          memberName: pass?.guestName ? `${pass.guestName} (invitado)` : 'Invitado',
          memberId: host?.memberId || guestParsed.hostMemberId,
          role: 'Invitado del día',
          group: 'Invitado',
          activity: valid ? 'Pase invitado' : 'Acceso denegado',
          status: valid ? 'granted' : 'denied',
          notes: valid
            ? `Pase ${pass.id} · anfitrión ${host?.name || ''}`
            : hostBlocked
              ? 'Anfitrión en mora'
              : 'Pase vencido, revocado o no registrado',
          operator: operatorName,
        }),
        ...(prev || []),
      ]);
      beginCooldown();
      return;
    }

    const parsed = parseCredentialQRPayload(text);
    const memberId = parsed?.memberId || null;
    if (!memberId || (!parsed.signed && !allowUnsignedNumber)) {
      setResult({
        status: 'denied',
        title: 'QR no válido',
        detail: parsed && !parsed.signed
          ? 'Esta credencial no está firmada. Pedí al socio que abra la app o ingresá el número a mano.'
          : 'Acercá la credencial digital del Jockey Club (pantalla completa).',
        memberName: null,
      });
      playBeep(false);
      setEntryLogs((prev) => [
        buildAccessLogEntry({
          memberName: 'Desconocido',
          memberId: null,
          role: '—',
          group: '—',
          activity: 'QR inválido',
          status: 'denied',
          notes: 'QR no válido / no es credencial Jockey Club',
          operator: operatorName,
        }),
        ...(prev || []),
      ]);
      beginCooldown(1600);
      return;
    }

    let member = members.find((m) => m.memberId === memberId);

    if (parsed.signed) {
      // El servidor dice si la firma es la de este socio (y se acuerda un turno). Nunca se baja la firma.
      const check = await verifier.verify(memberId, parsed.token, { member });
      if (check.status === 'unreachable') {
        showUnverified(
          'Sin verificar',
          'Sin conexión con el padrón: no se pudo comprobar la firma. Buscá al socio por DNI o número y dejalo pasar a mano.',
          `Credencial ${memberId}: no se pudo verificar la firma (sin conexión)`,
        );
        return;
      }
      if (check.status === 'invalid') {
        setResult({
          status: 'denied',
          title: 'QR adulterado',
          detail: 'La firma de la credencial no coincide con el padrón.',
          memberName: null,
        });
        playBeep(false);
        setEntryLogs((prev) => [
          buildAccessLogEntry({
            memberName: 'Firma inválida',
            memberId,
            role: '—',
            group: '—',
            activity: 'QR adulterado',
            status: 'denied',
            notes: 'Token de credencial no coincide',
            operator: operatorName,
          }),
          ...(prev || []),
        ]);
        beginCooldown();
        return;
      }
    }

    if (!member && isSupabaseConfigured) {
      // El padrón en memoria todavía no lo tiene (carga de a poco): se pide solo ese socio.
      try {
        member = await getMemberByNumber(memberId);
      } catch {
        /* sin red: queda como no encontrado */
      }
    }
    if (!member) {
      setResult({
        status: 'denied',
        title: 'Socio no encontrado',
        detail: `Credencial ${memberId.slice(0, 8)}… no figura en el padrón.`,
        memberName: null,
      });
      playBeep(false);
      setEntryLogs((prev) => [
        buildAccessLogEntry({
          memberName: 'No empadronado',
          memberId,
          role: '—',
          group: '—',
          activity: 'No empadronado',
          status: 'denied',
          notes: `Credencial ${memberId} no figura en el padrón`,
          operator: operatorName,
        }),
        ...(prev || []),
      ]);
      beginCooldown();
      return;
    }

    admitMember(member);
  }, [members, guestPasses, setEntryLogs, beginCooldown, admitMember, showUnverified, verifier, clubDay, poolCfg, operatorName]);

  // El lector llama siempre a la versión más nueva sin reiniciar la cámara cada vez que cambia algo.
  const processRef = useRef(processPayload);
  useEffect(() => {
    processRef.current = processPayload;
  }, [processPayload]);
  const handleDecode = useCallback((raw) => {
    void processRef.current?.(raw);
  }, []);

  const startCamera = useCallback(() => {
    setCameraError('');
    setResult(null);
    setCameraLive(false);
    setCameraOn(true);
    setScannerGen((n) => n + 1);
  }, []);

  const handleCameraError = useCallback((msg) => {
    const text = String(msg || '').trim() || 'No se pudo iniciar la cámara en este navegador.';
    setCameraError(text);
    setCameraOn(false);
    setCameraLive(false);
  }, []);

  useEffect(() => {
    if (!cameraError) return undefined;
    const id = window.setTimeout(() => manualRef.current?.focus(), 60);
    return () => window.clearTimeout(id);
  }, [cameraError]);

  useEffect(() => () => {
    if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current);
  }, []);

  const localHits = useMemo(
    () => searchPoolMembers(members, manualCode, { limit: 8 }),
    [members, manualCode],
  );
  const hits = useMemo(
    () => mergePoolSearchHits(localHits, remoteHits, { limit: 8 }),
    [localHits, remoteHits],
  );

  useEffect(() => {
    const raw = manualCode.trim();
    const digits = raw.replace(/\D/g, '');
    const enough = raw.length >= 2 || digits.length >= 3;
    if (!enough || !isSupabaseConfigured) {
      setRemoteHits([]);
      return undefined;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      searchMembersDirectory(raw, { limit: 12 })
        .then((rows) => {
          if (!cancelled) setRemoteHits(rows || []);
        })
        .catch(() => {
          if (!cancelled) setRemoteHits([]);
        });
    }, 160);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [manualCode]);

  const pickExactHit = (list, raw) => {
    const digits = String(raw || '').replace(/\D/g, '');
    if (digits) {
      const byDni = list.filter((m) => String(m.documentNumber || '').replace(/\D/g, '') === digits);
      if (byDni.length === 1) return byDni[0];
      const byNro = list.filter((m) => String(m.memberId || '').replace(/\D/g, '') === digits);
      if (byNro.length === 1) return byNro[0];
    }
    if (list.length === 1) return list[0];
    return null;
  };

  useEffect(() => {
    const tick = () => {
      const next = todayISODateAR();
      setClubDay((prev) => (prev === next ? prev : next));
    };
    const id = window.setInterval(tick, 30_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    setHistoryShown(GATE_HISTORY_PAGE);
  }, [clubDay]);

  const todayLogs = useMemo(
    () => accessLogsForClubDay(entryLogs, clubDay),
    [entryLogs, clubDay],
  );
  const visibleLogs = todayLogs.slice(0, historyShown);
  const hasMoreToday = todayLogs.length > historyShown;
  const todayReservations = useMemo(
    () => (reservations || [])
      .filter((res) => (
        !res?.occupancyOnly
        && isActiveReservation(res)
        && reservationDay(res) === clubDay
      ))
      .toSorted((a, b) => {
        const ta = String(a.time || a.time_slot || '');
        const tb = String(b.time || b.time_slot || '');
        if (ta !== tb) return ta.localeCompare(tb);
        return String(a.memberName || '').localeCompare(String(b.memberName || ''), 'es');
      }),
    [reservations, clubDay],
  );

  const resultCard = result ? (
    <div className={`access-result-card ${result.status}${result.tone ? ` ${result.tone}` : ''}`} role="status" aria-live="assertive">
      {result.photo ? (
        <img
          src={result.photo}
          alt=""
          width={64}
          height={64}
          className="access-result-photo"
        />
      ) : null}
      {result.status === 'granted'
        ? <CheckCircle2 size={44} aria-hidden="true" />
        : <AlertCircle size={44} aria-hidden="true" />}
      <h2 className="serif-font access-result-title">{result.title}</h2>
      <p className="access-result-detail">{result.detail}</p>
      {result.warning ? <p className="access-result-warning">{result.warning}</p> : null}
    </div>
  ) : null;

  return (
    <div className="access-gate fade-in">
      <style>{`
        .access-gate {
          min-height: 100dvh;
          width: 100%;
          margin: 0 auto;
          padding:
            max(0.65rem, env(safe-area-inset-top))
            max(1rem, env(safe-area-inset-right))
            max(1.25rem, env(safe-area-inset-bottom))
            max(1rem, env(safe-area-inset-left));
          display: flex;
          flex-direction: column;
          align-items: center;
          box-sizing: border-box;
          background:
            radial-gradient(ellipse at 50% 0%, rgba(var(--primary-gold-rgb),0.14), transparent 52%),
            var(--bg-primary, #060e0a);
        }
        .access-gate-stack {
          width: 100%;
          max-width: 26.5rem;
          display: flex;
          flex-direction: column;
          gap: 0.85rem;
          flex: 1;
        }
        .access-gate-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 0.5rem;
        }
        .access-gate-brand {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          min-width: 0;
        }
        .access-gate-brand img {
          width: 44px;
          height: 44px;
          flex-shrink: 0;
        }
        .access-gate .season-dues-rule {
          margin: 0;
          font-size: 0.72rem;
          line-height: 1.35;
          color: var(--text-muted);
          text-align: center;
        }
        .access-panel {
          display: flex;
          flex-direction: column;
          gap: 0.85rem;
          padding: 1rem 1rem 1.1rem;
          border: 1px solid var(--border-glass);
          border-radius: 18px;
          background: var(--bg-secondary);
        }
        .access-manual {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
          text-align: center;
        }
        .access-manual-label {
          font-size: 0.7rem;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--text-muted);
        }
        .access-manual-row {
          display: flex;
          flex-direction: column;
          gap: 0.55rem;
        }
        .access-manual .form-input {
          width: 100%;
          min-height: 52px;
          font-size: 1.05rem;
          text-align: center;
          border-radius: 14px;
        }
        .access-manual .btn,
        .access-actions .btn {
          width: 100%;
          min-height: 52px;
          font-weight: 700;
          font-size: 1rem;
          border-radius: 14px;
        }
        .access-manual-hint {
          margin: 0;
          font-size: 0.74rem;
          line-height: 1.4;
          color: var(--text-muted);
        }
        .access-manual-hits {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 0.4rem;
          max-height: min(40vh, 260px);
          overflow-y: auto;
          text-align: left;
        }
        .access-manual-hits button {
          width: 100%;
          text-align: left;
          padding: 0.7rem 0.85rem;
          border-radius: 12px;
          border: 1px solid var(--border-glass);
          background: var(--bg-tertiary);
          color: inherit;
          font: inherit;
          cursor: pointer;
          display: flex;
          flex-direction: column;
          gap: 0.15rem;
          min-height: 52px;
        }
        .access-manual-hits button:active {
          border-color: color-mix(in srgb, var(--primary-gold) 55%, var(--border-glass));
        }
        .access-manual-hits strong {
          font-size: 0.95rem;
          color: var(--text-primary);
        }
        .access-manual-hits span {
          font-size: 0.74rem;
          color: var(--text-muted);
          font-variant-numeric: tabular-nums;
        }
        .access-actions {
          display: grid;
          gap: 0.5rem;
        }
        .access-camera-error {
          margin: 0;
          font-size: 0.8rem;
          line-height: 1.35;
          color: var(--danger-accent);
          text-align: center;
        }
        .access-scanner-shell {
          position: relative;
          border-radius: 18px;
          overflow: hidden;
          border: 1px solid var(--border-glass);
          background: #020804;
          width: 100%;
          aspect-ratio: 3 / 4;
          min-height: 280px;
          max-height: min(58dvh, 520px);
          box-shadow: 0 0 0 1px rgba(var(--primary-gold-rgb),0.15), 0 14px 36px rgba(0,0,0,0.4);
        }
        .access-scanner-shell .qr-live {
          border-radius: 18px;
        }
        .access-result-card {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 0.35rem;
          padding: 1.15rem 1rem;
          border-radius: 18px;
          text-align: center;
        }
        .access-result-card.granted {
          background: rgba(6, 40, 28, 0.92);
          color: var(--emerald-accent);
          border: 1px solid rgba(46, 160, 110, 0.35);
        }
        .access-result-card.denied {
          background: rgba(40, 10, 10, 0.94);
          color: var(--danger-accent);
          border: 1px solid rgba(200, 70, 70, 0.35);
        }
        .access-result-card.denied.warn {
          background: rgba(52, 36, 6, 0.94);
          color: #f4c15d;
          border: 1px solid rgba(244, 193, 93, 0.4);
        }
        .access-result-photo {
          width: 64px;
          height: 64px;
          border-radius: 16px;
          object-fit: cover;
          border: 2px solid currentColor;
          margin-bottom: 0.25rem;
        }
        .access-result-title {
          margin: 0.15rem 0 0;
          font-size: 1.35rem;
          letter-spacing: 0.04em;
        }
        .access-result-detail {
          margin: 0.2rem 0 0;
          font-size: 0.9rem;
          color: #fff;
          opacity: 0.92;
          line-height: 1.35;
        }
        .access-result-warning {
          margin: 0.45rem 0 0;
          padding: 0.3rem 0.8rem;
          border-radius: 999px;
          background: rgba(244, 193, 93, 0.18);
          border: 1px solid rgba(244, 193, 93, 0.55);
          color: #f4c15d;
          font-size: 0.8rem;
          font-weight: 700;
        }
        .access-scanner-shell .access-result-card {
          position: absolute;
          inset: 0;
          z-index: 5;
          border-radius: 0;
          border: 0;
          backdrop-filter: blur(6px);
        }
        .access-history-toggle {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          width: 100%;
          min-height: 44px;
        }
        .access-history {
          border: 1px solid var(--border-glass);
          border-radius: 14px;
          padding: 0.75rem;
          background: rgba(255,255,255,0.02);
          max-height: min(36vh, 280px);
          overflow-y: auto;
        }
        .access-history-item {
          display: flex;
          justify-content: space-between;
          gap: 8px;
          padding: 0.55rem 0;
          border-bottom: 1px solid var(--border-glass);
          font-size: 0.8rem;
        }
        .access-history-more {
          width: 100%;
          margin-top: 0.55rem;
          min-height: 44px;
        }
        .access-today-bookings {
          border: 1px solid var(--border-glass);
          border-radius: 18px;
          padding: 0.9rem 1rem 1rem;
          background: var(--bg-secondary);
        }
        .access-today-bookings-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 0.5rem;
          margin-bottom: 0.65rem;
        }
        .access-today-bookings-head strong {
          display: inline-flex;
          align-items: center;
          gap: 0.4rem;
          font-size: 0.88rem;
          color: var(--text-gold);
        }
        .access-today-bookings-head span {
          font-size: 0.72rem;
          color: var(--text-muted);
          font-variant-numeric: tabular-nums;
        }
        .access-today-bookings-list {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 0.35rem;
          max-height: min(42vh, 320px);
          overflow-y: auto;
        }
        .access-today-bookings-item {
          display: grid;
          grid-template-columns: 3.4rem 1fr auto;
          gap: 0.55rem;
          align-items: center;
          padding: 0.55rem 0.15rem;
          border-bottom: 1px solid var(--border-glass);
          font-size: 0.82rem;
        }
        .access-today-bookings-item:last-child {
          border-bottom: 0;
        }
        .access-today-bookings-time {
          font-variant-numeric: tabular-nums;
          font-weight: 700;
          color: var(--text-primary);
        }
        .access-today-bookings-item strong {
          display: block;
          color: var(--text-primary);
          font-size: 0.86rem;
          line-height: 1.25;
        }
        .access-today-bookings-item em {
          display: block;
          margin-top: 0.12rem;
          font-style: normal;
          font-size: 0.72rem;
          color: var(--text-muted);
        }
        .access-today-bookings-status {
          font-size: 0.7rem;
          font-weight: 700;
          letter-spacing: 0.02em;
          text-transform: uppercase;
        }
        .access-today-bookings-status.is-ok {
          color: var(--emerald-accent);
        }
        .access-today-bookings-status.is-pending {
          color: #f4c15d;
        }
        .access-today-bookings-empty {
          margin: 0;
          font-size: 0.82rem;
          color: var(--text-muted);
          text-align: center;
          padding: 0.35rem 0;
        }
        @media (orientation: landscape) and (max-height: 480px) {
          .access-scanner-shell {
            aspect-ratio: 16 / 10;
            max-height: min(70dvh, 360px);
            min-height: 180px;
          }
        }
      `}</style>

      <div className="access-gate-stack">
        <header className="access-gate-header">
          <div className="access-gate-brand">
            <img className="club-mark" src="/logo-jockey-club.png?v=clavos-blancos" alt="Jockey Club San Juan" width={44} height={44} />
            <div style={{ minWidth: 0 }}>
              <div className="serif-font" style={{ fontSize: '1rem', color: 'var(--text-gold)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                Acceso
              </div>
              <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                Molinete · teléfono
              </div>
            </div>
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => navigate('/panel')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <ArrowLeft size={14} /> Panel
          </button>
        </header>

        {poolCfg.seasonBlocksUnpaidDues !== false ? (
          <p className="season-dues-rule">
            {SEASON_DUES_GATE_COPY.lead}
            {' '}
            {SEASON_DUES_GATE_COPY.mora}
            {isPoolSeasonLive(clubDay) ? '' : ' Rige en temporada, diciembre a marzo.'}
          </p>
        ) : null}

        {!cameraOn && resultCard}

        {cameraOn ? (
          <div className="access-scanner-shell">
            <QrLiveScanner
              key={scannerGen}
              active={cameraOn}
              onDecode={handleDecode}
              onError={handleCameraError}
              onLiveChange={setCameraLive}
            />
            {result ? (
              <div className={`access-result-card ${result.status}${result.tone ? ` ${result.tone}` : ''}`} role="status" aria-live="assertive">
                {result.photo ? (
                  <img src={result.photo} alt="" width={64} height={64} className="access-result-photo" />
                ) : null}
                {result.status === 'granted'
                  ? <CheckCircle2 size={44} aria-hidden="true" />
                  : <AlertCircle size={44} aria-hidden="true" />}
                <h2 className="serif-font access-result-title">{result.title}</h2>
                <p className="access-result-detail">{result.detail}</p>
                {result.warning ? <p className="access-result-warning">{result.warning}</p> : null}
              </div>
            ) : null}
          </div>
        ) : null}

        <section className="access-panel">
          <form
            className="access-manual"
            onSubmit={(e) => {
              e.preventDefault();
              const raw = manualCode.trim();
              if (!raw) return;
              if (/^JCSJ:/i.test(raw) || parseGuestPassPayload(raw)) {
                processPayload(raw, { allowUnsignedNumber: true });
                setManualCode('');
                setManualHint('');
                return;
              }
              const exact = pickExactHit(hits, raw);
              if (exact) {
                admitMember(exact);
                return;
              }
              if (hits.length > 1) {
                setManualHint('Hay varios socios. Elegí uno de la lista.');
                return;
              }
              if (/[a-záéíóúüñ]/i.test(raw)) {
                setResult({
                  status: 'denied',
                  title: 'Socio no encontrado',
                  detail: `Nadie en el padrón coincide con “${raw}”.`,
                  memberName: null,
                });
                playBeep(false);
                beginCooldown(1600);
                return;
              }
              processPayload(raw, { allowUnsignedNumber: true });
              setManualCode('');
              setManualHint('');
            }}
          >
            <label className="access-manual-label" htmlFor="access-manual-code">
              Buscar socio
            </label>
            <div className="access-manual-row">
              <input
                id="access-manual-code"
                ref={manualRef}
                name="member-code"
                className="form-input"
                value={manualCode}
                onChange={(e) => {
                  setManualCode(e.target.value);
                  setManualHint('');
                }}
                placeholder="DNI, apellido o N°…"
                inputMode="search"
                enterKeyHint="search"
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                aria-describedby="access-manual-hint"
                aria-autocomplete="list"
                aria-controls="access-manual-hits"
                translate="no"
              />
              <button type="submit" className="btn btn-tan">
                Ingresar
              </button>
            </div>
            {hits.length > 0 ? (
              <ul id="access-manual-hits" className="access-manual-hits" role="listbox" aria-label="Socios encontrados">
                {hits.map((member) => (
                  <li key={member.memberId || member.id} role="option">
                    <button type="button" onClick={() => admitMember(member)}>
                      <strong>{member.name}</strong>
                      <span>
                        {member.documentNumber ? `DNI ${member.documentNumber}` : 'Sin DNI'}
                        {member.memberId ? ` · N° ${member.memberId}` : ''}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <p id="access-manual-hint" className="access-manual-hint">
              {manualHint || 'DNI, apellido o número. También código JCSJ y pases.'}
            </p>
          </form>

          {cameraError ? (
            <p className="access-camera-error" role="alert">{cameraError}</p>
          ) : null}

          <div className="access-actions">
            {!cameraOn ? (
              <button type="button" className="btn btn-tan" onClick={startCamera}>
                <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                  <Camera size={18} aria-hidden="true" />
                  {cameraError ? 'Reintentar cámara' : 'Abrir cámara'}
                </span>
              </button>
            ) : (
              <button type="button" className="btn btn-secondary" onClick={stopCamera}>
                <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                  <CameraOff size={18} aria-hidden="true" />
                  Detener cámara
                </span>
              </button>
            )}
          </div>

          <button
            type="button"
            className="btn btn-secondary btn-sm access-history-toggle"
            onClick={() => setShowHistory((v) => !v)}
          >
            <History size={14} aria-hidden="true" />
            {showHistory ? 'Ocultar hoy' : `Hoy · ${todayLogs.length}`}
          </button>

          {showHistory ? (
            <div className="access-history">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <strong style={{ fontSize: '0.85rem', color: 'var(--text-gold)' }}>Lecturas de hoy</strong>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                  {todayLogs.length}
                </span>
              </div>
              {visibleLogs.length === 0 ? (
                <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-muted)', textAlign: 'center' }}>
                  Sin lecturas hoy.
                </p>
              ) : (
                <>
                  <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                    {visibleLogs.map((log) => (
                      <li key={log.id} className="access-history-item">
                        <div style={{ minWidth: 0 }}>
                          <strong style={{ color: 'var(--text-primary)' }}>{log.memberName}</strong>
                          <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>{log.notes}</div>
                        </div>
                        <div style={{ textAlign: 'right', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                          <div style={{ color: log.status === 'granted' ? 'var(--emerald-accent)' : 'var(--danger-accent)', fontWeight: 700 }}>
                            {log.status === 'granted' ? 'OK' : 'NO'}
                          </div>
                          <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>{log.time}</div>
                        </div>
                      </li>
                    ))}
                  </ul>
                  {hasMoreToday ? (
                    <button
                      type="button"
                      className="btn btn-tan btn-sm access-history-more"
                      onClick={() => setHistoryShown((n) => n + GATE_HISTORY_PAGE)}
                    >
                      Más ({todayLogs.length - historyShown})
                    </button>
                  ) : null}
                </>
              )}
            </div>
          ) : null}
        </section>

        <section className="access-today-bookings" aria-label="Reservas de hoy">
          <div className="access-today-bookings-head">
            <strong>
              <CalendarRange size={16} aria-hidden="true" />
              Reservas de hoy
            </strong>
            <span>{todayReservations.length}</span>
          </div>
          {todayReservations.length === 0 ? (
            <p className="access-today-bookings-empty">No hay reservas para hoy.</p>
          ) : (
            <ul className="access-today-bookings-list">
              {todayReservations.map((res) => {
                const time = String(res.time || res.time_slot || '—');
                const status = String(res.status || 'confirmed').toLowerCase();
                const pending = status === 'pending';
                return (
                  <li
                    key={res.id || `${reservationDay(res)}-${time}-${res.memberId || res.memberName}`}
                    className="access-today-bookings-item"
                  >
                    <span className="access-today-bookings-time">{time}</span>
                    <div style={{ minWidth: 0 }}>
                      <strong>{res.facilityName || res.facilityId || 'Espacio'}</strong>
                      <em>
                        {res.memberName || 'Socio'}
                        {res.memberId ? ` · N° ${res.memberId}` : ''}
                      </em>
                    </div>
                    <span className={`access-today-bookings-status${pending ? ' is-pending' : ' is-ok'}`}>
                      {reservationStatusLabel(status)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
