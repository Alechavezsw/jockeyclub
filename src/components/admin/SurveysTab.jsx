import { useState } from 'react';
import { Radio, Plus, Sparkles, Trash2, Play } from 'lucide-react';

/** Encuestas y consultas colectivas: alta, cierre, estadísticas y simulación. */
export default function SurveysTab({ surveys, setSurveys }) {
  const [newSurveyQuestion, setNewSurveyQuestion] = useState('');
  const [newSurveyCategory, setNewSurveyCategory] = useState('Infraestructura');
  const [newSurveyOpts, setNewSurveyOpts] = useState(['', '', '', '']);
  const [hoveredAdminSegments, setHoveredAdminSegments] = useState({});

  const handleSimulateVotes = (surveyId) => {
    if (!setSurveys) return;
    const updated = surveys.map(s => {
      if (s.id === surveyId) {
        let distributedVotes = 500;
        const newOptions = s.options.map((opt, idx) => {
          let added;
          if (idx === s.options.length - 1) {
            added = distributedVotes;
          } else {
            added = Math.floor(Math.random() * distributedVotes);
            distributedVotes -= added;
          }
          return { ...opt, votes: opt.votes + added };
        });
        return { ...s, options: newOptions };
      }
      return s;
    });
    setSurveys(updated);
  };

  const handleToggleSurveyActive = (surveyId) => {
    if (!setSurveys) return;
    const updated = surveys.map(s => {
      if (s.id === surveyId) {
        return { ...s, active: !s.active };
      }
      return s;
    });
    setSurveys(updated);
  };

  const handleDeleteSurvey = (surveyId) => {
    if (!setSurveys) return;
    if (window.confirm('¿Está seguro de que desea eliminar esta encuesta permanentemente?')) {
      const updated = surveys.filter(s => s.id !== surveyId);
      setSurveys(updated);
    }
  };

  const handleCreateSurvey = (e) => {
    e.preventDefault();
    if (!newSurveyQuestion.trim() || !setSurveys) return;

    const validOpts = newSurveyOpts.filter(o => o.trim() !== '');
    if (validOpts.length < 2) {
      alert('Debe ingresar al menos 2 opciones.');
      return;
    }

    const newSurvey = {
      id: surveys.length > 0 ? Math.max(...surveys.map(s => s.id)) + 1 : 1,
      question: newSurveyQuestion.trim(),
      category: newSurveyCategory,
      active: true,
      votedBy: [],
      options: validOpts.map((optText, idx) => ({
        id: idx + 1,
        text: optText.trim(),
        votes: 0
      }))
    };

    setSurveys([...surveys, newSurvey]);

    setNewSurveyQuestion('');
    setNewSurveyCategory('Infraestructura');
    setNewSurveyOpts(['', '', '', '']);
  };

  const SEGMENT_COLORS = ['var(--primary-gold)', 'var(--emerald-accent)', '#3b82f6', '#ec4899', '#f59e0b', '#a855f7'];

  return (
    <div className="glass-card fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div>
        <h3 className="serif-font" style={{ fontSize: '1.35rem', color: 'var(--text-gold)', margin: 0, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <Radio size={20} style={{ color: 'var(--primary-gold)' }} /> Encuestas & Consultas Colectivas
        </h3>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.15rem' }}>
          Gestione las encuestas populares de la Sede Rivadavia, visualice estadísticas avanzadas con gráficos interactivos y simule participación masiva.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '1.5rem' }}>
        {/* Formulario de Alta de Encuesta */}
        <div className="glass-panel" style={{ padding: '1.25rem' }}>
          <h4 className="serif-font" style={{ fontSize: '1.1rem', color: 'var(--text-strong)', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <Plus size={16} style={{ color: 'var(--primary-gold)' }} /> Crear Nueva Consulta Popular
          </h4>

          <form onSubmit={handleCreateSurvey} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: '600' }}>Pregunta de la Encuesta</label>
              <input
                type="text"
                required
                placeholder="Ej. ¿Qué mejora de infraestructura edilicia prefiere para esta temporada?"
                value={newSurveyQuestion}
                onChange={(e) => setNewSurveyQuestion(e.target.value)}
                className="glass-input"
                style={{ fontSize: '0.85rem' }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: '600' }}>Categoría</label>
              <select
                value={newSurveyCategory}
                onChange={(e) => setNewSurveyCategory(e.target.value)}
                className="glass-input"
                style={{ fontSize: '0.85rem' }}
              >
                <option value="Infraestructura">Infraestructura</option>
                <option value="Deportes">Deportes</option>
                <option value="Social">Social</option>
                <option value="Eventos">Eventos</option>
              </select>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: '600' }}>Opciones de Respuesta (Mínimo 2)</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.50rem' }}>
                {newSurveyOpts.map((opt, idx) => (
                  <input
                    key={idx}
                    type="text"
                    placeholder={`Opción ${idx + 1} ${idx < 2 ? '(Requerida)' : '(Opcional)'}`}
                    required={idx < 2}
                    value={opt}
                    onChange={(e) => {
                      const updated = [...newSurveyOpts];
                      updated[idx] = e.target.value;
                      setNewSurveyOpts(updated);
                    }}
                    className="glass-input"
                    style={{ fontSize: '0.85rem' }}
                  />
                ))}
              </div>
            </div>

            <button type="submit" className="btn btn-primary" style={{ alignSelf: 'flex-start', padding: '0.5rem 1.25rem', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <Sparkles size={14} /> Publicar Encuesta
            </button>
          </form>
        </div>

        {/* Listado y Visualización de Resultados */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <h4 className="serif-font" style={{ fontSize: '1.1rem', color: 'var(--text-strong)', margin: 0 }}>Consultas Activas & Históricas</h4>

          {surveys.length === 0 ? (
            <div className="glass-panel" style={{ padding: '2rem', textAlign: 'center' }}>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: 0 }}>No hay encuestas registradas.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              {surveys.map((survey) => {
                const totalVotes = survey.options.reduce((sum, o) => sum + o.votes, 0);
                const maxVotes = Math.max(...survey.options.map(o => o.votes), 1);
                let accumulatedFraction = 0;

                const activeHoverOptionId = hoveredAdminSegments[survey.id];
                const activeHoverOption = survey.options.find(o => o.id === activeHoverOptionId);
                const hoverPct = activeHoverOption && totalVotes > 0
                  ? Math.round((activeHoverOption.votes / totalVotes) * 100)
                  : 0;

                return (
                  <div key={survey.id} className="glass-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

                    {/* Cabecera de la tarjeta */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.5rem' }}>
                      <div>
                        <span className="badge-tier platinum" style={{ fontSize: '0.75rem', marginRight: '0.5rem' }}>{survey.category}</span>
                        <span style={{ fontSize: '0.75rem', color: survey.active ? 'var(--emerald-accent)' : 'var(--text-muted)' }}>
                          {survey.active ? '🟢 Activa (Recibiendo Votos)' : '🔴 Finalizada'}
                        </span>
                      </div>
                      <div style={{ display: 'flex', gap: '0.4rem' }}>
                        <button
                          onClick={() => handleToggleSurveyActive(survey.id)}
                          className="btn btn-outline"
                          style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem', borderColor: 'var(--border-glass)' }}
                        >
                          {survey.active ? 'Cerrar Consulta' : 'Abrir Consulta'}
                        </button>
                        <button
                          onClick={() => handleDeleteSurvey(survey.id)}
                          className="btn"
                          style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem', background: 'rgba(239, 68, 68, 0.1)', color: 'var(--danger-accent)', display: 'flex', alignItems: 'center', gap: '0.2rem' }}
                        >
                          <Trash2 size={12} /> Eliminar
                        </button>
                      </div>
                    </div>

                    {/* Pregunta */}
                    <h4 className="serif-font" style={{ fontSize: '1.15rem', color: 'var(--text-strong)', margin: 0 }}>{survey.question}</h4>

                    {/* Contenedor Dual de Gráficos */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.5rem', alignItems: 'center' }}>

                      {/* 1. GRÁFICO DONUT (TORTA) SVG */}
                      <div className="glass-panel" style={{ padding: '1rem', background: 'rgba(255,255,255,0.005)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem' }}>
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-gold)', fontWeight: '600' }}>Estructura Porcentual (Donut)</span>

                        <div style={{ position: 'relative', width: '130px', height: '130px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <svg viewBox="0 0 100 100" width="130" height="130">
                            <circle cx="50" cy="50" r="38" stroke="rgba(255,255,255,0.015)" strokeWidth="12" fill="transparent" />
                            {survey.options.map((opt, optIdx) => {
                              const votes = opt.votes;
                              const fraction = totalVotes > 0 ? votes / totalVotes : 0;
                              if (fraction === 0) return null;

                              const currentAccumulated = accumulatedFraction;
                              accumulatedFraction += fraction;

                              const segmentColor = SEGMENT_COLORS[optIdx % SEGMENT_COLORS.length];
                              const isHovered = hoveredAdminSegments[survey.id] === opt.id;

                              return (
                                <circle
                                  key={opt.id}
                                  cx="50"
                                  cy="50"
                                  r="38"
                                  stroke={segmentColor}
                                  strokeWidth={isHovered ? 15 : 11}
                                  fill="transparent"
                                  strokeDasharray={`${fraction * 238.76} 238.76`}
                                  strokeLinecap="round"
                                  transform={`rotate(${-90 + currentAccumulated * 360} 50 50)`}
                                  style={{
                                    transition: 'stroke-width 0.2s ease, stroke-dashoffset 0.5s ease',
                                    cursor: 'pointer'
                                  }}
                                  onMouseEnter={() => setHoveredAdminSegments(prev => ({ ...prev, [survey.id]: opt.id }))}
                                  onMouseLeave={() => setHoveredAdminSegments(prev => ({ ...prev, [survey.id]: null }))}
                                />
                              );
                            })}
                          </svg>

                          {/* Donut Center Label */}
                          <div style={{ position: 'absolute', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', width: '90px' }}>
                            {activeHoverOption ? (
                              <>
                                <span style={{ fontSize: '1.35rem', fontWeight: '800', color: 'var(--text-strong)', lineHeight: 1 }}>{hoverPct}%</span>
                                <span style={{ fontSize: '0.6rem', color: 'var(--text-secondary)', textTransform: 'uppercase', marginTop: '0.1rem' }}>{activeHoverOption.votes} Votos</span>
                              </>
                            ) : (
                              <>
                                <span style={{ fontSize: '1.25rem', fontWeight: '800', color: 'var(--text-strong)', lineHeight: 1 }}>{totalVotes}</span>
                                <span style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Votos Totales</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* 2. GRÁFICO DE BARRAS VERTICALES SVG */}
                      <div className="glass-panel" style={{ padding: '1rem', background: 'rgba(255,255,255,0.005)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem' }}>
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-gold)', fontWeight: '600' }}>Distribución Nominal (Barras)</span>

                        <div style={{ width: '100%', height: '140px', position: 'relative' }}>
                          <svg viewBox="0 0 240 140" width="100%" height="140" style={{ overflow: 'visible' }}>
                            <defs>
                              {survey.options.map((opt, optIdx) => {
                                const segmentColor = SEGMENT_COLORS[optIdx % SEGMENT_COLORS.length];
                                return (
                                  <linearGradient key={opt.id} id={`grad-bar-${survey.id}-${opt.id}`} x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor={segmentColor} stopOpacity="1" />
                                    <stop offset="100%" stopColor={segmentColor} stopOpacity="0.4" />
                                  </linearGradient>
                                );
                              })}
                            </defs>

                            <line x1="30" y1="115" x2="235" y2="115" stroke="var(--border-glass)" strokeWidth="1" />

                            {survey.options.map((opt, optIdx) => {
                              const chartWidth = 190;
                              const chartHeight = 90;
                              const paddingLeft = 35;
                              const paddingTop = 15;

                              const barGap = (chartWidth - (survey.options.length * 24)) / (survey.options.length + 1);
                              const x = paddingLeft + barGap + optIdx * (24 + barGap);
                              const barHeight = totalVotes > 0 ? (opt.votes / maxVotes) * chartHeight : 0;
                              const y = paddingTop + chartHeight - barHeight;

                              const isHovered = hoveredAdminSegments[survey.id] === opt.id;

                              return (
                                <g key={opt.id}>
                                  <rect
                                    x={x}
                                    y={y}
                                    width="20"
                                    height={Math.max(barHeight, 2)}
                                    rx="4"
                                    fill={`url(#grad-bar-${survey.id}-${opt.id})`}
                                    stroke={isHovered ? 'var(--text-strong)' : 'transparent'}
                                    strokeWidth="1"
                                    style={{ transition: 'all 0.5s ease', cursor: 'pointer' }}
                                    onMouseEnter={() => setHoveredAdminSegments(prev => ({ ...prev, [survey.id]: opt.id }))}
                                    onMouseLeave={() => setHoveredAdminSegments(prev => ({ ...prev, [survey.id]: null }))}
                                  />
                                  <text
                                    x={x + 10}
                                    y={y - 4}
                                    textAnchor="middle"
                                    fill={isHovered ? 'var(--primary-gold)' : 'var(--text-strong)'}
                                    fontSize="8"
                                    fontWeight="700"
                                    style={{ transition: 'all 0.5s ease', pointerEvents: 'none' }}
                                  >
                                    {opt.votes}
                                  </text>
                                  <text
                                    x={x + 10}
                                    y="126"
                                    textAnchor="middle"
                                    fill="var(--text-secondary)"
                                    fontSize="7.5"
                                    fontWeight="500"
                                    style={{ pointerEvents: 'none' }}
                                  >
                                    {opt.text.length > 10 ? opt.text.substring(0, 8) + '..' : opt.text}
                                  </text>
                                </g>
                              );
                            })}
                          </svg>
                        </div>
                      </div>

                    </div>

                    {/* Leyenda interactiva & Botones de simulación */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '0.25rem' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.5rem' }}>
                        {survey.options.map((opt, optIdx) => {
                          const fraction = totalVotes > 0 ? opt.votes / totalVotes : 0;
                          const pct = Math.round(fraction * 100);
                          const segmentColor = SEGMENT_COLORS[optIdx % SEGMENT_COLORS.length];
                          const isHovered = hoveredAdminSegments[survey.id] === opt.id;

                          return (
                            <div
                              key={opt.id}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                fontSize: '0.8rem',
                                padding: '0.3rem 0.5rem',
                                borderRadius: '6px',
                                background: isHovered ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.005)',
                                border: '1px solid',
                                borderColor: isHovered ? segmentColor : 'transparent',
                                transition: 'all 0.2s ease',
                                cursor: 'pointer'
                              }}
                              onMouseEnter={() => setHoveredAdminSegments(prev => ({ ...prev, [survey.id]: opt.id }))}
                              onMouseLeave={() => setHoveredAdminSegments(prev => ({ ...prev, [survey.id]: null }))}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', width: '70%' }}>
                                <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: segmentColor, flexShrink: 0 }}></span>
                                <span style={{ color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{opt.text}</span>
                              </div>
                              <span style={{ fontWeight: '700', color: segmentColor }}>{pct}% <span style={{ color: 'var(--text-muted)', fontWeight: '400', fontSize: '0.7rem' }}>({opt.votes} v)</span></span>
                            </div>
                          );
                        })}
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border-glass)', paddingTop: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                          Participación total registrada: <strong>{totalVotes} votos</strong>
                        </span>
                        <button
                          type="button"
                          onClick={() => handleSimulateVotes(survey.id)}
                          disabled={!survey.active}
                          className="btn btn-outline"
                          style={{
                            padding: '0.4rem 0.8rem',
                            fontSize: '0.8rem',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.3rem',
                            color: 'var(--primary-gold)',
                            borderColor: 'var(--primary-gold)',
                            opacity: survey.active ? 1 : 0.4,
                            cursor: survey.active ? 'pointer' : 'not-allowed'
                          }}
                        >
                          <Play size={12} fill="var(--primary-gold)" /> Simular Votación Masiva (+500 votos)
                        </button>
                      </div>
                    </div>

                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
