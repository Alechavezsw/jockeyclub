import { useEffect, useMemo, useState } from 'react';
import { Calendar, Tag, Check, Eye, Bookmark, Globe } from 'lucide-react';
import ModalDialog from '../components/ModalDialog';
import { isNewsPublished, newsCategoryLabel, isNewsFeatured, sortNewsForCms } from '../domain/news/news';

function renderNewsBody(text) {
  const parts = String(text || '').split(/(\n\n\[imagen\]\([^)]+\)\n\n)/g);
  return parts.map((part, i) => {
    const match = part.match(/^\n\n\[imagen\]\(([^)]+)\)\n\n$/);
    if (match) {
      return (
        <figure key={`img-${i}`} style={{ margin: '1rem 0' }}>
          <img src={match[1]} alt="" style={{ width: '100%', borderRadius: 12, display: 'block' }} />
        </figure>
      );
    }
    if (!part.trim()) return null;
    return (
      <p key={`p-${i}`} style={{ whiteSpace: 'pre-wrap', margin: '0 0 0.85rem', lineHeight: 1.6, color: 'var(--text-secondary)' }}>
        {part}
      </p>
    );
  });
}

export default function NewsBoardView({ newsList, userRole, toggleEventRSVP, rsvpList }) {
  const [activeCategory, setActiveCategory] = useState('todos');
  const [reading, setReading] = useState(null);
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

  const categories = [
    { id: 'todos', label: 'Todos' },
    { id: 'deportes', label: 'Deportes' },
    { id: 'eventos', label: 'Eventos Sociales' },
    { id: 'gourmet', label: 'Gourmet' },
    { id: 'institucional', label: 'Institucional' },
    { id: 'cultura', label: 'Cultura' },
    { id: 'socios', label: 'Vida social' },
  ];

  const publishedNews = useMemo(
    () => sortNewsForCms((newsList || []).filter(isNewsPublished), 'updated'),
    [newsList],
  );

  const filteredNews = (activeCategory === 'todos'
    ? publishedNews
    : publishedNews.filter((item) => String(item.category).toLowerCase() === activeCategory.toLowerCase())
  ).filter((item) => !showSavedOnly || savedIds.includes(item.id));

  const isMemberRsvpd = (eventId) => rsvpList.includes(eventId);

  return (
    <div className="fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Revista Digital</h1>
          <p className="page-subtitle">Cronología de eventos, torneos deportivos y anuncios institucionales del club</p>
        </div>
      </div>

      <div className="admin-filters" style={{ margin: '1.5rem 0' }}>
        <div className="filter-group">
          {categories.map((cat) => (
            <button
              key={cat.id}
              type="button"
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

      <div className="news-magazine" style={{ marginTop: '1.5rem' }}>
        {filteredNews.length === 0 ? (
          <div style={{ gridColumn: 'span 2', textAlign: 'center', padding: '4rem 1.5rem' }} className="glass-card">
            <Globe size={48} style={{ color: 'var(--text-muted)', strokeWidth: 1, marginBottom: '1rem' }} />
            <h3 className="serif-font" style={{ fontSize: '1.25rem', marginBottom: '0.25rem' }}>No hay anuncios en esta sección</h3>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Volvé a consultar más tarde o seleccioná otra categoría.</p>
          </div>
        ) : (
          filteredNews.map((article, index) => {
            const isFeatured = (isNewsFeatured(article) && activeCategory === 'todos')
              || (index === 0 && activeCategory === 'todos' && !filteredNews.some(isNewsFeatured));
            return (
              <div
                key={article.id}
                className={`news-card ${isFeatured ? 'news-card-featured' : ''}`}
                style={{ gridColumn: isFeatured ? 'span 2' : 'auto' }}
              >
                <div
                  className="news-img"
                  style={{
                    backgroundImage: `url(${article.image})`,
                    minHeight: isFeatured ? '320px' : '220px',
                  }}
                >
                  <span className="news-category">{newsCategoryLabel(article.category) || article.category}</span>
                </div>

                <div className="news-info">
                  <div>
                    <span className="news-date" style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                      <Calendar size={12} /> {article.date}
                    </span>
                    <h3
                      className="serif-font news-headline"
                      style={{ fontSize: isFeatured ? '1.85rem' : '1.35rem', marginTop: '0.5rem' }}
                    >
                      {article.title}
                    </h3>
                    <p
                      className="news-excerpt"
                      style={{
                        fontSize: '0.9rem',
                        lineHeight: '1.5',
                        color: 'var(--text-secondary)',
                        marginBottom: '1.5rem',
                        WebkitLineClamp: isFeatured ? 4 : 3,
                      }}
                    >
                      {article.excerpt}
                    </p>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border-glass)', paddingTop: '1rem', marginTop: 'auto', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      <Tag size={12} style={{ color: 'var(--primary-gold)' }} /> Jockey Club San Juan
                    </span>

                    <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        title={savedIds.includes(article.id) ? 'Quitar de guardados' : 'Guardar'}
                        aria-label={savedIds.includes(article.id) ? 'Quitar de guardados' : 'Guardar noticia'}
                        onClick={() => toggleSave(article.id)}
                        style={{
                          padding: '0.35rem 0.65rem',
                          borderColor: savedIds.includes(article.id) ? 'var(--primary-gold)' : undefined,
                          color: savedIds.includes(article.id) ? 'var(--text-gold)' : undefined,
                        }}
                      >
                        <Bookmark size={12} aria-hidden="true" />
                      </button>
                      {article.isEvent && userRole === 'member' ? (
                        isMemberRsvpd(article.id) ? (
                          <button
                            type="button"
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
                              padding: '0.4rem 1rem',
                            }}
                          >
                            <Check size={14} /> ¡Asistirás!
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => toggleEventRSVP(article.id)}
                            className="btn btn-secondary btn-sm"
                            style={{ border: '1px solid var(--border-glass-hover)', borderRadius: '20px', padding: '0.4rem 1rem' }}
                          >
                            Confirmar asistencia
                          </button>
                        )
                      ) : (
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          style={{ padding: '0.4rem 0.8rem', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
                          onClick={() => setReading(article)}
                        >
                          <Eye size={12} /> Leer más
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

      {reading && (
        <ModalDialog
          onClose={() => setReading(null)}
          labelledBy="news-read-title"
          contentClassName="modal-content glass-panel"
          contentStyle={{ width: '92%', maxWidth: 720, background: 'var(--bg-secondary)', maxHeight: '90vh', overflowY: 'auto' }}
        >
          <div className="modal-header">
            <div>
              <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-gold)' }}>
                {newsCategoryLabel(reading.category)} · {reading.date}
              </p>
              <h3 id="news-read-title" className="serif-font" style={{ fontSize: '1.45rem', margin: '0.25rem 0 0' }}>
                {reading.title}
              </h3>
            </div>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setReading(null)} aria-label="Cerrar">
              Cerrar
            </button>
          </div>
          <div className="modal-body">
            {reading.image && (
              <img src={reading.image} alt="" style={{ width: '100%', borderRadius: 12, marginBottom: '1rem' }} />
            )}
            <p style={{ color: 'var(--text-secondary)', marginTop: 0 }}>{reading.excerpt}</p>
            <div>{renderNewsBody(reading.content)}</div>
            {Array.isArray(reading.gallery) && reading.gallery.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '0.65rem', marginTop: '1rem' }}>
                {reading.gallery.map((url) => (
                  <img key={url} src={url} alt="" style={{ width: '100%', borderRadius: 10, aspectRatio: '4/3', objectFit: 'cover' }} />
                ))}
              </div>
            )}
          </div>
        </ModalDialog>
      )}
    </div>
  );
}
