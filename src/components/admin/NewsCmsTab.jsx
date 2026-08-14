import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Newspaper, Plus, Pencil, Trash2, ImagePlus, Eye, EyeOff,
  Save, X, Calendar, Tag, Images, Upload,
} from 'lucide-react';
import { isSupabaseConfigured } from '../../lib/supabase';
import { uploadNewsImage } from '../../data/storage';
import {
  NEWS_CATEGORIES,
  DEFAULT_NEWS_IMAGES,
  emptyNewsDraft,
  normalizeNewsArticle,
  newsCategoryLabel,
  formatNewsDateLabel,
  readNewsImageAsDataUrl,
} from '../../domain/news/news';

async function resolveImageUrl(file, articleId) {
  if (isSupabaseConfigured) {
    try {
      const uploaded = await uploadNewsImage(file, { articleId: articleId || 'draft' });
      if (uploaded?.url) return uploaded.url;
    } catch {
      /* fallback local */
    }
  }
  return readNewsImageAsDataUrl(file);
}

/** CMS de la Revista Digital: alta, edición, portada, galería y publicación. */
export default function NewsCmsTab({ newsList = [], setNewsList }) {
  const [filter, setFilter] = useState('todos');
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState(emptyNewsDraft);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState(false);
  const coverInputRef = useRef(null);
  const galleryInputRef = useRef(null);
  const bodyRef = useRef(null);

  const isEditing = editingId !== null || Boolean(draft.title || draft.content || draft.excerpt);

  const filtered = useMemo(() => {
    const list = [...(newsList || [])];
    if (filter === 'borrador') return list.filter((n) => n.isPublished === false);
    if (filter === 'publicado') return list.filter((n) => n.isPublished !== false);
    if (filter !== 'todos') return list.filter((n) => String(n.category).toLowerCase() === filter);
    return list;
  }, [newsList, filter]);

  useEffect(() => {
    if (!editingId) return;
    const found = newsList.find((n) => String(n.id) === String(editingId));
    if (found) setDraft(normalizeNewsArticle(found));
  }, [editingId, newsList]);

  const startCreate = () => {
    setEditingId('new');
    setDraft(emptyNewsDraft());
    setError('');
    setPreview(false);
  };

  const startEdit = (article) => {
    setEditingId(article.id);
    setDraft(normalizeNewsArticle(article));
    setError('');
    setPreview(false);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraft(emptyNewsDraft());
    setError('');
    setPreview(false);
  };

  const patch = (partial) => setDraft((prev) => ({ ...prev, ...partial }));

  const handleCoverFile = async (file) => {
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      const url = await resolveImageUrl(file, draft.id);
      patch({ image: url });
    } catch (err) {
      setError(err.message || 'No se pudo cargar la portada.');
    } finally {
      setUploading(false);
    }
  };

  const handleGalleryFiles = async (files) => {
    const list = [...(files || [])];
    if (!list.length) return;
    setUploading(true);
    setError('');
    try {
      const urls = [];
      for (const file of list.slice(0, 8)) {
        urls.push(await resolveImageUrl(file, draft.id));
      }
      patch({ gallery: [...(draft.gallery || []), ...urls] });
    } catch (err) {
      setError(err.message || 'No se pudieron cargar las fotos.');
    } finally {
      setUploading(false);
    }
  };

  const insertImageInBody = async (file) => {
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      const url = await resolveImageUrl(file, draft.id);
      const token = `\n\n[imagen](${url})\n\n`;
      const el = bodyRef.current;
      if (el && typeof el.selectionStart === 'number') {
        const start = el.selectionStart;
        const end = el.selectionEnd;
        const next = `${draft.content.slice(0, start)}${token}${draft.content.slice(end)}`;
        patch({ content: next, gallery: [...(draft.gallery || []), url] });
        requestAnimationFrame(() => {
          el.focus();
          const pos = start + token.length;
          el.setSelectionRange(pos, pos);
        });
      } else {
        patch({
          content: `${draft.content || ''}${token}`,
          gallery: [...(draft.gallery || []), url],
        });
      }
    } catch (err) {
      setError(err.message || 'No se pudo insertar la imagen.');
    } finally {
      setUploading(false);
    }
  };

  const removeGalleryImage = (url) => {
    patch({ gallery: (draft.gallery || []).filter((u) => u !== url) });
  };

  const handleSave = async (e) => {
    e?.preventDefault?.();
    if (!setNewsList) return;
    if (!draft.title.trim() || !draft.excerpt.trim() || !draft.content.trim()) {
      setError('Completá título, bajada y cuerpo de la noticia.');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const article = normalizeNewsArticle({
        ...draft,
        id: editingId && editingId !== 'new' ? editingId : `tmp-news-${Date.now()}`,
        date: draft.date || formatNewsDateLabel(),
        image: draft.image || DEFAULT_NEWS_IMAGES[draft.category] || DEFAULT_NEWS_IMAGES.institucional,
      });

      setNewsList((prev) => {
        const exists = prev.some((n) => String(n.id) === String(article.id));
        if (exists) {
          return prev.map((n) => (String(n.id) === String(article.id) ? { ...n, ...article } : n));
        }
        return [article, ...prev];
      });
      cancelEdit();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (article) => {
    if (!setNewsList) return;
    if (!window.confirm(`¿Eliminar “${article.title}”? Esta acción no se puede deshacer.`)) return;
    setNewsList((prev) => prev.filter((n) => String(n.id) !== String(article.id)));
    if (String(editingId) === String(article.id)) cancelEdit();
  };

  const renderBodyPreview = (text) => {
    const parts = String(text || '').split(/(\n\n\[imagen\]\([^)]+\)\n\n)/g);
    return parts.map((part, i) => {
      const match = part.match(/^\n\n\[imagen\]\(([^)]+)\)\n\n$/);
      if (match) {
        return (
          <figure key={`img-${i}`} className="news-cms-inline-figure">
            <img src={match[1]} alt="" />
          </figure>
        );
      }
      return (
        <p key={`p-${i}`} className="news-cms-preview-p">
          {part}
        </p>
      );
    });
  };

  return (
    <div className="news-cms fade-in">
      <div className="news-cms-head">
        <div>
          <h2 className="news-cms-title">
            <Newspaper size={20} aria-hidden="true" /> Revista digital
          </h2>
          <p className="news-cms-sub">
            CMS de noticias que ven los socios en la revista. Portada, galería, borradores y publicación.
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={startCreate}>
          <Plus size={16} aria-hidden="true" /> Nueva noticia
        </button>
      </div>

      <div className="news-cms-filters" role="tablist" aria-label="Filtro de noticias">
        {[
          { id: 'todos', label: 'Todas' },
          { id: 'publicado', label: 'Publicadas' },
          { id: 'borrador', label: 'Borradores' },
          ...NEWS_CATEGORIES,
        ].map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={filter === item.id}
            className={`filter-btn${filter === item.id ? ' active' : ''}`}
            onClick={() => setFilter(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className={`news-cms-layout${editingId ? ' is-editing' : ''}`}>
        <div className="news-cms-list glass-card">
          {filtered.length === 0 ? (
            <p className="news-cms-empty">No hay noticias en este filtro.</p>
          ) : (
            filtered.map((article) => (
              <article
                key={article.id}
                className={`news-cms-row${String(editingId) === String(article.id) ? ' is-active' : ''}`}
              >
                <div
                  className="news-cms-thumb"
                  style={{ backgroundImage: `url(${article.image || DEFAULT_NEWS_IMAGES.institucional})` }}
                  aria-hidden="true"
                />
                <div className="news-cms-row-copy">
                  <div className="news-cms-row-top">
                    <strong>{article.title}</strong>
                    <span className={`news-cms-badge${article.isPublished === false ? ' is-draft' : ''}`}>
                      {article.isPublished === false ? 'Borrador' : 'Publicada'}
                    </span>
                  </div>
                  <p>{article.excerpt}</p>
                  <small>
                    <Tag size={12} aria-hidden="true" /> {newsCategoryLabel(article.category)}
                    <Calendar size={12} aria-hidden="true" /> {article.date}
                    {(article.gallery || []).length > 0 && (
                      <>
                        <Images size={12} aria-hidden="true" /> {article.gallery.length} fotos
                      </>
                    )}
                  </small>
                </div>
                <div className="news-cms-row-actions">
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => startEdit(article)} aria-label={`Editar ${article.title}`}>
                    <Pencil size={14} aria-hidden="true" /> Editar
                  </button>
                  <button type="button" className="btn btn-danger btn-sm" onClick={() => handleDelete(article)} aria-label={`Eliminar ${article.title}`}>
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                </div>
              </article>
            ))
          )}
        </div>

        {editingId && (
          <form className="news-cms-editor glass-card" onSubmit={handleSave}>
            <div className="news-cms-editor-head">
              <h3>{editingId === 'new' ? 'Nueva noticia' : 'Editar noticia'}</h3>
              <div className="news-cms-editor-tools">
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPreview((v) => !v)}>
                  {preview ? <Pencil size={14} /> : <Eye size={14} />} {preview ? 'Editar' : 'Vista previa'}
                </button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={cancelEdit} aria-label="Cerrar editor">
                  <X size={14} aria-hidden="true" />
                </button>
              </div>
            </div>

            {error && (
              <p className="news-cms-error" role="alert">{error}</p>
            )}

            {preview ? (
              <div className="news-cms-preview">
                <div
                  className="news-cms-preview-hero"
                  style={{ backgroundImage: `url(${draft.image || DEFAULT_NEWS_IMAGES[draft.category]})` }}
                />
                <p className="news-cms-preview-meta">
                  {newsCategoryLabel(draft.category)} · {draft.date}
                  {draft.isPublished === false ? ' · Borrador' : ''}
                </p>
                <h2>{draft.title || 'Sin título'}</h2>
                <p className="news-cms-preview-excerpt">{draft.excerpt}</p>
                <div className="news-cms-preview-body">{renderBodyPreview(draft.content)}</div>
                {(draft.gallery || []).length > 0 && (
                  <div className="news-cms-gallery-grid">
                    {draft.gallery.map((url) => (
                      <img key={url} src={url} alt="" />
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <>
                <div className="news-cms-cover" onClick={() => coverInputRef.current?.click()}>
                  {draft.image ? (
                    <img src={draft.image} alt="Portada" />
                  ) : (
                    <div className="news-cms-cover-empty">
                      <ImagePlus size={28} aria-hidden="true" />
                      <span>Portada · clic o soltá una foto</span>
                    </div>
                  )}
                  <input
                    ref={coverInputRef}
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = '';
                      void handleCoverFile(file);
                    }}
                  />
                  <button
                    type="button"
                    className="news-cms-cover-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      coverInputRef.current?.click();
                    }}
                  >
                    <Upload size={14} aria-hidden="true" /> {uploading ? 'Subiendo…' : 'Cambiar portada'}
                  </button>
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="news-title">Título</label>
                  <input
                    id="news-title"
                    className="form-input"
                    value={draft.title}
                    onChange={(e) => patch({ title: e.target.value })}
                    placeholder="Ej: Torneo interno de pádel…"
                    required
                  />
                </div>

                <div className="news-cms-grid-2">
                  <div className="form-group">
                    <label className="form-label" htmlFor="news-cat">Categoría</label>
                    <select
                      id="news-cat"
                      className="form-input"
                      value={draft.category}
                      onChange={(e) => {
                        const category = e.target.value;
                        patch({
                          category,
                          isEvent: category === 'eventos' || category === 'deportes',
                        });
                      }}
                    >
                      {NEWS_CATEGORIES.map((c) => (
                        <option key={c.id} value={c.id}>{c.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="news-date">Fecha visible</label>
                    <input
                      id="news-date"
                      className="form-input"
                      value={draft.date}
                      onChange={(e) => patch({ date: e.target.value })}
                    />
                  </div>
                </div>

                <div className="news-cms-toggles">
                  <label className="news-cms-check">
                    <input
                      type="checkbox"
                      checked={draft.isPublished !== false}
                      onChange={(e) => patch({ isPublished: e.target.checked })}
                    />
                    {draft.isPublished !== false ? <Eye size={14} /> : <EyeOff size={14} />}
                    Publicada (visible para socios)
                  </label>
                  <label className="news-cms-check">
                    <input
                      type="checkbox"
                      checked={Boolean(draft.isEvent)}
                      onChange={(e) => patch({ isEvent: e.target.checked })}
                    />
                    <Calendar size={14} />
                    Evento (permite RSVP)
                  </label>
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="news-excerpt">Bajada / resumen</label>
                  <textarea
                    id="news-excerpt"
                    className="form-input"
                    rows={2}
                    value={draft.excerpt}
                    onChange={(e) => patch({ excerpt: e.target.value })}
                    placeholder="Texto corto para la tarjeta de la revista…"
                    required
                  />
                </div>

                <div className="form-group">
                  <div className="news-cms-body-label">
                    <label className="form-label" htmlFor="news-body">Cuerpo</label>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={uploading}
                      onClick={() => galleryInputRef.current?.click()}
                    >
                      <ImagePlus size={14} aria-hidden="true" /> Insertar foto en el texto
                    </button>
                    <input
                      ref={galleryInputRef}
                      type="file"
                      accept="image/*"
                      hidden
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = '';
                        void insertImageInBody(file);
                      }}
                    />
                  </div>
                  <textarea
                    id="news-body"
                    ref={bodyRef}
                    className="form-input news-cms-body"
                    rows={12}
                    value={draft.content}
                    onChange={(e) => patch({ content: e.target.value })}
                    placeholder="Escribí la noticia. Podés insertar fotos en el texto."
                    required
                  />
                </div>

                <div className="news-cms-gallery-block">
                  <div className="news-cms-body-label">
                    <span className="form-label" style={{ margin: 0 }}>Galería adicional</span>
                    <label className="btn btn-secondary btn-sm" style={{ cursor: 'pointer' }}>
                      <Images size={14} aria-hidden="true" /> Agregar fotos
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        hidden
                        onChange={(e) => {
                          const files = e.target.files;
                          e.target.value = '';
                          void handleGalleryFiles(files);
                        }}
                      />
                    </label>
                  </div>
                  {(draft.gallery || []).length === 0 ? (
                    <p className="news-cms-empty">Sin fotos extra todavía.</p>
                  ) : (
                    <div className="news-cms-gallery-grid is-editable">
                      {draft.gallery.map((url) => (
                        <div key={url} className="news-cms-gallery-item">
                          <img src={url} alt="" />
                          <button type="button" aria-label="Quitar foto" onClick={() => removeGalleryImage(url)}>
                            <X size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}

            <div className="news-cms-save-row">
              <button type="button" className="btn btn-secondary" onClick={cancelEdit}>Cancelar</button>
              <button type="submit" className="btn btn-primary" disabled={saving || uploading}>
                <Save size={16} aria-hidden="true" />
                {saving ? 'Guardando…' : 'Guardar noticia'}
              </button>
            </div>
          </form>
        )}
      </div>

      {!editingId && !isEditing && (
        <p className="news-cms-hint">
          Tip: las noticias publicadas aparecen en <strong>Revista Digital</strong> del socio. Los borradores solo se ven acá.
        </p>
      )}
    </div>
  );
}
