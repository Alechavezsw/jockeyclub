import { useEffect, useState } from 'react';
import { Calendar, Tag, Check, Award, Plus, X, Globe, Eye, Bookmark } from 'lucide-react';

export default function NewsBoardView({ newsList, addNewsArticle, userRole, toggleEventRSVP, rsvpList }) {
  const [activeCategory, setActiveCategory] = useState('todos');
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [savedIds, setSavedIds] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('jockey-saved-news') || '[]');
    } catch {
      return [];
    }
  });
  const [showSavedOnly, setShowSavedOnly] = useState(false);

  useEffect(() => {
    localStorage.setItem('jockey-saved-news', JSON.stringify(savedIds));
  }, [savedIds]);

  const toggleSave = (id) => {
    setSavedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };
  
  // Estado para el formulario de publicación de anuncios (Admin)
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('deportes');
  const [excerpt, setExcerpt] = useState('');
  const [content, setContent] = useState('');
  const [image, setImage] = useState('');

  const categories = [
    { id: 'todos', label: 'Todos' },
    { id: 'deportes', label: 'Deportes' },
    { id: 'eventos', label: 'Eventos Sociales' },
    { id: 'gourmet', label: 'Gourmet' },
    { id: 'institucional', label: 'Institucional' }
  ];

  // Filtrar noticias por categoría / guardados
  const filteredNews = (activeCategory === 'todos'
    ? newsList
    : newsList.filter((item) => item.category.toLowerCase() === activeCategory.toLowerCase())
  ).filter((item) => !showSavedOnly || savedIds.includes(item.id));

  const handlePublish = (e) => {
    e.preventDefault();
    if (!title || !excerpt || !content) return;

    const defaultImages = {
      deportes: 'https://images.unsplash.com/photo-1544698310-74ea9d1c8258?q=80&w=600&auto=format&fit=crop',
      eventos: 'https://images.unsplash.com/photo-1511795409834-ef04bbd61622?q=80&w=600&auto=format&fit=crop',
      gourmet: 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?q=80&w=600&auto=format&fit=crop',
      institucional: 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?q=80&w=600&auto=format&fit=crop'
    };

    const newArticle = {
      title,
      category,
      excerpt,
      content,
      image: image || defaultImages[category] || defaultImages.institucional,
      date: new Date().toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' }),
      isEvent: category === 'eventos' || category === 'deportes', // marcar como evento para permitir RSVP
      id: Date.now()
    };

    addNewsArticle(newArticle);
    
    // Resetear formulario y cerrar modal
    setTitle('');
    setExcerpt('');
    setContent('');
    setImage('');
    setShowPublishModal(false);
  };

  const isMemberRsvpd = (eventId) => {
    return rsvpList.includes(eventId);
  };

  return (
    <div className="fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Revista Digital</h1>
          <p className="page-subtitle">Cronología de eventos, torneos deportivos y anuncios institucionales del club</p>
        </div>

        {userRole === 'admin' && (
          <button 
            onClick={() => setShowPublishModal(true)}
            className="btn btn-primary"
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
          >
            <Plus size={18} /> Publicar Anuncio
          </button>
        )}
      </div>

      {/* Filtro de Categorías */}
      <div className="admin-filters" style={{ margin: '1.5rem 0' }}>
        <div className="filter-group">
          {categories.map(cat => (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              className={`filter-btn ${activeCategory === cat.id ? 'active' : ''}`}
              style={{ padding: '0.5rem 1.25rem', borderRadius: '30px' }}
            >
              {cat.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setShowSavedOnly((v) => !v)}
            className={`filter-btn ${showSavedOnly ? 'active' : ''}`}
            style={{ padding: '0.5rem 1.25rem', borderRadius: '30px', display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <Bookmark size={14} /> Guardados ({savedIds.length})
          </button>
        </div>
      </div>

      {/* Revista Digital Grid */}
      <div className="news-magazine" style={{ marginTop: '1.5rem' }}>
        {filteredNews.length === 0 ? (
          <div style={{ gridColumn: 'span 2', textAlign: 'center', padding: '4rem 1.5rem' }} className="glass-card">
            <Globe size={48} style={{ color: 'var(--text-muted)', strokeWidth: 1, marginBottom: '1rem' }} />
            <h3 className="serif-font" style={{ fontSize: '1.25rem', marginBottom: '0.25rem' }}>No hay anuncios en esta sección</h3>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Vuelve a consultar más tarde o selecciona otra categoría.</p>
          </div>
        ) : (
          filteredNews.map((article, index) => {
            // El primer artículo en la vista "Todos" será el destacado (featured)
            const isFeatured = index === 0 && activeCategory === 'todos';
            
            return (
              <div 
                key={article.id} 
                className={`news-card ${isFeatured ? 'news-card-featured' : ''}`}
                style={{
                  gridColumn: isFeatured ? 'span 2' : 'auto'
                }}
              >
                {/* Imagen del Artículo */}
                <div 
                  className="news-img" 
                  style={{ 
                    backgroundImage: `url(${article.image})`,
                    minHeight: isFeatured ? '320px' : '220px'
                  }}
                >
                  <span className="news-category">{article.category}</span>
                </div>

                {/* Contenido del Artículo */}
                <div className="news-info">
                  <div>
                    <span className="news-date" style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                      <Calendar size={12} /> {article.date}
                    </span>
                    <h3 className="serif-font news-headline" style={{ 
                      fontSize: isFeatured ? '1.85rem' : '1.35rem',
                      marginTop: '0.5rem'
                    }}>
                      {article.title}
                    </h3>
                    <p className="news-excerpt" style={{ 
                      fontSize: '0.9rem', 
                      lineHeight: '1.5',
                      color: 'var(--text-secondary)',
                      marginBottom: '1.5rem',
                      WebkitLineClamp: isFeatured ? 4 : 3
                    }}>
                      {article.excerpt}
                    </p>
                    {isFeatured && (
                      <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '1.5rem', display: 'none', md: 'block' }} className="desktop-content">
                        <style>{`
                          @media (min-width: 768px) {
                            .desktop-content { display: block !important; }
                          }
                        `}</style>
                        {article.content}
                      </p>
                    )}
                  </div>

                  {/* Pie del Artículo (RSVP e interacción) */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border-glass)', paddingTop: '1rem', marginTop: 'auto', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      <Tag size={12} style={{ color: 'var(--primary-gold)' }} /> Por Comisión Directiva
                    </span>

                    <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      title={savedIds.includes(article.id) ? 'Quitar de guardados' : 'Guardar'}
                      onClick={() => toggleSave(article.id)}
                      style={{
                        padding: '0.35rem 0.65rem',
                        borderColor: savedIds.includes(article.id) ? 'var(--primary-gold)' : undefined,
                        color: savedIds.includes(article.id) ? 'var(--text-gold)' : undefined,
                      }}
                    >
                      <Bookmark size={12} />
                    </button>
                    {article.isEvent && userRole === 'member' ? (
                      isMemberRsvpd(article.id) ? (
                        <button
                          onClick={() => toggleEventRSVP(article.id)}
                          className="btn btn-sm"
                          style={{
                            background: 'rgba(16, 185, 129, 0.1)',
                            border: '1px solid var(--emerald-accent)',
                            color: 'var(--emerald-accent)',
                            borderRadius: '20px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.25rem',
                            padding: '0.4rem 1rem'
                          }}
                        >
                          <Check size={14} /> ¡Asistirás!
                        </button>
                      ) : (
                        <button
                          onClick={() => toggleEventRSVP(article.id)}
                          className="btn btn-secondary btn-sm"
                          style={{
                            border: '1px solid var(--border-glass-hover)',
                            borderRadius: '20px',
                            padding: '0.4rem 1rem'
                          }}
                        >
                          Confirmar Asistencia
                        </button>
                      )
                    ) : (
                      <button 
                        className="btn btn-secondary btn-sm"
                        style={{ padding: '0.4rem 0.8rem', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
                        onClick={() => alert(`Lectura Completa:\n\n${article.title}\n\n${article.content}`)}
                      >
                        <Eye size={12} /> Leer Más
                      </button>
                    )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Modal de Publicar Anuncio (Admin) */}
      {showPublishModal && (
        <div className="modal-overlay">
          <div className="modal-content glass-panel" style={{ width: '90%', maxWidth: '580px', background: 'var(--bg-secondary)' }}>
            <div className="modal-header">
              <div>
                <h3 className="serif-font" style={{ fontSize: '1.4rem', color: 'var(--text-primary)' }}>Redactar Nuevo Anuncio</h3>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-gold)', marginTop: '0.1rem' }}>Panel de Comunicaciones del Jockey Club</p>
              </div>
              <button 
                onClick={() => setShowPublishModal(false)} 
                style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: '0.25rem' }}
              >
                <X size={20} />
              </button>
            </div>

            <div className="modal-body">
              <form onSubmit={handlePublish} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                <div className="form-group">
                  <label className="form-label">Título del Anuncio</label>
                  <input 
                    type="text" 
                    placeholder="Ej: Gran Torneo Abierto de Polo de Otoño" 
                    className="form-input"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    required
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div className="form-group">
                    <label className="form-label">Categoría</label>
                    <select 
                      className="form-input" 
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                      style={{ padding: '0.7rem' }}
                    >
                      <option value="deportes" style={{ background: 'var(--bg-secondary)' }}>Deportes</option>
                      <option value="eventos" style={{ background: 'var(--bg-secondary)' }}>Eventos Sociales</option>
                      <option value="gourmet" style={{ background: 'var(--bg-secondary)' }}>Gourmet</option>
                      <option value="institucional" style={{ background: 'var(--bg-secondary)' }}>Institucional</option>
                    </select>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Imagen URL (Opcional)</label>
                    <input 
                      type="text" 
                      placeholder="https://ejemplo.com/foto.jpg" 
                      className="form-input"
                      value={image}
                      onChange={(e) => setImage(e.target.value)}
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Resumen Breve (Para tarjetas)</label>
                  <input 
                    type="text" 
                    placeholder="Escriba un resumen de 2 líneas para el feed principal..." 
                    className="form-input"
                    value={excerpt}
                    onChange={(e) => setExcerpt(e.target.value)}
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Contenido Detallado</label>
                  <textarea 
                    placeholder="Redacte el cuerpo de la noticia o detalles del evento completo aquí..." 
                    className="form-input"
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    rows={4}
                    style={{ resize: 'vertical', minHeight: '80px' }}
                    required
                  />
                </div>

                <hr style={{ border: 'none', borderTop: '1px solid var(--border-glass)', margin: '0.5rem 0' }} />

                <div style={{ display: 'flex', justifySelf: 'flex-end', justifyContent: 'flex-end', gap: '1rem' }}>
                  <button 
                    type="button" 
                    onClick={() => setShowPublishModal(false)} 
                    className="btn btn-secondary"
                    style={{ padding: '0.6rem 1.25rem' }}
                  >
                    Descartar
                  </button>
                  <button 
                    type="submit" 
                    className="btn btn-primary"
                    style={{ padding: '0.6rem 1.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                  >
                    <Award size={16} /> Publicar Anuncio
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
