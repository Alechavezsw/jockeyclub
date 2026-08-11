import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, CheckCircle2, AlertCircle, Camera, CameraOff, History, QrCode,
} from 'lucide-react';
import { parseCredentialQRPayload } from '../domain/credentials/qr';
import { parseGuestPassPayload, isGuestPassValid } from '../domain/credentials/guestPass';
import QrLiveScanner from '../components/QrLiveScanner';

const COOLDOWN_MS = 2800;

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
  }, []);

  const processPayload = useCallback((raw) => {
    if (processingRef.current) return;

    const guestParsed = parseGuestPassPayload(raw);
    if (guestParsed) {
      const pass = (guestPasses || []).find((p) => p.id === guestParsed.id);
      const host = members.find((m) => m.memberId === guestParsed.hostMemberId);
      const valid = pass && isGuestPassValid(pass) && host?.status === 'active';
      setResult({
        status: valid ? 'granted' : 'denied',
        title: valid ? 'INVITADO AUTORIZADO' : 'PASE INVÁLIDO',
        detail: valid
          ? `${pass.guestName} · invitado de ${host?.name || 'socio'}`
          : 'Pase vencido, revocado o no registrado.',
        memberName: pass?.guestName || null,
      });
      playBeep(valid);
      if (valid) {
        setEntryLogs((prev) => [{
          id: Date.now(),
          date: new Date().toISOString().split('T')[0],
          time: new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          memberName: `${pass.guestName} (invitado)`,
          memberId: host?.memberId || guestParsed.hostMemberId,
          role: 'Invitado del día',
          status: 'granted',
          notes: `Pase ${pass.id} · anfitrión ${host?.name || ''}`,
        }, ...(prev || [])]);
      }
      beginCooldown();
      return;
    }

    const memberId = parseCredentialQRPayload(raw);
    if (!memberId) {
      setResult({
        status: 'denied',
        title: 'QR no válido',
        detail: 'Acercá la credencial digital del Jockey Club (pantalla completa).',
        memberName: null,
      });
      playBeep(false);
      beginCooldown(1600);
      return;
    }

    const member = members.find((m) => m.memberId === memberId);
    if (!member) {
      setResult({
        status: 'denied',
        title: 'Socio no encontrado',
        detail: `Credencial ${memberId.slice(0, 8)}… no figura en el padrón.`,
        memberName: null,
      });
      playBeep(false);
      beginCooldown();
      return;
    }

    // Activo entra; deuda se informa pero no bloquea el molinete (evita falsos “lector roto”).
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

    setEntryLogs((prev) => [{
      id: Date.now(),
      date: new Date().toISOString().split('T')[0],
      time: new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      memberName: member.name,
      memberId: member.memberId,
      role: member.tier === 'royal' ? 'Socio Royal' : member.tier === 'platinum' ? 'Socio Platinum' : 'Socio Gold',
      status,
      notes,
    }, ...(prev || [])]);

    beginCooldown();
  }, [members, guestPasses, formatCurrency, setEntryLogs, beginCooldown]);

  const startCamera = useCallback(() => {
    setCameraError('');
    setResult(null);
    setCameraOn(true);
  }, []);

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

  const recent = (entryLogs || []).slice(0, 20);

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
            radial-gradient(ellipse at 50% 0%, rgba(207,161,58,0.12), transparent 55%),
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
          width: 40px;
          height: 40px;
          border-radius: 50%;
          object-fit: cover;
          border: 2px solid var(--primary-gold);
          flex-shrink: 0;
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
          min-height: min(52vh, 360px);
          aspect-ratio: 1 / 1;
          max-height: 70vh;
          box-shadow: 0 0 0 1px rgba(207,161,58,0.15), 0 16px 40px rgba(0,0,0,0.45);
        }
        .access-side {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
          min-width: 0;
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
          padding: 0 1rem;
          flex: 0 0 auto;
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

        /* Tablet */
        @media (min-width: 640px) {
          .access-scanner-shell {
            aspect-ratio: 4 / 3;
            min-height: 380px;
            max-height: 58vh;
          }
        }

        /* Desktop / tablet landscape: lector + panel lateral */
        @media (min-width: 900px) {
          .access-gate {
            padding: 1.25rem 1.5rem 1.75rem;
          }
          .access-gate-layout {
            grid-template-columns: minmax(0, 1.35fr) minmax(280px, 0.9fr);
            gap: 1.25rem;
            align-items: stretch;
          }
          .access-scanner-shell {
            min-height: 100%;
            height: min(68vh, 560px);
            max-height: none;
            aspect-ratio: auto;
          }
          .access-side {
            height: min(68vh, 560px);
          }
          .access-history {
            flex: 1;
            max-height: none;
          }
          .access-history-toggle {
            display: none;
          }
        }

        @media (min-width: 1200px) {
          .access-gate-layout {
            max-width: 1200px;
          }
          .access-scanner-shell,
          .access-side {
            height: min(72vh, 620px);
          }
        }

        /* Pantallas angostas / landscape móvil */
        @media (max-height: 520px) and (orientation: landscape) {
          .access-gate-layout {
            grid-template-columns: minmax(0, 1.2fr) minmax(220px, 0.9fr);
          }
          .access-scanner-shell {
            aspect-ratio: auto;
            min-height: calc(100dvh - 5.5rem);
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
          <img src="/logo-jockey-club.png" alt="Jockey Club" />
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
        <div className="access-scanner-shell">
          {cameraOn && (
            <QrLiveScanner
              active={cameraOn}
              paused={Boolean(result)}
              onDecode={processPayload}
              onError={setCameraError}
            />
          )}

          {!cameraOn && !result && (
            <div className="access-idle-hint">
              <QrCode size={42} color="var(--primary-gold)" />
              <p style={{ margin: 0, fontSize: '0.95rem', color: 'var(--text-primary)', fontWeight: 600 }}>
                Lector de credenciales
              </p>
              <p style={{ margin: 0, fontSize: '0.8rem', maxWidth: 300 }}>
                Pedile al socio la credencial a pantalla completa. Tocá la imagen para enfocar, o usá el ícono de foto si la cámara falla.
              </p>
            </div>
          )}

          {result && (
            <div className={`access-result-overlay ${result.status}`}>
              {result.photo && (
                <img
                  src={result.photo}
                  alt=""
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
              {' '}
              Tip: usá el botón de foto (arriba a la derecha del lector) o el código manual.
            </p>
          )}

          <div className="access-actions">
            {!cameraOn ? (
              <button type="button" className="btn btn-primary" onClick={startCamera} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <Camera size={18} /> Activar cámara
              </button>
            ) : (
              <button type="button" className="btn btn-secondary" onClick={stopCamera} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <CameraOff size={18} /> Detener cámara
              </button>
            )}
          </div>

          <form
            className="access-manual"
            onSubmit={(e) => {
              e.preventDefault();
              if (!manualCode.trim()) return;
              processPayload(manualCode.trim());
              setManualCode('');
            }}
          >
            <input
              className="form-input"
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value)}
              placeholder="Código manual JCSJ:…"
              inputMode="text"
              autoComplete="off"
            />
            <button type="submit" className="btn btn-secondary">
              Leer
            </button>
          </form>

          <button
            type="button"
            className="btn btn-secondary btn-sm access-history-toggle"
            onClick={() => setShowHistory((v) => !v)}
          >
            <History size={14} /> {showHistory ? 'Ocultar historial' : `Historial (${entryLogs.length})`}
          </button>

          {(showHistory || isWide) && (
            <div className="access-history">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <strong style={{ fontSize: '0.85rem', color: 'var(--text-gold)' }}>Últimas lecturas</strong>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{entryLogs.length} total</span>
              </div>
              {recent.length === 0 ? (
                <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-muted)', textAlign: 'center' }}>
                  Sin lecturas todavía.
                </p>
              ) : (
                recent.map((log) => (
                  <div key={log.id} className="access-history-item">
                    <div style={{ minWidth: 0 }}>
                      <strong style={{ color: 'var(--text-primary)' }}>{log.memberName}</strong>
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>{log.notes}</div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ color: log.status === 'granted' ? 'var(--emerald-accent)' : 'var(--danger-accent)', fontWeight: 700 }}>
                        {log.status === 'granted' ? 'OK' : 'NO'}
                      </div>
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>{log.time}</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
