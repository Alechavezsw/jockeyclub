import React, { useState } from 'react';
import { Landmark, QrCode } from 'lucide-react';

export default function VirtualCard({ member }) {
  const [rotate, setRotate] = useState({ x: 0, y: 0 });
  const [isHovered, setIsHovered] = useState(false);

  const handleMouseMove = (e) => {
    const card = e.currentTarget;
    const box = card.getBoundingClientRect();
    const x = e.clientX - box.left - box.width / 2;
    const y = e.clientY - box.top - box.height / 2;
    
    // Calcular grados de rotación (máximo 22 grados para mayor sutilidad y elegancia)
    const rotateX = -(y / box.height) * 22;
    const rotateY = (x / box.width) * 22;
    
    setRotate({ x: rotateX, y: rotateY });
  };

  const handleMouseEnter = () => {
    setIsHovered(true);
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    setRotate({ x: 0, y: 0 });
  };

  const getTierClass = (tier) => {
    switch (tier.toLowerCase()) {
      case 'royal':
        return 'tier-royal';
      case 'platinum':
        return 'tier-platinum';
      default:
        return 'tier-gold';
    }
  };

  // Dividir número de socio en bloques de 4 para apariencia de tarjeta de crédito/prestigio
  const formatMemberId = (id) => {
    if (!id) return '0000 0000 0000 0000';
    return id.replace(/(\d{4})/g, '$1 ').trim();
  };

  return (
    <div 
      className="card-container" 
      style={{
        width: '100%',
        maxWidth: '380px',
        height: '220px',
        margin: '0 auto 1.5rem auto'
      }}
    >
      <div
        className={`virtual-card ${getTierClass(member.tier)}`}
        onMouseMove={handleMouseMove}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        style={{
          transform: `rotateX(${rotate.x}deg) rotateY(${rotate.y}deg) scale(${isHovered ? 1.03 : 1})`,
          transformStyle: 'preserve-3d',
          transition: isHovered ? 'transform 0.05s ease-out' : 'transform 0.5s ease-out',
          height: '100%',
          width: '100%'
        }}
      >
        {/* Lado Frontal de la Tarjeta */}
        <div 
          className={`virtual-card-face`}
          style={{
            transformStyle: 'preserve-3d',
            height: '100%',
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            padding: '1.5rem',
            position: 'absolute',
            top: 0,
            left: 0
          }}
        >
          {/* Cabecera de la Tarjeta */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', transform: 'translateZ(30px)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Landmark size={20} style={{ color: 'var(--primary-gold)' }} />
              <span className="serif-font" style={{
                fontSize: '1rem',
                fontWeight: '700',
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: 'white'
              }}>
                Jockey Club
              </span>
            </div>
            <div className="card-chip" />
          </div>

          {/* Número de Membresía */}
          <div style={{ 
            fontFamily: "'Courier New', monospace", 
            fontSize: '1.25rem', 
            letterSpacing: '0.12em', 
            margin: '1.2rem 0 0.5rem 0',
            color: 'white',
            textShadow: '0 2px 4px rgba(0,0,0,0.5)',
            transform: 'translateZ(40px)'
          }}>
            {formatMemberId(member.memberId)}
          </div>

          {/* Pie de la Tarjeta */}
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            alignItems: 'flex-end',
            transform: 'translateZ(30px)' 
          }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
              <span style={{ fontSize: '0.65rem', textTransform: 'uppercase', color: 'rgba(255,255,255,0.5)', letterSpacing: '0.05em' }}>
                Socio Titular
              </span>
              <span className="serif-font" style={{ fontSize: '0.95rem', fontWeight: '600', color: 'white', letterSpacing: '0.02em' }}>
                {member.name}
              </span>
            </div>
            
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.2rem' }}>
                <span style={{ fontSize: '0.65rem', textTransform: 'uppercase', color: 'rgba(255,255,255,0.5)', letterSpacing: '0.05em' }}>
                  Categoría
                </span>
                <span className="card-holder-tier" style={{
                  fontSize: '0.7rem',
                  fontWeight: '700',
                  color: 'var(--primary-gold)',
                  border: '1px solid var(--primary-gold)',
                  background: 'rgba(207, 161, 58, 0.1)'
                }}>
                  {member.tier}
                </span>
              </div>
              
              {/* Código QR Simulado */}
              <div style={{
                background: 'white',
                padding: '0.25rem',
                borderRadius: '6px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 4px 8px rgba(0,0,0,0.3)',
                width: '38px',
                height: '38px'
              }} title="Código QR de Acceso">
                <QrCode size={30} style={{ color: '#060e0a' }} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
