import { useState } from 'react';
import VirtualCard from '../components/VirtualCard';
import {
  Calendar, CreditCard, MapPin, ShieldAlert,
  ArrowRight, Mail, Users, Send, MessageSquare, CheckCircle2,
  Clock, Info, ChevronRight, X, Sparkles, Radio, Bell,
  Activity, Trophy, Wind
} from 'lucide-react';

export default function DashboardView({ 
  member, 
  reservations, 
  cancelReservation, 
  setCurrentView, 
  latestNews,
  staffMembers = [],
  claims = [],
  setClaims,
  messages = [],
  setMessages,
  isZondaActive,
  setIsZondaActive,
  surveys = [],
  setSurveys
}) {
  const [showNewClaimForm, setShowNewClaimForm] = useState(false);
  const [claimType, setClaimType] = useState('Mantenimiento');
  const [claimTitle, setClaimTitle] = useState('');
  const [claimDesc, setClaimDesc] = useState('');
  const [claimSuccess, setClaimSuccess] = useState(false);
  const [selectedAdherent, setSelectedAdherent] = useState(null);
  const [selectedOptions, setSelectedOptions] = useState({});
  const [hoveredSegments, setHoveredSegments] = useState({});

  const handleCastVote = (surveyId) => {
    const selectedOptId = selectedOptions[surveyId];
    if (!selectedOptId) return;
    const updatedSurveys = surveys.map(s => {
      if (s.id === surveyId) {
        return {
          ...s,
          votedBy: [...s.votedBy, member.memberId],
          options: s.options.map(opt => {
            if (opt.id === selectedOptId) return { ...opt, votes: opt.votes + 1 };
            return opt;
          })
        };
      }
      return s;
    });
    setSurveys(updatedSurveys);
  };

  const memberReservations = reservations.filter(res => res.memberId === member.memberId);
  const activeReservationsCount = memberReservations.filter(res => res.status !== 'cancelled').length;
  const memberMessages = messages.filter(msg => msg.recipientId === member.memberId || msg.recipientId === 'all');
  const unreadMessagesCount = memberMessages.filter(msg => !msg.isRead).length;
  const memberClaims = claims.filter(clm => clm.memberId === member.memberId);

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 }).format(amount);
  };

  const greenkeeper = staffMembers.find(s => s.role === 'Head Greenkeeper');
  const directoraHipica = staffMembers.find(s => s.role === 'Directora Hípica y Turf');

  const handleMarkAsRead = (msgId) => {
    setMessages(prev => prev.map(msg => msg.id === msgId ? { ...msg, isRead: true } : msg));
  };

  const handleCreateClaim = (e) => {
    e.preventDefault();
    if (!claimTitle.trim() || !claimDesc.trim()) return;
    const newClaim = {
      id: Date.now(),
      date: new Date().toISOString().split('T')[0],
      memberName: member.name,
      memberId: member.memberId,
      type: claimType,
      title: claimTitle.trim(),
      description: claimDesc.trim(),
      status: 'pending',
      assignedStaff: '',
      response: ''
    };
    setClaims([newClaim, ...claims]);
    setClaimTitle('');
    setClaimDesc('');
    setClaimSuccess(true);
    setTimeout(() => { setClaimSuccess(false); setShowNewClaimForm(false); }, 2000);
  };

  const tierColors = {
    royal: { primary: '#a855f7', secondary: 'rgba(168,85,247,0.15)', label: '👑 Royal' },
    platinum: { primary: '#94a3b8', secondary: 'rgba(148,163,184,0.15)', label: '💎 Platinum' },
    gold: { primary: 'var(--primary-gold)', secondary: 'rgba(207,161,58,0.15)', label: '⭐ Gold' },
  };
  const tc = tierColors[member.tier] || tierColors.gold;

  return (
    <div className="fade-in">
      <style>{`
        /* ---- DASHBOARD PREMIUM STYLES ---- */
        .db-hero {
          position: relative;
          border-radius: 20px;
          overflow: hidden;
          margin-bottom: 2rem;
          background: linear-gradient(135deg, var(--hero-grad-a) 0%, var(--hero-grad-b) 100%);
          border: 1px solid var(--border-glass);
          box-shadow: var(--shadow-premium), inset 0 1px 0 rgba(255,255,255,0.05);
        }
        .db-hero-bg {
          position: absolute;
          inset: 0;
          background: 
            radial-gradient(ellipse 60% 50% at 80% 50%, ${tc.secondary} 0%, transparent 70%),
            radial-gradient(ellipse 40% 60% at 10% 80%, rgba(16,185,129,0.06) 0%, transparent 60%);
          pointer-events: none;
        }
        .db-hero-content {
          position: relative;
          z-index: 2;
          padding: 2.5rem;
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 2rem;
          flex-wrap: wrap;
        }
        .db-hero-left { display: flex; flex-direction: column; gap: 1rem; }
        .db-hero-greeting {
          font-size: 0.85rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.2em;
          color: var(--text-muted);
        }
        .db-hero-name {
          font-family: 'Playfair Display', serif;
          font-size: 2.5rem;
          font-weight: 700;
          line-height: 1.1;
          background: linear-gradient(135deg, var(--text-strong) 0%, var(--text-secondary) 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }
        .db-hero-badge {
          display: inline-flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.4rem 1rem;
          border-radius: 30px;
          font-size: 0.8rem;
          font-weight: 700;
          letter-spacing: 0.05em;
          width: fit-content;
          border: 1px solid ${tc.primary}40;
          background: ${tc.secondary};
          color: ${tc.primary};
        }
        .db-hero-stats {
          display: flex;
          gap: 2rem;
          margin-top: 0.5rem;
        }
        .db-hero-stat { display: flex; flex-direction: column; gap: 0.15rem; }
        .db-hero-stat-val {
          font-size: 1.75rem;
          font-weight: 800;
          color: var(--text-strong);
          line-height: 1;
        }
        .db-hero-stat-lbl {
          font-size: 0.7rem;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--text-muted);
        }
        .db-hero-card-wrapper {
          flex-shrink: 0;
        }

        /* Quick Actions Bar */
        .db-quick-bar {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 1rem;
          margin-bottom: 2rem;
        }
        .db-quick-btn {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.6rem;
          padding: 1.25rem 1rem;
          border-radius: 16px;
          background: var(--surface-soft);
          border: 1px solid var(--border-glass);
          cursor: pointer;
          transition: all 0.25s ease;
          text-align: center;
        }
        .db-quick-btn:hover {
          background: rgba(255,255,255,0.05);
          border-color: var(--primary-gold);
          transform: translateY(-3px);
          box-shadow: 0 8px 25px rgba(207,161,58,0.12);
        }
        .db-quick-btn-icon {
          width: 48px;
          height: 48px;
          border-radius: 14px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 1.2rem;
        }
        .db-quick-btn-label {
          font-size: 0.78rem;
          font-weight: 600;
          color: var(--text-secondary);
          line-height: 1.2;
        }
        .db-quick-btn-sub {
          font-size: 0.68rem;
          color: var(--text-muted);
        }

        /* Content Grid */
        .db-grid {
          display: grid;
          grid-template-columns: 340px 1fr;
          gap: 1.5rem;
          align-items: start;
        }
        @media (max-width: 1100px) {
          .db-grid { grid-template-columns: 1fr; }
          .db-quick-bar { grid-template-columns: repeat(2, 1fr); }
        }
        @media (max-width: 420px) {
          .db-quick-bar { grid-template-columns: 1fr; }
        }

        /* Cards premium */
        .db-card {
          background: var(--surface-card);
          border: 1px solid var(--border-glass);
          border-radius: 18px;
          padding: 1.5rem;
          display: flex;
          flex-direction: column;
          gap: 1.25rem;
          backdrop-filter: blur(10px);
          transition: border-color 0.2s ease;
        }
        .db-card:hover { border-color: var(--border-glass-hover); }
        .db-card-title {
          display: flex;
          align-items: center;
          gap: 0.6rem;
          font-family: 'Playfair Display', serif;
          font-size: 1.15rem;
          color: var(--text-primary);
          font-weight: 600;
        }
        .db-card-title-icon {
          width: 34px;
          height: 34px;
          border-radius: 10px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }

        /* Stat widgets premium */
        .db-stat-row {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 1rem;
          margin-bottom: 1.5rem;
        }
        @media (max-width: 900px) {
          .db-stat-row { grid-template-columns: 1fr 1fr; }
        }
        @media (max-width: 520px) {
          .db-stat-row { grid-template-columns: 1fr; }
          .db-stat-value { font-size: 1.35rem; }
        }
        .db-stat-card {
          border-radius: 16px;
          padding: 1.25rem;
          display: flex;
          flex-direction: column;
          gap: 0.6rem;
          position: relative;
          overflow: hidden;
          border: 1px solid rgba(255,255,255,0.04);
        }
        .db-stat-card::before {
          content: '';
          position: absolute;
          top: 0; right: 0;
          width: 80px; height: 80px;
          border-radius: 50%;
          opacity: 0.08;
          transform: translate(20px, -20px);
        }
        .db-stat-label { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-muted); font-weight: 600; }
        .db-stat-value { font-size: 1.6rem; font-weight: 800; line-height: 1; }
        .db-stat-sub { font-size: 0.72rem; color: var(--text-muted); }

        /* Sport cards */
        .db-sport-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 0.75rem;
        }
        @media (max-width: 900px) {
          .db-sport-grid { grid-template-columns: 1fr 1fr; }
        }
        @media (max-width: 520px) {
          .db-sport-grid { grid-template-columns: 1fr; }
        }
        .db-sport-card {
          border-radius: 14px;
          padding: 1rem;
          border: 1px solid rgba(255,255,255,0.05);
          display: flex;
          flex-direction: column;
          gap: 0.6rem;
          transition: all 0.2s ease;
        }
        .db-sport-card:hover {
          transform: translateY(-2px);
          border-color: rgba(255,255,255,0.1);
        }
        .db-sport-name { font-size: 0.95rem; font-weight: 700; color: var(--text-strong); }
        .db-sport-sub { font-size: 0.7rem; color: var(--text-muted); }
        .db-sport-progress-track {
          height: 4px;
          background: rgba(255,255,255,0.06);
          border-radius: 2px;
          overflow: hidden;
        }
        .db-sport-progress-bar {
          height: 100%;
          border-radius: 2px;
          transition: width 1s ease-out;
        }
        .db-sport-pill {
          display: inline-block;
          font-size: 0.68rem;
          font-weight: 700;
          padding: 0.15rem 0.5rem;
          border-radius: 10px;
          width: fit-content;
        }

        /* Messages */
        .db-msg-item {
          padding: 0.85rem 1rem;
          border-radius: 12px;
          border: 1px solid var(--border-glass);
          cursor: pointer;
          transition: all 0.2s ease;
          background: var(--surface-softer);
        }
        .db-msg-item.unread {
          border-left: 3px solid var(--primary-gold);
          background: rgba(207,161,58,0.03);
        }
        .db-msg-item:hover { background: rgba(255,255,255,0.025); border-color: var(--border-glass-hover); }

        /* Reservations */
        .db-res-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 0.85rem 1rem;
          border-radius: 12px;
          background: var(--surface-soft);
          border: 1px solid var(--border-glass);
          transition: all 0.2s ease;
          gap: 1rem;
          flex-wrap: wrap;
        }
        .db-res-item:hover { background: rgba(255,255,255,0.035); border-color: var(--border-glass-hover); }

        /* Claim items */
        .db-claim-item {
          padding: 1rem;
          border-radius: 12px;
          background: var(--surface-softer);
          border: 1px solid var(--border-glass);
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
          transition: border-color 0.2s ease;
        }
        .db-claim-item:hover { border-color: var(--border-glass-hover); }

        /* News cards */
        .db-news-item {
          border-radius: 12px;
          overflow: hidden;
          border: 1px solid var(--border-glass);
          cursor: pointer;
          transition: all 0.2s ease;
          background: var(--surface-softer);
          display: grid;
          grid-template-columns: 80px 1fr;
        }
        .db-news-item:hover { border-color: var(--primary-gold); transform: translateY(-2px); box-shadow: 0 8px 20px rgba(0,0,0,0.3); }
        .db-news-thumb { background: rgba(255,255,255,0.03); display: flex; align-items: center; justify-content: center; }

        /* Facility status pills */
        .facility-row {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          padding: 0.6rem 0.75rem;
          border-radius: 10px;
          background: var(--surface-softer);
          border: 1px solid rgba(255,255,255,0.03);
        }

        /* Modal */
        .db-modal-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.85);
          backdrop-filter: blur(8px);
          display: flex;
          justify-content: center;
          align-items: center;
          z-index: 1000;
        }
        .db-modal-content {
          animation: modalIn 0.3s cubic-bezier(0.34,1.56,0.64,1);
        }
        @keyframes modalIn {
          from { transform: scale(0.88) translateY(20px); opacity: 0; }
          to { transform: scale(1) translateY(0); opacity: 1; }
        }

        /* Weather widget */
        .db-weather {
          border-radius: 16px;
          padding: 1.25rem;
          background: var(--weather-grad);
          border: 1px solid rgba(16,185,129,0.12);
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }
        .db-weather.zonda {
          background: var(--weather-grad-zonda);
          border-color: rgba(239,68,68,0.2);
        }
        .db-temp {
          font-size: 3rem;
          font-weight: 900;
          line-height: 1;
          color: #fff;
        }

        /* Adherent rows */
        .db-adherent-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0.65rem 0.85rem;
          border-radius: 12px;
          border: 1px solid var(--border-glass);
          background: var(--surface-softer);
          transition: all 0.2s ease;
        }
        .db-adherent-row:hover { border-color: var(--primary-gold); background: rgba(207,161,58,0.03); }
      `}</style>

      {/* ===== HERO BANNER ===== */}
      <div className="db-hero">
        <div className="db-hero-bg" />
        <div className="db-hero-content">
          <div className="db-hero-left">
            <p className="db-hero-greeting">✦ Bienvenido de vuelta</p>
            <h1 className="db-hero-name">{member.name.split(' ')[0]}<br/>{member.name.split(' ').slice(1).join(' ')}</h1>
            <div className="db-hero-badge">
              {tc.label} · {member.yearsActive} años como socio
            </div>
            <div className="db-hero-stats">
              <div className="db-hero-stat">
                <span className="db-hero-stat-val">{activeReservationsCount}</span>
                <span className="db-hero-stat-lbl">Reservas activas</span>
              </div>
              <div style={{ width: 1, background: 'rgba(255,255,255,0.08)' }} />
              <div className="db-hero-stat">
                <span className="db-hero-stat-val" style={{ color: member.outstandingBalance > 0 ? '#f59e0b' : 'var(--emerald-accent)' }}>
                  {member.outstandingBalance > 0 ? formatCurrency(member.outstandingBalance) : 'Al día'}
                </span>
                <span className="db-hero-stat-lbl">Estado de cuenta</span>
              </div>
              {unreadMessagesCount > 0 && (
                <>
                  <div style={{ width: 1, background: 'rgba(255,255,255,0.08)' }} />
                  <div className="db-hero-stat">
                    <span className="db-hero-stat-val" style={{ color: 'var(--primary-gold)' }}>{unreadMessagesCount}</span>
                    <span className="db-hero-stat-lbl">Mensajes nuevos</span>
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="db-hero-card-wrapper">
            <VirtualCard member={member} />
          </div>
        </div>
      </div>

      {/* ===== QUICK ACTIONS ===== */}
      <div className="db-quick-bar">
        <div className="db-quick-btn" onClick={() => setCurrentView('reservations')}>
          <div className="db-quick-btn-icon" style={{ background: 'rgba(207,161,58,0.12)', color: 'var(--primary-gold)' }}>
            <Calendar size={22} />
          </div>
          <span className="db-quick-btn-label">Reservar Cancha</span>
          <span className="db-quick-btn-sub">Tenis · Rugby · Hípica</span>
        </div>
        <div className="db-quick-btn" onClick={() => setCurrentView('news')}>
          <div className="db-quick-btn-icon" style={{ background: 'rgba(16,185,129,0.12)', color: 'var(--emerald-accent)' }}>
            <Bell size={22} />
          </div>
          <span className="db-quick-btn-label">Noticias del Club</span>
          <span className="db-quick-btn-sub">Eventos · Anuncios</span>
        </div>
        <div className="db-quick-btn" onClick={() => setShowNewClaimForm(!showNewClaimForm)}>
          <div className="db-quick-btn-icon" style={{ background: 'rgba(99,102,241,0.12)', color: '#818cf8' }}>
            <MessageSquare size={22} />
          </div>
          <span className="db-quick-btn-label">Enviar Reclamo</span>
          <span className="db-quick-btn-sub">Atención directa</span>
        </div>
        <div className="db-quick-btn" onClick={() => setIsZondaActive(!isZondaActive)}>
          <div className="db-quick-btn-icon" style={{ background: isZondaActive ? 'rgba(239,68,68,0.15)' : 'rgba(255,255,255,0.04)', color: isZondaActive ? '#ef4444' : 'var(--text-secondary)' }}>
            <Wind size={22} />
          </div>
          <span className="db-quick-btn-label">{isZondaActive ? '⚠ Zonda Activo' : 'Estado Zonda'}</span>
          <span className="db-quick-btn-sub">{isZondaActive ? 'Actividades suspendidas' : 'Sin alertas activas'}</span>
        </div>
      </div>

      {/* ===== MAIN GRID ===== */}
      <div className="db-grid">

        {/* ===== COLUMNA IZQUIERDA ===== */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

          {/* Grupo Familiar */}
          <div className="db-card">
            <div className="db-card-title">
              <div className="db-card-title-icon" style={{ background: 'rgba(207,161,58,0.1)', color: 'var(--primary-gold)' }}>
                <Users size={16} />
              </div>
              Grupo Familiar
              <span style={{ marginLeft: 'auto', fontSize: '0.75rem', background: 'rgba(255,255,255,0.04)', padding: '0.2rem 0.5rem', borderRadius: '8px', color: 'var(--text-muted)' }}>
                {member.adherents?.length || 0} adherentes
              </span>
            </div>
            {!member.adherents || member.adherents.length === 0 ? (
              <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', textAlign: 'center', padding: '0.75rem' }}>
                Sin adherentes familiares registrados.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {member.adherents.map(adh => (
                  <div key={adh.id} className="db-adherent-row">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                      <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'rgba(207,161,58,0.1)', border: '1px solid rgba(207,161,58,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: '700', color: 'var(--primary-gold)' }}>
                        {adh.name.split(' ').map(n => n[0]).slice(0,2).join('').toUpperCase()}
                      </div>
                      <div>
                        <div style={{ fontSize: '0.85rem', fontWeight: '600', color: 'var(--text-primary)' }}>{adh.name}</div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{adh.relationship}</div>
                      </div>
                    </div>
                    <button onClick={() => setSelectedAdherent(adh)} className="btn btn-secondary btn-sm" style={{ padding: '0.2rem 0.6rem', fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                      Credencial <ChevronRight size={10} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Clima & Instalaciones */}
          <div className={`db-weather ${isZondaActive ? 'zonda' : ''}`}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <p style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-muted)', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                  <MapPin size={10} /> Rivadavia, San Juan
                </p>
                <div className="db-temp" style={{ color: isZondaActive ? '#f87171' : 'var(--text-strong)' }}>
                  {isZondaActive ? '38°' : '22°'}
                </div>
                <p style={{ fontSize: '0.9rem', fontWeight: '600', marginTop: '0.25rem' }}>{isZondaActive ? 'Viento Zonda Fuerte' : 'Soleado y Templado'}</p>
                <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>{isZondaActive ? 'Humedad: 12% · Ráfagas: 78 km/h' : 'Humedad: 48% · Viento: 8 km/h Sur'}</p>
              </div>
              <div style={{ fontSize: '3.5rem', opacity: 0.7 }}>{isZondaActive ? '🌬️' : '☀️'}</div>
            </div>

            {isZondaActive && (
              <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: '10px', padding: '0.75rem', fontSize: '0.8rem', color: '#f87171', display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }} className="fade-in">
                <ShieldAlert size={14} style={{ flexShrink: 0, marginTop: '1px' }} />
                <span>Reservas de canchas y actividades al aire libre suspendidas por razones de seguridad.</span>
              </div>
            )}

            <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {[
                { label: 'Canchas Rugby & Hockey', ok: !isZondaActive, detail: isZondaActive ? 'SUSPENDIDO' : greenkeeper?.status === 'active' ? 'Habilitado c/ Precaución' : 'Condiciones óptimas' },
                { label: 'Pistas Hípicas & Turf', ok: !isZondaActive && directoraHipica?.status === 'active', detail: isZondaActive ? 'SUSPENDIDO' : directoraHipica?.status === 'active' ? 'Coordinador activo' : 'Pre-calentamiento' },
                { label: 'Piscina de Verano', ok: false, detail: 'Cerrada · Temporada Dic–Mar' },
              ].map((f, i) => (
                <div key={i} className="facility-row">
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: f.ok ? 'var(--emerald-accent)' : '#ef4444', boxShadow: `0 0 6px ${f.ok ? 'var(--emerald-accent)' : '#ef4444'}`, flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '0.78rem', fontWeight: '600', color: 'var(--text-primary)' }}>{f.label}</div>
                    <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{f.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Últimos Anuncios */}
          {latestNews && latestNews.length > 0 && (
            <div className="db-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div className="db-card-title">
                  <div className="db-card-title-icon" style={{ background: 'rgba(99,102,241,0.1)', color: '#818cf8' }}>
                    <Sparkles size={16} />
                  </div>
                  Novedades
                </div>
                <button onClick={() => setCurrentView('news')} className="btn btn-secondary btn-sm" style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem' }}>
                  Ver todas
                </button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {latestNews.slice(0, 3).map(item => (
                  <div key={item.id} className="db-news-item" onClick={() => setCurrentView('news')}>
                    <div className="db-news-thumb" style={{ padding: '0.75rem' }}>
                      <div style={{ fontSize: '1.5rem' }}>{item.category === 'deportes' ? '🏉' : item.category === 'eventos' ? '🎪' : '🏗️'}</div>
                    </div>
                    <div style={{ padding: '0.75rem' }}>
                      <p style={{ fontSize: '0.65rem', color: 'var(--primary-gold)', textTransform: 'uppercase', fontWeight: '700', marginBottom: '0.25rem' }}>{item.category}</p>
                      <p style={{ fontSize: '0.82rem', fontWeight: '600', color: 'var(--text-primary)', lineHeight: 1.3, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{item.title}</p>
                      <p style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>{item.date}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ===== COLUMNA DERECHA ===== */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

          {/* Stats Row */}
          <div className="db-stat-row">
            <div className="db-stat-card" style={{ background: 'linear-gradient(135deg, rgba(207,161,58,0.12) 0%, rgba(6,14,10,0.8) 100%)', borderColor: 'rgba(207,161,58,0.2)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <CreditCard size={16} color="var(--primary-gold)" />
                <span className="db-stat-label">Estado Contable</span>
              </div>
              <div className="db-stat-value" style={{ color: member.outstandingBalance > 0 ? '#f59e0b' : 'var(--emerald-accent)' }}>
                {member.outstandingBalance > 0 ? formatCurrency(member.outstandingBalance) : '✓ Al Día'}
              </div>
              <span className="db-stat-sub">{member.outstandingBalance > 0 ? 'Pago pendiente' : 'Próx. cobro: 01/06'}</span>
            </div>

            <div className="db-stat-card" style={{ background: 'linear-gradient(135deg, rgba(16,185,129,0.12) 0%, rgba(6,14,10,0.8) 100%)', borderColor: 'rgba(16,185,129,0.2)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Calendar size={16} color="var(--emerald-accent)" />
                <span className="db-stat-label">Próximos Turnos</span>
              </div>
              <div className="db-stat-value" style={{ color: 'var(--emerald-accent)' }}>{activeReservationsCount}</div>
              <span className="db-stat-sub">Reservas confirmadas</span>
            </div>

            <div className="db-stat-card" style={{ background: `linear-gradient(135deg, ${tc.secondary} 0%, rgba(6,14,10,0.8) 100%)`, borderColor: `${tc.primary}25` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Trophy size={16} color={tc.primary} />
                <span className="db-stat-label">Membresía</span>
              </div>
              <div className="db-stat-value" style={{ color: tc.primary, textTransform: 'capitalize' }}>{member.tier}</div>
              <span className="db-stat-sub">{member.yearsActive} años de antigüedad</span>
            </div>
          </div>

          {/* Perfil Deportivo */}
          <div className="db-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div className="db-card-title">
                <div className="db-card-title-icon" style={{ background: 'rgba(16,185,129,0.1)', color: 'var(--emerald-accent)' }}>
                  <Activity size={16} />
                </div>
                Mi Perfil Deportivo
              </div>
              <button className="btn btn-secondary btn-sm" style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem' }}>Editar</button>
            </div>

            <div className="db-sport-grid">
              {[
                { name: 'Turf', sub: 'Caballeriza', val: 'El Triunfo', detail: '3 ejemplares · Propietario', pct: 70, color: 'var(--primary-gold)', bg: 'rgba(207,161,58,0.08)', pill: 'Propietario', pillBg: 'rgba(207,161,58,0.15)', pillColor: 'var(--primary-gold)', emoji: '🏇' },
                { name: 'Hockey', sub: 'División', val: '1ra Damas', detail: 'Asistencia: 95%', pct: 85, color: 'var(--emerald-accent)', bg: 'rgba(16,185,129,0.08)', pill: 'Excelente', pillBg: 'rgba(16,185,129,0.15)', pillColor: 'var(--emerald-accent)', emoji: '🏑' },
                { name: 'Rugby', sub: 'Plantel', val: 'Superior', detail: 'Próx. Sábado · Titular', pct: 90, color: '#818cf8', bg: 'rgba(99,102,241,0.08)', pill: 'Titular', pillBg: 'rgba(99,102,241,0.15)', pillColor: '#818cf8', emoji: '🏉' },
              ].map((sport, i) => (
                <div key={i} className="db-sport-card" style={{ background: sport.bg, borderColor: `${sport.color}20` }}>
                  <div style={{ fontSize: '1.5rem', marginBottom: '0.15rem' }}>{sport.emoji}</div>
                  <div>
                    <div className="db-sport-name">{sport.name}</div>
                    <div className="db-sport-sub">{sport.sub}</div>
                  </div>
                  <div style={{ fontSize: '1rem', fontWeight: '700', color: sport.color }}>{sport.val}</div>
                  <div className="db-sport-progress-track">
                    <div className="db-sport-progress-bar" style={{ width: `${sport.pct}%`, background: sport.color }} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>{sport.detail}</span>
                    <span className="db-sport-pill" style={{ background: sport.pillBg, color: sport.pillColor }}>{sport.pill}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Mensajes */}
          <div className="db-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div className="db-card-title">
                <div className="db-card-title-icon" style={{ background: 'rgba(207,161,58,0.1)', color: 'var(--primary-gold)' }}>
                  <Mail size={16} />
                </div>
                Comunicados de Secretaría
              </div>
              {unreadMessagesCount > 0 && (
                <span style={{ background: 'var(--primary-gold)', color: '#060e0a', borderRadius: '20px', padding: '0.2rem 0.65rem', fontSize: '0.72rem', fontWeight: '800' }}>
                  {unreadMessagesCount} nuevos
                </span>
              )}
            </div>

            {memberMessages.length === 0 ? (
              <p style={{ textAlign: 'center', padding: '1rem', fontSize: '0.82rem', color: 'var(--text-muted)' }}>Sin mensajes en el buzón.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                {memberMessages.map(msg => (
                  <div key={msg.id} className={`db-msg-item ${!msg.isRead ? 'unread' : ''}`} onClick={() => handleMarkAsRead(msg.id)}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                      <span style={{ fontSize: '0.7rem', fontWeight: '700', color: 'var(--primary-gold)', textTransform: 'uppercase' }}>{msg.sender}</span>
                      <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{msg.date}</span>
                    </div>
                    <p style={{ fontSize: '0.88rem', color: 'var(--text-primary)', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      {!msg.isRead && <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--primary-gold)', display: 'inline-block', flexShrink: 0 }} />}
                      {msg.subject}
                    </p>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{msg.content}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Reservas */}
          <div className="db-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div className="db-card-title">
                <div className="db-card-title-icon" style={{ background: 'rgba(16,185,129,0.1)', color: 'var(--emerald-accent)' }}>
                  <Calendar size={16} />
                </div>
                Mis Reservas
              </div>
              <button onClick={() => setCurrentView('reservations')} className="btn btn-primary btn-sm" style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', padding: '0.35rem 0.75rem', fontSize: '0.8rem' }}>
                + Nueva <ArrowRight size={12} />
              </button>
            </div>

            {memberReservations.filter(res => res.status !== 'cancelled').length === 0 ? (
              <div style={{ textAlign: 'center', padding: '2rem 1rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem' }}>
                <Calendar size={40} style={{ color: 'var(--text-muted)', strokeWidth: 1 }} />
                <div>
                  <p style={{ fontWeight: '600', marginBottom: '0.25rem' }}>Sin reservas programadas</p>
                  <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>Reservá tus instalaciones favoritas</p>
                </div>
                <button onClick={() => setCurrentView('reservations')} className="btn btn-primary" style={{ marginTop: '0.25rem' }}>
                  Hacer una Reserva
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                {memberReservations.filter(res => res.status !== 'cancelled').map(res => (
                  <div key={res.id} className="db-res-item">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <div style={{ width: 40, height: 40, borderRadius: '12px', background: 'rgba(16,185,129,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <Calendar size={18} color="var(--emerald-accent)" />
                      </div>
                      <div>
                        <p style={{ fontSize: '0.88rem', fontWeight: '600', color: 'var(--text-primary)' }}>{res.facilityName}</p>
                        <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                          <MapPin size={10} color="var(--primary-gold)" /> {res.date} · {res.time} hs
                        </p>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <span className={`status-tag ${res.status}`} style={{ fontSize: '0.72rem', padding: '0.2rem 0.5rem' }}>
                        {res.status === 'confirmed' ? '✓ Confirmado' : '⏳ Pendiente'}
                      </span>
                      <button onClick={() => cancelReservation(res.id)} className="btn btn-danger btn-sm" style={{ fontSize: '0.72rem', padding: '0.25rem 0.6rem' }}>
                        Cancelar
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Reclamos */}
          <div className="db-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
              <div className="db-card-title">
                <div className="db-card-title-icon" style={{ background: 'rgba(99,102,241,0.1)', color: '#818cf8' }}>
                  <MessageSquare size={16} />
                </div>
                Pedidos & Reclamos
              </div>
              <button onClick={() => { setShowNewClaimForm(!showNewClaimForm); setClaimSuccess(false); }} className="btn btn-primary btn-sm" style={{ fontSize: '0.8rem', padding: '0.35rem 0.75rem' }}>
                {showNewClaimForm ? 'Cerrar' : '+ Nueva Solicitud'}
              </button>
            </div>

            {showNewClaimForm && (
              <form onSubmit={handleCreateClaim} style={{ background: 'var(--surface-soft)', border: '1px solid var(--border-glass)', borderRadius: '14px', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.85rem' }} className="fade-in">
                {claimSuccess ? (
                  <div style={{ textAlign: 'center', padding: '1rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
                    <CheckCircle2 size={36} color="var(--emerald-accent)" />
                    <p style={{ fontWeight: '600' }}>¡Solicitud enviada con éxito!</p>
                    <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Será evaluada por el supervisor del sector.</p>
                  </div>
                ) : (
                  <>
                    <div className="db-claim-grid" style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: '0.75rem' }}>
                      <style>{`@media (max-width: 600px) { .db-claim-grid { grid-template-columns: 1fr !important; } }`}</style>
                      <div>
                        <label style={{ fontSize: '0.72rem', textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.05em', display: 'block', marginBottom: '0.35rem' }}>Sector</label>
                        <select className="form-input" value={claimType} onChange={e => setClaimType(e.target.value)} style={{ padding: '0.5rem', fontSize: '0.82rem' }}>
                          {['Mantenimiento', 'Gourmet', 'Hípica', 'Administración', 'Otro'].map(opt => (
                            <option key={opt} value={opt} style={{ background: 'var(--bg-secondary)' }}>{opt}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label style={{ fontSize: '0.72rem', textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.05em', display: 'block', marginBottom: '0.35rem' }}>Asunto</label>
                        <input type="text" placeholder="Ej: Red de tenis desgarrada" className="form-input" value={claimTitle} onChange={e => setClaimTitle(e.target.value)} style={{ padding: '0.5rem', fontSize: '0.82rem' }} required />
                      </div>
                    </div>
                    <div>
                      <label style={{ fontSize: '0.72rem', textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.05em', display: 'block', marginBottom: '0.35rem' }}>Descripción</label>
                      <textarea placeholder="Describa ampliamente el reclamo..." className="form-input" value={claimDesc} onChange={e => setClaimDesc(e.target.value)} style={{ padding: '0.55rem', fontSize: '0.82rem', minHeight: '75px', fontFamily: 'inherit', resize: 'vertical' }} required />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <button type="submit" className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', padding: '0.5rem 1.25rem', fontSize: '0.85rem' }}>
                        <Send size={12} /> Enviar a Secretaría
                      </button>
                    </div>
                  </>
                )}
              </form>
            )}

            {memberClaims.length === 0 && !showNewClaimForm ? (
              <p style={{ textAlign: 'center', fontSize: '0.82rem', color: 'var(--text-muted)', padding: '0.75rem' }}>Sin solicitudes enviadas en este período.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                {memberClaims.map(clm => (
                  <div key={clm.id} className="db-claim-item">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.35rem' }}>
                      <span style={{ fontSize: '0.88rem', fontWeight: '600', color: 'var(--text-primary)' }}>{clm.title}</span>
                      <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{clm.date}</span>
                    </div>
                    <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{clm.description}</p>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', paddingTop: '0.25rem', borderTop: '1px solid rgba(255,255,255,0.03)' }}>
                      {clm.status === 'pending' && <span style={{ fontSize: '0.75rem', color: '#f59e0b', display: 'flex', alignItems: 'center', gap: '0.25rem' }}><Clock size={11} /> Pendiente</span>}
                      {clm.status === 'in_progress' && <span style={{ fontSize: '0.75rem', color: '#818cf8', display: 'flex', alignItems: 'center', gap: '0.25rem' }}><Info size={11} /> En proceso</span>}
                      {clm.status === 'resolved' && <span style={{ fontSize: '0.75rem', color: 'var(--emerald-accent)', display: 'flex', alignItems: 'center', gap: '0.25rem' }}><CheckCircle2 size={11} /> Resuelto</span>}
                      {clm.response && <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>"{clm.response}"</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Encuestas */}
          {surveys.length > 0 && (
            <div className="db-card">
              <div className="db-card-title">
                <div className="db-card-title-icon" style={{ background: 'rgba(236,72,153,0.1)', color: '#ec4899' }}>
                  <Radio size={16} />
                </div>
                Encuestas & Decisiones
              </div>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '-0.5rem' }}>
                Su opinión guía el rumbo de la Sede Rivadavia.
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                {surveys.map(survey => {
                  const hasVoted = survey.votedBy.includes(member.memberId);
                  const totalVotes = survey.options.reduce((s, o) => s + o.votes, 0);
                  let accFrac = 0;
                  const activeHoverOpt = survey.options.find(o => o.id === hoveredSegments[survey.id]);
                  const hoverPct = activeHoverOpt && totalVotes > 0 ? Math.round((activeHoverOpt.votes / totalVotes) * 100) : 0;
                  const colors = ['var(--primary-gold)', 'var(--emerald-accent)', '#818cf8', '#ec4899', '#f59e0b', '#a855f7'];

                  return (
                    <div key={survey.id} style={{ background: 'var(--surface-softer)', border: '1px solid var(--border-glass)', borderRadius: '14px', padding: '1.1rem', display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.4rem' }}>
                        <span style={{ fontSize: '0.68rem', background: 'rgba(255,255,255,0.05)', padding: '0.15rem 0.5rem', borderRadius: '6px', color: 'var(--text-secondary)', fontWeight: '600' }}>{survey.category}</span>
                        <span style={{ fontSize: '0.68rem', color: survey.active ? 'var(--emerald-accent)' : '#ef4444', fontWeight: '600' }}>{survey.active ? '🟢 Abierta' : '🔴 Cerrada'}</span>
                      </div>
                      <p style={{ fontSize: '0.9rem', fontWeight: '600', color: 'var(--text-strong)', lineHeight: 1.4 }}>{survey.question}</p>

                      {!hasVoted && survey.active ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                          {survey.options.map(opt => (
                            <label key={opt.id} style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', padding: '0.6rem 0.75rem', borderRadius: '10px', border: '1px solid', borderColor: selectedOptions[survey.id] === opt.id ? 'var(--primary-gold)' : 'var(--border-glass)', background: selectedOptions[survey.id] === opt.id ? 'rgba(207,161,58,0.05)' : 'var(--surface-softer)', cursor: 'pointer', transition: 'all 0.15s ease', fontSize: '0.82rem', color: 'var(--text-primary)' }}>
                              <input type="radio" name={`survey-${survey.id}`} value={opt.id} checked={selectedOptions[survey.id] === opt.id} onChange={() => setSelectedOptions(prev => ({ ...prev, [survey.id]: opt.id }))} style={{ accentColor: 'var(--primary-gold)', cursor: 'pointer' }} />
                              {opt.text}
                            </label>
                          ))}
                          <button onClick={() => handleCastVote(survey.id)} disabled={!selectedOptions[survey.id]} className="btn btn-primary" style={{ opacity: selectedOptions[survey.id] ? 1 : 0.4, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', padding: '0.5rem', fontSize: '0.82rem' }}>
                            <Sparkles size={12} /> Registrar Mi Voto
                          </button>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', gap: '1.25rem', alignItems: 'center', flexWrap: 'wrap' }}>
                          <div style={{ position: 'relative', width: 100, height: 100, flexShrink: 0 }}>
                            <svg viewBox="0 0 100 100" width="100" height="100">
                              <circle cx="50" cy="50" r="38" stroke="rgba(255,255,255,0.04)" strokeWidth="12" fill="transparent" />
                              {survey.options.map((opt, i) => {
                                const frac = totalVotes > 0 ? opt.votes / totalVotes : 0;
                                if (!frac) return null;
                                const cur = accFrac;
                                accFrac += frac;
                                const isHov = hoveredSegments[survey.id] === opt.id;
                                return <circle key={opt.id} cx="50" cy="50" r="38" stroke={colors[i % colors.length]} strokeWidth={isHov ? 14 : 10} fill="transparent" strokeDasharray={`${frac * 238.76} 238.76`} transform={`rotate(${-90 + cur * 360} 50 50)`} style={{ transition: 'stroke-width 0.2s', cursor: 'pointer' }} onMouseEnter={() => setHoveredSegments(p => ({ ...p, [survey.id]: opt.id }))} onMouseLeave={() => setHoveredSegments(p => ({ ...p, [survey.id]: null }))} />;
                              })}
                            </svg>
                            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
                              <span style={{ fontSize: activeHoverOpt ? '1.15rem' : '1rem', fontWeight: '800', color: 'var(--text-strong)', lineHeight: 1 }}>{activeHoverOpt ? `${hoverPct}%` : totalVotes}</span>
                              <span style={{ fontSize: '0.52rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>{activeHoverOpt ? 'votos' : 'Total'}</span>
                            </div>
                          </div>
                          <div style={{ flex: 1, minWidth: 150, display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                            {survey.options.map((opt, i) => {
                              const pct = totalVotes > 0 ? Math.round((opt.votes / totalVotes) * 100) : 0;
                              const isHov = hoveredSegments[survey.id] === opt.id;
                              return (
                                <div key={opt.id} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.75rem', cursor: 'pointer', padding: '0.15rem 0.3rem', borderRadius: '6px', background: isHov ? 'rgba(255,255,255,0.03)' : 'transparent', transition: 'background 0.15s' }} onMouseEnter={() => setHoveredSegments(p => ({ ...p, [survey.id]: opt.id }))} onMouseLeave={() => setHoveredSegments(p => ({ ...p, [survey.id]: null }))}>
                                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: colors[i % colors.length], flexShrink: 0, display: 'inline-block' }} />
                                  <span style={{ color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{opt.text}</span>
                                  <strong style={{ color: isHov ? 'var(--primary-gold)' : 'var(--text-strong)', flexShrink: 0 }}>{pct}%</strong>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* MODAL CREDENCIAL ADHERENTE */}
      {selectedAdherent && (
        <div className="db-modal-overlay" onClick={() => setSelectedAdherent(null)}>
          <div className="db-modal-content" onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '0.5rem' }}>
              <button onClick={() => setSelectedAdherent(null)} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.85rem' }}>
                Cerrar <X size={16} />
              </button>
            </div>
            <VirtualCard member={{ name: selectedAdherent.name, memberId: `2026${String(Math.abs([...selectedAdherent.id].reduce((h, c) => h * 31 + c.charCodeAt(0), 7))).padEnd(12, '0').slice(0, 12)}`, tier: selectedAdherent.tier, outstandingBalance: selectedAdherent.outstandingBalance, yearsActive: 1, status: selectedAdherent.status }} />
            <div style={{ marginTop: '1rem', background: 'rgba(6,14,10,0.9)', border: '1px solid var(--primary-gold)', padding: '0.85rem 1.25rem', borderRadius: '10px', color: 'var(--text-gold)', fontSize: '0.82rem', textAlign: 'center', maxWidth: '350px' }}>
              <strong style={{ display: 'block', color: '#fff', marginBottom: '0.25rem' }}>Credencial de Adherente Familiar</strong>
              Vinculada a {member.name}. Autorizado para reservas y acceso a sedes deportivas.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
