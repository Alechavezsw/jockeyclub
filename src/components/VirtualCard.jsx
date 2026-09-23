import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, Shield, X, Lock } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { buildCredentialQRPayload } from '../domain/credentials/qr';
import { exportCredentialPdf } from '../domain/credentials/exportCredentialPdf';
import { findTier, getTierDisplayName, tierCardStyle } from '../domain/members/tiers';

function formatMemberId(id) {
  if (!id) return '•••• •••• •••• ••••';
  const s = String(id).replace(/\D/g, '');
  return s.match(/.{1,4}/g)?.join(' ') || s;
}

function isCoarsePointer() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(hover: none), (pointer: coarse), (max-width: 768px)').matches;
}

function CardFace({
  member,
  t,
  cardRef,
  transform,
  isHovered,
  glowPos,
  onMouseMove,
  onMouseEnter,
  onMouseLeave,
  onClick,
  size = 'normal',
  dimmed = false,
}) {
  const isFull = size === 'full';
  const style = {
    position: 'relative',
    width: '100%',
    maxWidth: '100%',
    aspectRatio: '1.586 / 1',
    height: 'auto',
    borderRadius: isFull ? 22 : 18,
    background: t.bg,
    border: `1px solid ${t.accentDim}`,
    boxShadow: isHovered || isFull
      ? `0 18px 36px rgba(0,0,0,0.45), 0 0 18px ${t.glow}66, inset 0 1px 0 rgba(255,255,255,0.06)`
      : `0 12px 28px rgba(0,0,0,0.4), 0 0 12px ${t.glow}44, inset 0 1px 0 rgba(255,255,255,0.05)`,
    transform: transform || 'perspective(900px)',
    transition: isHovered ? 'box-shadow 0.15s ease' : 'transform 0.35s ease, box-shadow 0.35s ease',
    cursor: onClick ? 'pointer' : 'default',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    padding: isFull ? '1.65rem 1.75rem' : '1.4rem 1.5rem',
    WebkitUserSelect: 'none',
    userSelect: 'none',
    WebkitTouchCallout: 'none',
    WebkitUserDrag: 'none',
    filter: dimmed ? 'blur(18px) brightness(0.35)' : 'none',
  };

  return (
    <div
      ref={cardRef}
      className="vc-card-face"
      style={style}
      onMouseMove={onMouseMove}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={onClick}
      onContextMenu={(e) => e.preventDefault()}
      onDragStart={(e) => e.preventDefault()}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      } : undefined}
      aria-label={onClick ? 'Abrir credencial a pantalla completa' : 'Credencial virtual'}
    >
      <div style={{
        position: 'absolute', inset: 0, borderRadius: 'inherit', pointerEvents: 'none',
        background: isHovered
          ? `radial-gradient(circle at ${glowPos.x}% ${glowPos.y}%, rgba(255,255,255,0.07) 0%, transparent 55%)`
          : 'none',
      }} />
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: t.stripe, opacity: 0.8 }} />
      <div style={{
        position: 'absolute', right: '-40px', top: '-40px',
        width: 160, height: 160, borderRadius: '50%',
        background: `radial-gradient(circle, ${t.accentDim} 0%, transparent 70%)`,
        pointerEvents: 'none',
      }} />
      <div style={{
        position: 'absolute', left: '-30px', bottom: '-50px',
        width: 130, height: 130, borderRadius: '50%',
        background: `radial-gradient(circle, ${t.accentDim}80 0%, transparent 70%)`,
        pointerEvents: 'none',
      }} />
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        backgroundImage: 'repeating-linear-gradient(0deg, rgba(255,255,255,0.012) 0px, rgba(255,255,255,0.012) 1px, transparent 1px, transparent 14px)',
        borderRadius: 'inherit',
      }} />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'relative', zIndex: 2 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <div style={{
            width: isFull ? 42 : 36,
            height: isFull ? 42 : 36,
            borderRadius: 10,
            background: `linear-gradient(135deg, ${t.accent}30, ${t.accent}10)`,
            border: `1px solid ${t.accent}50`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Shield size={isFull ? 20 : 18} color={t.accent} />
          </div>
          <div>
            <div style={{
              fontSize: isFull ? '0.8rem' : '0.72rem',
              fontWeight: 800,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: t.accent,
              lineHeight: 1,
            }}>
              Jockey Club
            </div>
            <div style={{
              fontSize: isFull ? '0.65rem' : '0.58rem',
              color: 'rgba(255,255,255,0.35)',
              letterSpacing: '0.08em',
              marginTop: '0.15rem',
            }}>
              SAN JUAN · SEDE RIVADAVIA
            </div>
          </div>
        </div>

        <div style={{
          width: isFull ? 48 : 42,
          height: isFull ? 34 : 30,
          borderRadius: 6,
          background: `linear-gradient(135deg, ${t.chipColor}cc, ${t.chipColor}88)`,
          border: `1px solid ${t.chipColor}60`,
          boxShadow: '0 2px 8px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.2)',
          position: 'relative',
          overflow: 'hidden',
        }}>
          <div style={{
            position: 'absolute', inset: 0,
            background: 'repeating-linear-gradient(90deg, rgba(0,0,0,0.08) 0, rgba(0,0,0,0.08) 1px, transparent 1px, transparent 7px)',
          }} />
          <div style={{
            position: 'absolute', top: '50%', left: 0, right: 0, height: 1,
            background: 'rgba(0,0,0,0.15)', transform: 'translateY(-50%)',
          }} />
        </div>
      </div>

      <div style={{ position: 'relative', zIndex: 2 }}>
        <div style={{
          fontFamily: "'Courier New', monospace",
          fontSize: isFull ? '1.35rem' : '1.1rem',
          letterSpacing: '0.18em',
          color: 'rgba(255,255,255,0.9)',
          textShadow: `0 0 20px ${t.glow}`,
          fontWeight: 600,
        }}>
          {formatMemberId(member?.memberId)}
        </div>
      </div>

      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-end',
        position: 'relative',
        zIndex: 2,
        gap: '0.65rem',
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: '0.65rem', minWidth: 0 }}>
          {member?.photo ? (
            <div style={{
              width: isFull ? 96 : 72,
              height: isFull ? 96 : 72,
              borderRadius: 12,
              overflow: 'hidden',
              flexShrink: 0,
              border: `1px solid ${t.accent}55`,
              boxShadow: '0 2px 10px rgba(0,0,0,0.45)',
            }}>
              <img
                src={member.photo}
                alt=""
                draggable={false}
                onContextMenu={(e) => e.preventDefault()}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  WebkitUserSelect: 'none',
                  userSelect: 'none',
                  WebkitTouchCallout: 'none',
                  pointerEvents: 'none',
                }}
              />
            </div>
          ) : null}
          <div style={{ minWidth: 0 }}>
            <div style={{
              fontSize: '0.55rem',
              textTransform: 'uppercase',
              letterSpacing: '0.12em',
              color: 'rgba(255,255,255,0.35)',
              marginBottom: '0.25rem',
            }}>
              Titular
            </div>
            <div style={{
              fontFamily: "'Playfair Display', serif",
              fontSize: isFull ? '1.1rem' : '0.92rem',
              fontWeight: 700,
              color: '#fff',
              letterSpacing: '0.04em',
              textShadow: '0 1px 4px rgba(0,0,0,0.5)',
              maxWidth: member?.photo ? (isFull ? 150 : 120) : (isFull ? 220 : 180),
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}>
              {member?.name}
            </div>
            <div style={{ marginTop: '0.35rem' }}>
              <span style={{
                fontSize: '0.6rem',
                fontWeight: 800,
                textTransform: 'uppercase',
                letterSpacing: '0.1em',
                color: t.accent,
                background: `${t.accent}15`,
                border: `1px solid ${t.accent}40`,
                padding: '0.15rem 0.5rem',
                borderRadius: 6,
              }}>
                {t.label}
              </span>
            </div>
          </div>
        </div>

        <div style={{
          background: '#ffffff',
          borderRadius: isFull ? 12 : 10,
          padding: isFull ? 8 : 5,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 4px 16px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.1)',
          width: isFull ? 96 : 48,
          height: isFull ? 96 : 48,
          flexShrink: 0,
        }}>
          <QRCodeSVG
            value={buildCredentialQRPayload(member)}
            size={isFull ? 80 : 38}
            level="H"
            includeMargin={isFull}
            bgColor="#ffffff"
            fgColor="#060e0a"
          />
        </div>
      </div>
    </div>
  );
}

