import { useState, useRef } from 'react';
import { Shield } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { buildCredentialQRPayload } from '../domain/credentials/qr';

export default function VirtualCard({ member }) {
  const cardRef = useRef(null);
  const [transform, setTransform] = useState('');
  const [glowPos, setGlowPos] = useState({ x: 50, y: 50 });
  const [isHovered, setIsHovered] = useState(false);

  const handleMouseMove = (e) => {
    const card = cardRef.current;
    if (!card) return;
    const rect = card.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const rotX = ((y - cy) / cy) * -14;
    const rotY = ((x - cx) / cx) * 14;
    setTransform(`perspective(900px) rotateX(${rotX}deg) rotateY(${rotY}deg) scale(1.03)`);
    setGlowPos({ x: (x / rect.width) * 100, y: (y / rect.height) * 100 });
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    setTransform('perspective(900px) rotateX(0deg) rotateY(0deg) scale(1)');
  };

  const handleMouseEnter = () => setIsHovered(true);

  const tierConfig = {
    royal: {
      bg: 'linear-gradient(135deg, #1a0533 0%, #0e0220 40%, #170533 100%)',
      accent: '#c084fc',
      accentDim: 'rgba(192,132,252,0.3)',
      chipColor: '#a855f7',
      glow: 'rgba(168,85,247,0.35)',
      label: 'ROYAL',
      stripe: 'linear-gradient(90deg, transparent, rgba(192,132,252,0.15), transparent)',
    },
    platinum: {
      bg: 'linear-gradient(135deg, #1a1f2e 0%, #0f1320 40%, #1a1f2e 100%)',
      accent: '#cbd5e1',
      accentDim: 'rgba(203,213,225,0.25)',
      chipColor: '#94a3b8',
      glow: 'rgba(148,163,184,0.3)',
      label: 'PLATINUM',
      stripe: 'linear-gradient(90deg, transparent, rgba(203,213,225,0.1), transparent)',
    },
    gold: {
      bg: 'linear-gradient(135deg, #1c1200 0%, #0f0a00 40%, #1c1200 100%)',
      accent: '#cfa13a',
      accentDim: 'rgba(207,161,58,0.3)',
      chipColor: '#d4af37',
      glow: 'rgba(207,161,58,0.4)',
      label: 'GOLD',
      stripe: 'linear-gradient(90deg, transparent, rgba(207,161,58,0.12), transparent)',
    },
  };

  const t = tierConfig[member?.tier?.toLowerCase()] || tierConfig.gold;

  const formatMemberId = (id) => {
    if (!id) return '•••• •••• •••• ••••';
    const s = String(id).replace(/\D/g, '');
    return s.match(/.{1,4}/g)?.join(' ') || s;
  };

  const cardStyle = {
    position: 'relative',
    width: '100%',
    maxWidth: '360px',
    height: '210px',
    borderRadius: '18px',
    background: t.bg,
    border: `1px solid ${t.accentDim}`,
    boxShadow: isHovered
      ? `0 30px 60px rgba(0,0,0,0.7), 0 0 40px ${t.glow}, inset 0 1px 0 rgba(255,255,255,0.07)`
      : `0 16px 40px rgba(0,0,0,0.5), 0 0 20px ${t.glow}55, inset 0 1px 0 rgba(255,255,255,0.05)`,
    transform: transform || 'perspective(900px)',
    transition: isHovered ? 'box-shadow 0.15s ease' : 'transform 0.5s ease, box-shadow 0.5s ease',
    cursor: 'pointer',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    padding: '1.4rem 1.5rem',
  };

  return (
    <div style={{ margin: '0 auto 1.5rem', width: '100%', maxWidth: '360px' }}>
      <div
        ref={cardRef}
        style={cardStyle}
        onMouseMove={handleMouseMove}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >

        {/* === BACKGROUND EFFECTS === */}
        {/* Shine layer */}
        <div style={{
          position: 'absolute', inset: 0, borderRadius: 'inherit', pointerEvents: 'none',
          background: isHovered
            ? `radial-gradient(circle at ${glowPos.x}% ${glowPos.y}%, rgba(255,255,255,0.07) 0%, transparent 55%)`
            : 'none',
          transition: 'opacity 0.2s ease',
        }} />

        {/* Diagonal stripe decoration */}
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          background: t.stripe,
          opacity: 0.8,
        }} />

        {/* Big circle decorations */}
        <div style={{
          position: 'absolute', right: '-40px', top: '-40px',
          width: '160px', height: '160px', borderRadius: '50%',
          background: `radial-gradient(circle, ${t.accentDim} 0%, transparent 70%)`,
          pointerEvents: 'none',
        }} />
        <div style={{
          position: 'absolute', left: '-30px', bottom: '-50px',
          width: '130px', height: '130px', borderRadius: '50%',
          background: `radial-gradient(circle, ${t.accentDim}80 0%, transparent 70%)`,
          pointerEvents: 'none',
        }} />

        {/* Horizontal lines pattern */}
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          backgroundImage: `repeating-linear-gradient(0deg, rgba(255,255,255,0.012) 0px, rgba(255,255,255,0.012) 1px, transparent 1px, transparent 14px)`,
          borderRadius: 'inherit',
        }} />

        {/* === TOP ROW: Logo + Chip === */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'relative', zIndex: 2 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <div style={{
              width: 36, height: 36, borderRadius: '10px',
              background: `linear-gradient(135deg, ${t.accent}30, ${t.accent}10)`,
              border: `1px solid ${t.accent}50`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Shield size={18} color={t.accent} />
            </div>
            <div>
              <div style={{ fontSize: '0.72rem', fontWeight: '800', letterSpacing: '0.18em', textTransform: 'uppercase', color: t.accent, lineHeight: 1 }}>
                Jockey Club
              </div>
              <div style={{ fontSize: '0.58rem', color: 'rgba(255,255,255,0.35)', letterSpacing: '0.08em', marginTop: '0.15rem' }}>
                SAN JUAN · SEDE RIVADAVIA
              </div>
            </div>
          </div>

          {/* Chip EMV */}
          <div style={{
            width: 42, height: 30, borderRadius: '6px',
            background: `linear-gradient(135deg, ${t.chipColor}cc, ${t.chipColor}88)`,
            border: `1px solid ${t.chipColor}60`,
            boxShadow: `0 2px 8px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.2)`,
            position: 'relative', overflow: 'hidden',
          }}>
            <div style={{ position: 'absolute', inset: 0, background: 'repeating-linear-gradient(90deg, rgba(0,0,0,0.08) 0, rgba(0,0,0,0.08) 1px, transparent 1px, transparent 7px)' }} />
            <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: '1px', background: 'rgba(0,0,0,0.15)', transform: 'translateY(-50%)' }} />
          </div>
        </div>

        {/* === MEMBER NUMBER === */}
        <div style={{ position: 'relative', zIndex: 2 }}>
          <div style={{
            fontFamily: "'Courier New', monospace",
            fontSize: '1.1rem',
            letterSpacing: '0.18em',
            color: 'rgba(255,255,255,0.9)',
            textShadow: `0 0 20px ${t.glow}`,
            fontWeight: '600',
          }}>
            {formatMemberId(member?.memberId)}
          </div>
        </div>

        {/* === BOTTOM ROW === */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', position: 'relative', zIndex: 2, gap: '0.65rem' }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '0.65rem', minWidth: 0 }}>
            {member?.photo && (
              <div style={{
                width: 44,
                height: 44,
                borderRadius: 10,
                overflow: 'hidden',
                flexShrink: 0,
                border: `1px solid ${t.accent}55`,
                boxShadow: `0 2px 10px rgba(0,0,0,0.45)`,
              }}>
                <img src={member.photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              </div>
            )}
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '0.55rem', textTransform: 'uppercase', letterSpacing: '0.12em', color: 'rgba(255,255,255,0.35)', marginBottom: '0.25rem' }}>
                Titular
              </div>
              <div style={{
                fontFamily: "'Playfair Display', serif",
                fontSize: '0.92rem', fontWeight: '700',
                color: '#fff',
                letterSpacing: '0.04em',
                textShadow: '0 1px 4px rgba(0,0,0,0.5)',
                maxWidth: member?.photo ? '140px' : '180px',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}>
                {member?.name}
              </div>
              <div style={{ marginTop: '0.35rem' }}>
                <span style={{
                  fontSize: '0.6rem', fontWeight: '800',
                  textTransform: 'uppercase', letterSpacing: '0.1em',
                  color: t.accent,
                  background: `${t.accent}15`,
                  border: `1px solid ${t.accent}40`,
                  padding: '0.15rem 0.5rem',
                  borderRadius: '6px',
                }}>
                  {t.label}
                </span>
              </div>
            </div>
          </div>

          {/* QR Code real: codifica la credencial del socio */}
          <div style={{
            background: 'rgba(255,255,255,0.96)',
            borderRadius: '10px',
            padding: '5px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: `0 4px 16px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.1)`,
            width: '48px', height: '48px',
            flexShrink: 0,
          }}>
            <QRCodeSVG value={buildCredentialQRPayload(member)} size={38} level="M" bgColor="transparent" fgColor="#060e0a" />
          </div>
        </div>

      </div>
    </div>
  );
}
