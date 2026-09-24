import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, CheckCircle2, AlertCircle, Camera, CameraOff, History, QrCode,
} from 'lucide-react';
import { credentialTokenMatches, parseCredentialQRPayload } from '../domain/credentials/qr';
import { parseGuestPassPayload, isGuestPassValid } from '../domain/credentials/guestPass';
import { accessLogsForClubDay, buildAccessLogEntry, GATE_HISTORY_PAGE, tierToGroup } from '../domain/credentials/accessLog';
import { todayISODateAR } from '../lib/arDate';
import { mergePoolSearchHits, searchPoolMembers } from '../domain/pool/poolAccess';
import { getMemberByNumber, searchMembersDirectory } from '../data/repos';
import { isSupabaseConfigured } from '../lib/supabase';
import QrLiveScanner from '../components/QrLiveScanner';

const COOLDOWN_MS = 2200;

function playBeep(success) {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
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
}) {
  const navigate = useNavigate();
  const processingRef = useRef(false);
  const cooldownTimerRef = useRef(null);
  const [cameraOn, setCameraOn] = useState(true);
  const [cameraError, setCameraError] = useState('');
  const [result, setResult] = useState(null);
  const [isWide, setIsWide] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(min-width: 900px)').matches : false
  );
  const [showHistory, setShowHistory] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(min-width: 900px)').matches : false
  );
  const [manualCode, setManualCode] = useState('');
  const [remoteHits, setRemoteHits] = useState([]);
  const [manualHint, setManualHint] = useState('');
  const [cameraLive, setCameraLive] = useState(false);
  const [scannerGen, setScannerGen] = useState(0);
  const [clubDay, setClubDay] = useState(() => todayISODateAR());
  const [historyShown, setHistoryShown] = useState(GATE_HISTORY_PAGE);
  const manualRef = useRef(null);

  const beginCooldown = useCallback((ms = COOLDOWN_MS) => {
    processingRef.current = true;
    if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current);
    cooldownTimerRef.current = setTimeout(() => {
      processingRef.current = false;
      setResult(null);
      cooldownTimerRef.current = null;
    }, ms);
  }, []);

  const stopCamera = useCallback(() => {
    setCameraOn(false);
    setCameraLive(false);
    setCameraError('');
  }, []);

  const admitMember = useCallback((member) => {
    if (!member || processingRef.current) return;
    const isSuspended = member.status !== 'active';
    const hasDebt = (member.outstandingBalance || 0) > 0;
    const isAllowed = !isSuspended;
    const status = isAllowed ? 'granted' : 'denied';
    const notes = isSuspended
      ? 'Cuenta suspendida'
      : hasDebt
        ? `Ingreso OK · Deuda ${formatCurrency(member.outstandingBalance)}`
        : 'Acceso aprobado · Sin deuda pendiente';

    setResult({
      status,
      title: isAllowed ? (hasDebt ? 'ACCESO CON DEUDA' : 'ACCESO AUTORIZADO') : 'ACCESO DENEGADO',
      detail: `${member.name} · ${isAllowed ? (member.tier?.toUpperCase() || 'SOCIO') : notes}`,
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
          : hasDebt
            ? 'Ingreso con deuda'
            : 'Ingreso sede',
        status,
        notes,
      }),
      ...(prev || []),
    ]);
    setManualCode('');
    setManualHint('');
    setRemoteHits([]);
    beginCooldown();
  }, [formatCurrency, setEntryLogs, beginCooldown]);

  const processPayload = useCallback(async (raw, { allowUnsignedNumber = false } = {}) => {
    if (processingRef.current) return;

    const guestParsed = parseGuestPassPayload(raw);
    if (guestParsed) {
      const pass = (guestPasses || []).find((p) => p.id === guestParsed.id);
      const host = members.find((m) => m.memberId === guestParsed.hostMemberId);
      const valid = pass && isGuestPassValid(pass, { parsed: guestParsed }) && host?.status === 'active';
      setResult({
        status: valid ? 'granted' : 'denied',
        title: valid ? 'INVITADO AUTORIZADO' : 'PASE INVÁLIDO',
        detail: valid
          ? `${pass.guestName} · invitado de ${host?.name || 'socio'}`
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
            : 'Pase vencido, revocado o no registrado',
        }),
        ...(prev || []),
      ]);
      beginCooldown();
      return;
    }

    const parsed = parseCredentialQRPayload(raw);
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
        }),
        ...(prev || []),
      ]);
      beginCooldown(1600);
      return;
    }

    let member = members.find((m) => m.memberId === memberId);
    if (parsed.signed && isSupabaseConfigured) {
      try {
        const full = await getMemberByNumber(memberId);
        if (full?.credentialToken) {
          member = { ...(member || full), credentialToken: full.credentialToken };
        }
      } catch {
        /* el padrón en memoria no trae la firma */
      }
    }
    if (parsed.signed && member && !credentialTokenMatches(member, parsed)) {
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
        }),
        ...(prev || []),
      ]);
      beginCooldown();
      return;
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
        }),
        ...(prev || []),
      ]);
      beginCooldown();
      return;
    }

    admitMember(member);
  }, [members, guestPasses, formatCurrency, setEntryLogs, beginCooldown, admitMember]);

  const startCamera = useCallback(() => {
    setCameraError('');
    setResult(null);
    setCameraOn(true);
    setScannerGen((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!cameraError) return undefined;
    const id = window.setTimeout(() => manualRef.current?.focus(), 60);
    return () => window.clearTimeout(id);
  }, [cameraError]);

  useEffect(() => () => {
    if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current);
  }, []);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 900px)');
    const onChange = (e) => {
      setIsWide(e.matches);
      if (e.matches) setShowHistory(true);
    };
    setIsWide(mq.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
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

  return (
    <div className="access-gate fade-in">
      <style>{`
        .access-gate {
          min-height: 100dvh;
          width: 100%;
          margin: 0 auto;
          padding: max(0.75rem, env(safe-area-inset-top)) max(0.9rem, env(safe-area-inset-right)) max(1.25rem, env(safe-area-inset-bottom)) max(0.9rem, env(safe-area-inset-left));
          display: flex;
          flex-direction: column;
          gap: 0.9rem;
          box-sizing: border-box;
          background:
            radial-gradient(ellipse at 50% 0%, rgba(var(--primary-gold-rgb),0.12), transparent 55%),
            var(--bg-primary, #060e0a);
        }
        .access-gate-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 0.65rem;
          flex-wrap: wrap;
          max-width: 1100px;
          width: 100%;
          margin: 0 auto;
        }
        .access-gate-brand {
          display: flex;
          align-items: center;
          gap: 0.55rem;
          min-width: 0;
        }
        .access-gate-brand img {
          width: 58px;
          height: 58px;
        }
        .access-gate-layout {
          display: grid;
          grid-template-columns: 1fr;
          gap: 0.9rem;
          width: 100%;
          max-width: 1100px;
          margin: 0 auto;
          flex: 1;
          align-items: start;
        }
        .access-scanner-shell {
          position: relative;
          border-radius: 18px;
          overflow: hidden;
          border: 1px solid var(--border-glass);
          background: #020804;
          width: 100%;
          aspect-ratio: 4 / 3;
          min-height: 220px;
          max-height: min(52vh, 480px);
          height: auto;
          box-shadow: 0 0 0 1px rgba(var(--primary-gold-rgb),0.15), 0 16px 40px rgba(0,0,0,0.45);
        }
        .access-scanner-shell.is-idle {
          aspect-ratio: auto;
          height: 240px;
          max-height: 240px;
        }
        .access-side {
          display: flex;
          flex-direction: column;
          gap: 0.85rem;
          min-width: 0;
          padding: 1rem 1.05rem 1.1rem;
          border: 1px solid var(--border-glass);
          border-radius: 16px;
          background: var(--bg-secondary);
        }
        .access-scanner-shell .qr-live {
          border-radius: 18px;
        }
        .access-result-overlay {
          position: absolute;
          inset: 0;
          z-index: 5;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: clamp(1rem, 3vw, 1.5rem);
          text-align: center;
          backdrop-filter: blur(6px);
        }
        .access-result-overlay.granted {
          background: rgba(6, 40, 28, 0.88);
          color: var(--emerald-accent);
        }
        .access-result-overlay.denied {
          background: rgba(40, 10, 10, 0.9);
          color: var(--danger-accent);
        }
        .access-idle-hint {
          position: absolute;
          inset: 0;
          z-index: 2;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 0.65rem;
          padding: 1.5rem;
          text-align: center;
          color: var(--text-secondary);
          pointer-events: none;
        }
        .access-actions {
          display: grid;
          grid-template-columns: 1fr;
          gap: 0.55rem;
        }
        .access-actions .btn {
          min-height: 48px;
          font-weight: 700;
        }
        .access-manual {
          display: flex;
          flex-direction: column;
          gap: 0.45rem;
        }
        .access-manual-label {
          font-size: 0.72rem;
          font-weight: 700;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          color: var(--text-muted);
        }
        .access-manual-row {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }
        .access-manual .form-input {
          flex: 1 1 180px;
          min-height: 44px;
          min-width: 0;
        }
        .access-manual .btn {
          min-height: 44px;
          padding: 0 1.1rem;
          flex: 0 0 auto;
        }
        .access-manual-hint {
          margin: 0;
          font-size: 0.75rem;
          line-height: 1.35;
          color: var(--text-muted);
        }
        .access-manual-hits {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 0.35rem;
          max-height: 220px;
          overflow-y: auto;
        }
        .access-manual-hits button {
          width: 100%;
          text-align: left;
          padding: 0.55rem 0.7rem;
          border-radius: 10px;
          border: 1px solid var(--border-glass);
          background: var(--bg-tertiary);
          color: inherit;
          font: inherit;
          cursor: pointer;
          display: flex;
          flex-direction: column;
          gap: 0.12rem;
        }
        .access-manual-hits button:hover,
        .access-manual-hits button:focus-visible {
          border-color: color-mix(in srgb, var(--primary-gold) 50%, var(--border-glass));
        }
        .access-manual-hits strong {
          font-size: 0.88rem;
          color: var(--text-primary);
        }
        .access-manual-hits span {
          font-size: 0.72rem;
          color: var(--text-muted);
          font-variant-numeric: tabular-nums;
        }
        .access-history {
          border: 1px solid var(--border-glass);
          border-radius: 14px;
          padding: 0.75rem;
          background: rgba(255,255,255,0.02);
          max-height: min(40vh, 320px);
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
        .access-history-toggle {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          width: 100%;
        }
        .access-history-more {
          width: 100%;
          margin-top: 0.55rem;
        }

        /* Tablet */
        @media (min-width: 640px) {
          .access-scanner-shell:not(.is-idle) {
            max-height: min(48vh, 460px);
          }
        }

        /* Desktop: lector + panel lateral, sin estirar la cámara */
        @media (min-width: 900px) {
          .access-gate {
            padding: 1.25rem 1.5rem 1.75rem;
          }
          .access-gate-layout {
            grid-template-columns: minmax(0, 1.15fr) minmax(300px, 380px);
            gap: 1.25rem;
            align-items: start;
          }
          .access-scanner-shell:not(.is-idle) {
            max-height: min(56vh, 500px);
          }
          .access-history {
            flex: 1;
            max-height: min(42vh, 360px);
          }
          .access-history-toggle {
            display: none;
          }
        }

        @media (min-width: 1200px) {
          .access-gate-layout {
            max-width: 1180px;
          }
        }

        /* Pantallas angostas / landscape móvil */
        @media (max-height: 520px) and (orientation: landscape) {
          .access-gate-layout {
            grid-template-columns: minmax(0, 1.1fr) minmax(240px, 320px);
          }
          .access-scanner-shell:not(.is-idle) {
            aspect-ratio: 16 / 10;
            max-height: calc(100dvh - 5.5rem);
          }
          .access-side {
            max-height: calc(100dvh - 5.5rem);
            overflow-y: auto;
          }
        }
      `}</style>

      <header className="access-gate-header">
        <div className="access-gate-brand">
          <img className="club-mark" src="/logo-jockey-club.png?v=clavos-blancos" alt="Jockey Club San Juan" width={58} height={58} />
          <div style={{ minWidth: 0 }}>
            <div className="serif-font" style={{ fontSize: 'clamp(1rem, 2.5vw, 1.2rem)', color: 'var(--text-gold)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              Acceso QR
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
              Sede Rivadavia · Molinete · Todos los dispositivos
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

      <div className="access-gate-layout">
        <div className={`access-scanner-shell${cameraLive ? '' : ' is-idle'}`}>
          {cameraOn && (
            <QrLiveScanner
              key={scannerGen}
              active={cameraOn}
              paused={Boolean(result)}
              onDecode={(raw) => processPayload(raw)}
              onError={setCameraError}
              onLiveChange={setCameraLive}
            />
          )}

          {!cameraOn && !result && (
            <div className="access-idle-hint">
              <QrCode size={42} color="var(--primary-gold)" />
              <p style={{ margin: 0, fontSize: '0.95rem', color: 'var(--text-primary)', fontWeight: 600 }}>
                Lector de credenciales
              </p>
              <p style={{ margin: 0, fontSize: '0.8rem', maxWidth: 300 }}>
                Credencial a pantalla completa, brillo al máximo. Acercá el QR al marco: debería leer al instante.
              </p>
            </div>
          )}

          {result && (
            <div className={`access-result-overlay ${result.status}`} role="status" aria-live="assertive">
              {result.photo && (
                <img
                  src={result.photo}
                  alt=""
                  width={72}
                  height={72}
                  style={{ width: 72, height: 72, borderRadius: 16, objectFit: 'cover', marginBottom: 10, border: '2px solid currentColor' }}
                />
              )}
              {result.status === 'granted'
                ? <CheckCircle2 size={52} style={{ marginBottom: 8 }} />
                : <AlertCircle size={52} style={{ marginBottom: 8 }} />}
              <h2 className="serif-font" style={{ margin: 0, fontSize: 'clamp(1.2rem, 3vw, 1.55rem)', letterSpacing: '0.04em' }}>
                {result.title}
              </h2>
              <p style={{ margin: '0.45rem 0 0', fontSize: '0.9rem', color: '#fff', opacity: 0.9 }}>
                {result.detail}
              </p>
            </div>
          )}
        </div>

        <aside className="access-side">
          {cameraError && (
            <p role="alert" style={{ margin: 0, fontSize: '0.82rem', color: 'var(--danger-accent)' }}>
              {cameraError}
            </p>
          )}

          <div className="access-actions">
            {!cameraOn || cameraError ? (
              <button type="button" className="btn btn-tan" onClick={startCamera} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <Camera size={18} aria-hidden="true" /> {cameraError ? 'Reintentar cámara' : 'Activar cámara'}
              </button>
            ) : (
              <button type="button" className="btn btn-secondary" onClick={stopCamera} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <CameraOff size={18} aria-hidden="true" /> Detener cámara
              </button>
            )}
          </div>

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
              Socio
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
                placeholder="DNI, apellido o número…"
                inputMode="text"
                autoComplete="off"
                autoCapitalize="off"
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
              {manualHint || 'DNI, apellido o número de credencial. También acepta código JCSJ y pases.'}
            </p>
          </form>

          <button
            type="button"
            className="btn btn-secondary btn-sm access-history-toggle"
            onClick={() => setShowHistory((v) => !v)}
          >
            <History size={14} aria-hidden="true" /> {showHistory ? 'Ocultar historial' : `Hoy (${todayLogs.length})`}
          </button>

          {(showHistory || isWide) && (
            <div className="access-history">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <strong style={{ fontSize: '0.85rem', color: 'var(--text-gold)' }}>Lecturas de hoy</strong>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                  {todayLogs.length} {todayLogs.length === 1 ? 'lectura' : 'lecturas'}
                </span>
              </div>
              {visibleLogs.length === 0 ? (
                <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-muted)', textAlign: 'center' }}>
                  Sin lecturas hoy. Mañana esta lista empieza de nuevo.
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
                      Leer más ({todayLogs.length - historyShown} más)
                    </button>
                  ) : null}
                </>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