const CARD_BASE_W = 360;
const CARD_BASE_H = CARD_BASE_W / 1.586;

export default function VirtualCard({ member }) {
  const cardRef = useRef(null);
  const fitRef = useRef(null);
  const [transform, setTransform] = useState('');
  const [glowPos, setGlowPos] = useState({ x: 50, y: 50 });
  const [isHovered, setIsHovered] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [secureHide, setSecureHide] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [zoom, setZoom] = useState(1);

  const catalogTier = findTier(member?.tier);
  const t = tierCardStyle(member?.tier);
  if (catalogTier?.color) {
    t.accent = catalogTier.color;
    t.chipColor = catalogTier.color;
  }
  t.label = getTierDisplayName(member?.tier);

  const handleMouseMove = (e) => {
    if (expanded || isCoarsePointer()) return;
    const card = cardRef.current;
    if (!card) return;
    const rect = card.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    setTransform(`perspective(900px) rotateX(${((y - cy) / cy) * -4}deg) rotateY(${((x - cx) / cx) * 4}deg)`);
    setGlowPos({ x: (x / rect.width) * 100, y: (y / rect.height) * 100 });
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    setTransform('perspective(900px) rotateX(0deg) rotateY(0deg) scale(1)');
  };

  const openExpanded = useCallback(() => setExpanded(true), []);
  const closeExpanded = useCallback(() => setExpanded(false), []);

  const downloadPdf = useCallback(async (e) => {
    e?.stopPropagation?.();
    if (downloading) return;
    setDownloading(true);
    try {
      await exportCredentialPdf(member);
    } catch (err) {
      window.alert(err?.message || 'No se pudo generar el PDF de la credencial.');
    } finally {
      setDownloading(false);
    }
  }, [downloading, member]);

  useEffect(() => {
    if (!expanded) {
      setSecureHide(false);
      return undefined;
    }

    const sync = () => setSecureHide(Boolean(document.hidden));
    const onKey = (e) => {
      if (e.key === 'Escape') closeExpanded();
    };

    const fit = () => {
      const box = fitRef.current;
      if (!box) return;
      const next = Math.min(box.clientWidth / CARD_BASE_W, box.clientHeight / CARD_BASE_H);
      setZoom(Number.isFinite(next) && next > 0 ? next : 1);
    };

    document.addEventListener('visibilitychange', sync);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', fit);
    document.body.style.overflow = 'hidden';
    sync();

    const ro = new ResizeObserver(fit);
    const id = window.requestAnimationFrame(() => {
      if (fitRef.current) ro.observe(fitRef.current);
      fit();
    });

    return () => {
      window.cancelAnimationFrame(id);
      ro.disconnect();
      document.removeEventListener('visibilitychange', sync);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', fit);
      document.body.style.overflow = '';
    };
  }, [expanded, closeExpanded]);

  const overlay = expanded
    ? createPortal(
      <div
        className="vc-secure-overlay"
        role="dialog"
        aria-modal="true"
        aria-label="Credencial virtual a pantalla completa"
        onContextMenu={(e) => e.preventDefault()}
        onClick={closeExpanded}
      >
        <style>{`
          .vc-secure-overlay {
            position: fixed;
            inset: 0;
            z-index: 9999;
            background: radial-gradient(ellipse at 50% 30%, #1a1208 0%, #060e0a 70%);
            display: flex;
            flex-direction: column;
            align-items: center;
            padding: max(4.4rem, env(safe-area-inset-top)) 1rem max(1.1rem, env(safe-area-inset-bottom));
            -webkit-user-select: none;
            user-select: none;
            -webkit-touch-callout: none;
          }
          .vc-secure-top {
            position: absolute;
            top: max(0.75rem, env(safe-area-inset-top));
            left: 1rem;
            right: 1rem;
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 0.75rem;
            z-index: 3;
          }
          .vc-secure-download, .vc-secure-close {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 0.4rem;
            min-height: 42px;
            border-radius: 12px;
            border: 1px solid rgba(255,255,255,0.12);
            background: rgba(255,255,255,0.06);
            color: #fff;
            cursor: pointer;
            font: inherit;
          }
          .vc-secure-download {
            padding: 0 0.9rem;
            font-size: 0.82rem;
            font-weight: 650;
          }
          .vc-secure-download:disabled { opacity: 0.65; cursor: wait; }
          .vc-secure-close { width: 42px; }
          .vc-secure-stage {
            position: relative;
            z-index: 2;
            flex: 1;
            width: 100%;
            min-height: 0;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 0.85rem;
          }
          .vc-secure-fit {
            flex: 1;
            width: 100%;
            min-height: 0;
            display: flex;
            align-items: center;
            justify-content: center;
          }
          .vc-secure-zoom {
            position: relative;
            flex-shrink: 0;
          }
          .vc-secure-zoom .vc-card-face {
            width: ${CARD_BASE_W}px !important;
            max-width: ${CARD_BASE_W}px !important;
          }
          .vc-secure-shield {
            position: absolute;
            inset: 0;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 0.75rem;
            background: #060e0a;
            color: rgba(255,255,255,0.7);
            z-index: 4;
            padding: 2rem;
            text-align: center;
          }
          .vc-secure-shield strong {
            color: var(--primary-gold, #CA390C);
            font-size: 1rem;
          }
          .vc-secure-scan {
            background: #fff;
            border-radius: 16px;
            padding: 12px;
            box-shadow: 0 8px 28px rgba(0,0,0,0.35);
          }
          .vc-secure-foot {
            margin: 0;
            font-size: 0.75rem;
            color: rgba(255,255,255,0.4);
            text-align: center;
            max-width: 280px;
            line-height: 1.4;
            flex-shrink: 0;
          }
          @media print {
            .vc-secure-overlay, .vc-card-face { display: none !important; }
          }
        `}</style>

        <div className="vc-secure-top" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            className="vc-secure-download"
            onClick={downloadPdf}
            disabled={downloading}
          >
            <Download size={15} />
            {downloading ? 'Generando…' : 'Descargar PDF'}
          </button>
          <button type="button" className="vc-secure-close" onClick={closeExpanded} aria-label="Cerrar">
            <X size={20} />
          </button>
        </div>

        {secureHide ? (
          <div className="vc-secure-shield">
            <Lock size={36} color="var(--primary-gold, #CA390C)" />
            <strong>Credencial oculta</strong>
            <p style={{ margin: 0, fontSize: '0.85rem', lineHeight: 1.45 }}>
              Volvé a la app para mostrar tu credencial.
            </p>
          </div>
        ) : (
          <div className="vc-secure-stage" onClick={(e) => e.stopPropagation()}>
            <div className="vc-secure-fit" ref={fitRef}>
              <div
                className="vc-secure-zoom"
                style={{
                  width: CARD_BASE_W * zoom,
                  height: CARD_BASE_H * zoom,
                }}
              >
                <div style={{
                  width: CARD_BASE_W,
                  height: CARD_BASE_H,
                  transform: `scale(${zoom})`,
                  transformOrigin: 'top left',
                }}>
                  <CardFace
                    member={member}
                    t={t}
                    transform="none"
                    isHovered
                    glowPos={{ x: 50, y: 40 }}
                    dimmed={false}
                  />
                </div>
              </div>
            </div>
            {zoom < 1.25 ? (
              <div className="vc-secure-scan" aria-label="Código QR para acceso">
                <QRCodeSVG
                  value={buildCredentialQRPayload(member)}
                  size={168}
                  level="H"
                  includeMargin
                  bgColor="#ffffff"
                  fgColor="#000000"
                />
              </div>
            ) : null}
            <p className="vc-secure-foot">
              Tocá afuera o ✕ para cerrar.
            </p>
          </div>
        )}
      </div>,
      document.body,
    )
    : null;

  return (
    <div
      className="vc-wrap"
      style={{
        margin: '0 auto 1.5rem',
        width: '100%',
        maxWidth: 360,
        WebkitUserSelect: 'none',
        userSelect: 'none',
        WebkitTouchCallout: 'none',
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <style>{`
        .vc-wrap, .vc-card-face {
          -webkit-user-select: none;
          user-select: none;
          -webkit-touch-callout: none;
        }
        .vc-actions {
          display: flex;
          justify-content: center;
          margin-top: 0.65rem;
        }
        .vc-mobile-hint {
          display: block;
          margin-top: 0.45rem;
          text-align: center;
          font-size: 0.72rem;
          color: var(--text-muted);
        }
        .vc-wrap {
          max-width: 100%;
        }
        .vc-wrap .vc-card-face {
          width: 100% !important;
          max-width: 100% !important;
          height: auto !important;
          aspect-ratio: 1.586 / 1;
        }
        @media print {
          .vc-wrap { display: none !important; }
        }
      `}</style>

      <CardFace
        member={member}
        t={t}
        cardRef={cardRef}
        transform={transform}
        isHovered={isHovered}
        glowPos={glowPos}
        onMouseMove={handleMouseMove}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={handleMouseLeave}
        onClick={openExpanded}
      />
      <div className="vc-actions">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={downloadPdf}
          disabled={downloading}
        >
          <Download size={14} />
          {downloading ? 'Generando…' : 'Descargar PDF'}
        </button>
      </div>
      <p className="vc-mobile-hint">Tocá la credencial para verla a pantalla completa</p>
      {overlay}
    </div>
  );
}
