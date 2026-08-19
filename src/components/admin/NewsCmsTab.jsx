import { useMemo, useRef, useState } from 'react';
import {
  Newspaper, Plus, Pencil, Trash2, ImagePlus, Eye, EyeOff,
  Save, X, Calendar, Tag, Images, Upload, Search, Copy, Star,
  Pin, Clock, Archive, Bold, Italic, Heading2, Quote, Link2,
  List, Type, Sparkles, Globe, User,
} from 'lucide-react';
import { isSupabaseConfigured } from '../../lib/supabase';
import { uploadNewsImage } from '../../data/storage';
import {
  NEWS_CATEGORIES,
  NEWS_STATUSES,
  DEFAULT_NEWS_IMAGES,
  emptyNewsDraft,
  normalizeNewsArticle,
  newsCategoryLabel,
  newsStatusLabel,
  formatNewsDateLabel,
  readNewsImageAsDataUrl,
  buildNewsCmsStats,
  sortNewsForCms,
  duplicateNewsArticle,
  slugifyNewsTitle,
  wrapTextareaSelection,
  estimateReadingMinutes,
  countNewsWords,
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

function statusBadgeClass(status) {
  if (status === 'draft') return 'is-draft';
  if (status === 'scheduled') return 'is-scheduled';
  if (status === 'archived') return 'is-archived';
  return '';
}

/** CMS completo de la Revista Digital. */
export default function NewsCmsTab({ newsList = [], setNewsList, authorName = '' }) {
  const defaultAuthor = String(authorName || '').trim();
  const makeEmptyDraft = () => ({
    ...emptyNewsDraft(),
    author: defaultAuthor,
  });

  const [filter, setFilter] = useState('todos');
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState('updated');
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState(makeEmptyDraft);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState(false);
  const [editorTab, setEditorTab] = useState('contenido');
  const coverInputRef = useRef(null);
  const galleryInputRef = useRef(null);
  const bodyInsertRef = useRef(null);
  const bodyRef = useRef(null);

  const stats = useMemo(() => buildNewsCmsStats(newsList), [newsList]);

  const filtered = useMemo(() => {
    let list = [...(newsList || [])].map((n) => normalizeNewsArticle(n));
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter((n) =>
        n.title.toLowerCase().includes(q)
        || n.excerpt.toLowerCase().includes(q)
        || n.author.toLowerCase().includes(q)
        || (n.tags || []).some((t) => t.toLowerCase().includes(q))
        || n.slug.toLowerCase().includes(q)
      );
    }
    if (filter === 'borrador') list = list.filter((n) => n.status === 'draft');
    else if (filter === 'publicado') list = list.filter((n) => n.status === 'published');
    else if (filter === 'programada') list = list.filter((n) => n.status === 'scheduled');
    else if (filter === 'destacada') list = list.filter((n) => n.featured || n.pinned);
    else if (filter === 'archivada') list = list.filter((n) => n.status === 'archived');
    else if (filter !== 'todos') list = list.filter((n) => String(n.category).toLowerCase() === filter);
    return sortNewsForCms(list, sortBy);
  }, [newsList, filter, query, sortBy]);

  const wordCount = countNewsWords(draft.content);
  const readingMin = estimateReadingMinutes(draft.content);

  const startCreate = () => {
    setEditingId('new');
    setDraft(makeEmptyDraft());
    setError('');
    setPreview(false);
    setEditorTab('contenido');
  };

  const startEdit = (article) => {
    const normalized = normalizeNewsArticle(article);
    setEditingId(article.id);
    setDraft({
      ...normalized,
      author: normalized.author || defaultAuthor,
    });
    setError('');
    setPreview(false);
    setEditorTab('contenido');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraft(makeEmptyDraft());
    setError('');
    setPreview(false);
    setEditorTab('contenido');
  };

  const patch = (partial) => setDraft((prev) => ({ ...prev, ...partial }));

  const applyStatus = (status) => {
    patch({
      status,
      isPublished: status === 'published',
      scheduledAt: status === 'scheduled' ? (draft.scheduledAt || '') : draft.scheduledAt,
    });
  };

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
      for (const file of list.slice(0, 12)) {
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

  const applyFormat = (before, after = before) => {
    const el = bodyRef.current;
    if (!el) return;
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    const { value, cursor } = wrapTextareaSelection(draft.content || '', start, end, before, after);
    patch({ content: value });
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(cursor, cursor);
    });
  };

  const removeGalleryImage = (url) => {
    patch({ gallery: (draft.gallery || []).filter((u) => u !== url) });
  };

  const moveGallery = (index, dir) => {
    const next = [...(draft.gallery || [])];
    const j = index + dir;
    if (j < 0 || j >= next.length) return;
    [next[index], next[j]] = [next[j], next[index]];
    patch({ gallery: next });
  };

  const handleSave = async (e, overrides = {}) => {
    e?.preventDefault?.();
    if (!setNewsList) return;
    const merged = { ...draft, ...overrides };
    if (!String(merged.title || '').trim() || !String(merged.excerpt || '').trim() || !String(merged.content || '').trim()) {
      setError('Completá título, bajada y cuerpo de la noticia.');
      setEditorTab('contenido');
      return;
    }
    if (merged.status === 'scheduled' && !merged.scheduledAt) {
      setError('Indicá fecha y hora de publicación programada.');
      setEditorTab('publicacion');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const existingId = editingId && editingId !== 'new' ? editingId : null;
      const article = normalizeNewsArticle({
        ...merged,
        id: existingId || undefined,
        author: merged.author || defaultAuthor,
        date: merged.date || formatNewsDateLabel(),
        slug: merged.slug || slugifyNewsTitle(merged.title),
        tags: merged.tagsText,
        image: merged.image || DEFAULT_NEWS_IMAGES[merged.category] || DEFAULT_NEWS_IMAGES.institucional,
        updatedAt: new Date().toISOString(),
        createdAt: merged.createdAt || new Date().toISOString(),
        isEvent: merged.allowRsvp || merged.isEvent,
        status: merged.status || 'draft',
        isPublished: (merged.status || 'draft') === 'published',
      });

      setNewsList((prev) => {
        const exists = existingId
          ? prev.some((n) => String(n.id) === String(existingId))
          : prev.some((n) => String(n.id) === String(article.id));
        if (exists) {
          const matchId = existingId || article.id;
          return prev.map((n) => (String(n.id) === String(matchId) ? { ...n, ...article, id: n.id } : n));
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

  const handleDuplicate = (article) => {
    if (!setNewsList) return;
    const copy = duplicateNewsArticle(article);
    setNewsList((prev) => [copy, ...prev]);
    startEdit(copy);
  };

  const quickTogglePublish = (article) => {
    if (!setNewsList) return;
    const nextStatus = article.status === 'published' ? 'draft' : 'published';
    setNewsList((prev) => prev.map((n) => {
      if (String(n.id) !== String(article.id)) return n;
      return normalizeNewsArticle({
        ...n,
        status: nextStatus,
        isPublished: nextStatus === 'published',
        updatedAt: new Date().toISOString(),
      });
    }));
  };

  const quickToggleFeatured = (article) => {
    if (!setNewsList) return;
    setNewsList((prev) => prev.map((n) => (
      String(n.id) === String(article.id)
        ? { ...n, featured: !n.featured, updatedAt: new Date().toISOString() }
        : n
    )));
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
      const lines = part.split('\n');
      return (
        <div key={`block-${i}`} className="news-cms-preview-block">
          {lines.map((line, li) => {
            if (line.startsWith('## ')) return <h3 key={li}>{line.slice(3)}</h3>;
            if (line.startsWith('> ')) return <blockquote key={li}>{line.slice(2)}</blockquote>;
            if (line.startsWith('- ')) return <li key={li}>{line.slice(2)}</li>;
            if (!line.trim()) return <br key={li} />;
            return <p key={li} className="news-cms-preview-p">{line}</p>;
          })}
        </div>
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
            CMS editorial: borradores, programación, destacadas, SEO, galería y vista previa.
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={startCreate}>
          <Plus size={16} aria-hidden="true" /> Nueva noticia
        </button>
      </div>

      <section className="news-cms-kpis" aria-label="Resumen editorial">
        <article><span>Total</span><strong>{stats.total}</strong></article>
        <article><span>Publicadas</span><strong>{stats.published}</strong></article>
        <article><span>Borradores</span><strong>{stats.drafts}</strong></article>
        <article><span>Programadas</span><strong>{stats.scheduled}</strong></article>
        <article className="is-gold"><span>Destacadas</span><strong>{stats.featured}</strong></article>
      </section>

      <div className="news-cms-toolbar">
        <label className="news-cms-search">
          <Search size={14} aria-hidden="true" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar título, tag, autor, slug…"
          />
        </label>
        <select
          className="form-input news-cms-sort"
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          aria-label="Ordenar"
        >
          <option value="updated">Más recientes</option>
          <option value="title">Título A–Z</option>
          <option value="category">Categoría</option>
          <option value="status">Estado</option>
        </select>
      </div>

      <div className="news-cms-filters" role="tablist" aria-label="Filtro de noticias">
        {[
          { id: 'todos', label: 'Todas' },
          { id: 'publicado', label: 'Publicadas' },
          { id: 'borrador', label: 'Borradores' },
          { id: 'programada', label: 'Programadas' },
          { id: 'destacada', label: 'Destacadas' },
          { id: 'archivada', label: 'Archivadas' },
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
                    <strong>
                      {article.pinned ? <Pin size={12} aria-hidden="true" /> : null}
                      {article.featured ? <Star size={12} aria-hidden="true" /> : null}
                      {article.title}
                    </strong>
                    <span className={`news-cms-badge ${statusBadgeClass(article.status)}`}>
                      {newsStatusLabel(article.status)}
                    </span>
                  </div>
                  <p>{article.excerpt}</p>
                  <small>
                    <Tag size={12} aria-hidden="true" /> {newsCategoryLabel(article.category)}
                    <Calendar size={12} aria-hidden="true" /> {article.date}
                    {article.author ? (
                      <>
                        <User size={12} aria-hidden="true" /> {article.author}
                      </>
                    ) : null}
                    {(article.gallery || []).length > 0 && (
                      <>
                        <Images size={12} aria-hidden="true" /> {article.gallery.length}
                      </>
                    )}
                    <Clock size={12} aria-hidden="true" /> {article.readingMinutes || estimateReadingMinutes(article.content)} min
                  </small>
                </div>
                <div className="news-cms-row-actions">
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => quickToggleFeatured(article)} title="Destacar">
                    <Star size={14} aria-hidden="true" />
                  </button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => quickTogglePublish(article)} title="Publicar / borrador">
                    {article.status === 'published' ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => handleDuplicate(article)} title="Duplicar">
                    <Copy size={14} aria-hidden="true" />
                  </button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => startEdit(article)}>
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
          <form className="news-cms-editor glass-card" onSubmit={(e) => void handleSave(e)}>
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

            <div className="news-cms-editor-tabs" role="tablist">
              {[
                { id: 'contenido', label: 'Contenido', icon: Type },
                { id: 'publicacion', label: 'Publicación', icon: Globe },
                { id: 'seo', label: 'SEO', icon: Sparkles },
                { id: 'media', label: 'Media', icon: Images },
              ].map((tab) => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={editorTab === tab.id}
                    className={editorTab === tab.id ? 'is-active' : ''}
                    onClick={() => { setEditorTab(tab.id); setPreview(false); }}
                  >
                    <Icon size={14} /> {tab.label}
                  </button>
                );
              })}
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
                  {draft.author ? ` · ${draft.author}` : ''}
                  {' · '}{newsStatusLabel(draft.status)}
                  {' · '}{readingMin} min de lectura
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
                {editorTab === 'contenido' && (
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
                        onChange={(e) => {
                          const title = e.target.value;
                          patch({
                            title,
                            slug: draft.slug && editingId !== 'new'
                              ? draft.slug
                              : slugifyNewsTitle(title),
                          });
                        }}
                        placeholder="Ej: Torneo interno de pádel…"
                        required
                      />
                      <small className="news-cms-char">{draft.title.length}/120</small>
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
                              allowRsvp: category === 'eventos' || category === 'deportes' ? draft.allowRsvp : draft.allowRsvp,
                            });
                          }}
                        >
                          {NEWS_CATEGORIES.map((c) => (
                            <option key={c.id} value={c.id}>{c.label}</option>
                          ))}
                        </select>
                      </div>
                      <div className="form-group">
                        <label className="form-label" htmlFor="news-author">Autor / firma</label>
                        <input
                          id="news-author"
                          className="form-input"
                          value={draft.author}
                          onChange={(e) => patch({ author: e.target.value })}
                          placeholder={defaultAuthor || 'Redacción Jockey Club'}
                        />
                        {defaultAuthor ? (
                          <small className="news-cms-char">Por defecto: usuario de sesión</small>
                        ) : null}
                      </div>
                    </div>

                    <div className="form-group">
                      <label className="form-label" htmlFor="news-tags">Tags (separados por coma)</label>
                      <input
                        id="news-tags"
                        className="form-input"
                        value={draft.tagsText || ''}
                        onChange={(e) => patch({ tagsText: e.target.value })}
                        placeholder="pádel, torneo, juveniles…"
                      />
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
                      <small className="news-cms-char">{draft.excerpt.length}/220</small>
                    </div>

                    <div className="form-group">
                      <div className="news-cms-body-label">
                        <label className="form-label" htmlFor="news-body">Cuerpo</label>
                        <span className="news-cms-wordcount">{wordCount} palabras · {readingMin} min</span>
                      </div>
                      <div className="news-cms-formatbar" aria-label="Formato">
                        <button type="button" title="Negrita" onClick={() => applyFormat('**', '**')}><Bold size={14} /></button>
                        <button type="button" title="Cursiva" onClick={() => applyFormat('_', '_')}><Italic size={14} /></button>
                        <button type="button" title="Subtítulo" onClick={() => applyFormat('\n## ', '')}><Heading2 size={14} /></button>
                        <button type="button" title="Cita" onClick={() => applyFormat('\n> ', '')}><Quote size={14} /></button>
                        <button type="button" title="Lista" onClick={() => applyFormat('\n- ', '')}><List size={14} /></button>
                        <button type="button" title="Enlace" onClick={() => applyFormat('[', '](https://)')}><Link2 size={14} /></button>
                        <button
                          type="button"
                          title="Insertar foto"
                          disabled={uploading}
                          onClick={() => bodyInsertRef.current?.click()}
                        >
                          <ImagePlus size={14} />
                        </button>
                        <input
                          ref={bodyInsertRef}
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
                        rows={14}
                        value={draft.content}
                        onChange={(e) => patch({ content: e.target.value })}
                        placeholder="Escribí la noticia. Usá la barra de formato o insertá fotos en el texto."
                        required
                      />
                    </div>
                  </>
                )}

                {editorTab === 'publicacion' && (
                  <>
                    <div className="form-group">
                      <label className="form-label" htmlFor="news-status">Estado</label>
                      <select
                        id="news-status"
                        className="form-input"
                        value={draft.status}
                        onChange={(e) => applyStatus(e.target.value)}
                      >
                        {NEWS_STATUSES.map((s) => (
                          <option key={s.id} value={s.id}>{s.label}</option>
                        ))}
                      </select>
                    </div>

                    <div className="news-cms-grid-2">
                      <div className="form-group">
                        <label className="form-label" htmlFor="news-date">Fecha visible</label>
                        <input
                          id="news-date"
                          className="form-input"
                          value={draft.date}
                          onChange={(e) => patch({ date: e.target.value })}
                        />
                      </div>
                      <div className="form-group">
                        <label className="form-label" htmlFor="news-schedule">Publicar el (programada)</label>
                        <input
                          id="news-schedule"
                          type="datetime-local"
                          className="form-input"
                          value={draft.scheduledAt ? String(draft.scheduledAt).slice(0, 16) : ''}
                          onChange={(e) => patch({
                            scheduledAt: e.target.value,
                            status: e.target.value ? 'scheduled' : draft.status,
                            isPublished: false,
                          })}
                        />
                      </div>
                    </div>

                    <div className="news-cms-toggles">
                      <label className="news-cms-check">
                        <input
                          type="checkbox"
                          checked={Boolean(draft.featured)}
                          onChange={(e) => patch({ featured: e.target.checked })}
                        />
                        <Star size={14} />
                        Destacada en portada de revista
                      </label>
                      <label className="news-cms-check">
                        <input
                          type="checkbox"
                          checked={Boolean(draft.pinned)}
                          onChange={(e) => patch({ pinned: e.target.checked })}
                        />
                        <Pin size={14} />
                        Fijada arriba del listado
                      </label>
                      <label className="news-cms-check">
                        <input
                          type="checkbox"
                          checked={Boolean(draft.allowRsvp || draft.isEvent)}
                          onChange={(e) => patch({ allowRsvp: e.target.checked, isEvent: e.target.checked })}
                        />
                        <Calendar size={14} />
                        Evento con RSVP
                      </label>
                    </div>

                    {(draft.allowRsvp || draft.isEvent) && (
                      <div className="form-group">
                        <label className="form-label" htmlFor="news-event-date">Fecha del evento</label>
                        <input
                          id="news-event-date"
                          type="date"
                          className="form-input"
                          value={draft.eventDate || ''}
                          onChange={(e) => patch({ eventDate: e.target.value })}
                        />
                      </div>
                    )}

                    {draft.status === 'archived' && (
                      <p className="news-cms-hint-inline">
                        <Archive size={14} /> Archivada: no se muestra a socios.
                      </p>
                    )}
                  </>
                )}

                {editorTab === 'seo' && (
                  <>
                    <div className="form-group">
                      <label className="form-label" htmlFor="news-slug">Slug / URL</label>
                      <div className="news-cms-slug-row">
                        <span>/revista/</span>
                        <input
                          id="news-slug"
                          className="form-input"
                          value={draft.slug}
                          onChange={(e) => patch({ slug: slugifyNewsTitle(e.target.value) })}
                        />
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => patch({ slug: slugifyNewsTitle(draft.title) })}
                        >
                          Autogenerar
                        </button>
                      </div>
                    </div>
                    <div className="form-group">
                      <label className="form-label" htmlFor="news-seo-title">Título SEO</label>
                      <input
                        id="news-seo-title"
                        className="form-input"
                        value={draft.seoTitle}
                        onChange={(e) => patch({ seoTitle: e.target.value })}
                        placeholder={draft.title || 'Título para buscadores'}
                      />
                      <small className="news-cms-char">{(draft.seoTitle || draft.title).length}/60 recomendado</small>
                    </div>
                    <div className="form-group">
                      <label className="form-label" htmlFor="news-seo-desc">Meta descripción</label>
                      <textarea
                        id="news-seo-desc"
                        className="form-input"
                        rows={3}
                        value={draft.seoDescription}
                        onChange={(e) => patch({ seoDescription: e.target.value })}
                        placeholder={draft.excerpt || 'Resumen para compartir y buscadores…'}
                      />
                      <small className="news-cms-char">{(draft.seoDescription || draft.excerpt).length}/160 recomendado</small>
                    </div>
                    <div className="news-cms-seo-card">
                      <span>Vista tipo Google</span>
                      <strong>{draft.seoTitle || draft.title || 'Título de la nota'}</strong>
                      <em>jockeyclubsj.org/revista/{draft.slug || 'nota'}</em>
                      <p>{draft.seoDescription || draft.excerpt || 'Meta descripción…'}</p>
                    </div>
                  </>
                )}

                {editorTab === 'media' && (
                  <>
                    <div className="form-group">
                      <label className="form-label" htmlFor="news-cover-url">URL de portada</label>
                      <input
                        id="news-cover-url"
                        className="form-input"
                        value={draft.image}
                        onChange={(e) => patch({ image: e.target.value })}
                        placeholder="https://…"
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label" htmlFor="news-credit">Crédito de foto</label>
                      <input
                        id="news-credit"
                        className="form-input"
                        value={draft.coverCredit}
                        onChange={(e) => patch({ coverCredit: e.target.value })}
                        placeholder="Foto: Archivo del club"
                      />
                    </div>

                    <div className="news-cms-gallery-block">
                      <div className="news-cms-body-label">
                        <span className="form-label" style={{ margin: 0 }}>Galería</span>
                        <label className="btn btn-secondary btn-sm" style={{ cursor: 'pointer' }}>
                          <Images size={14} aria-hidden="true" /> Agregar fotos
                          <input
                            ref={galleryInputRef}
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
                          {draft.gallery.map((url, index) => (
                            <div key={`${url}-${index}`} className="news-cms-gallery-item">
                              <img src={url} alt="" />
                              <div className="news-cms-gallery-item-tools">
                                <button type="button" aria-label="Subir" onClick={() => moveGallery(index, -1)}>↑</button>
                                <button type="button" aria-label="Bajar" onClick={() => moveGallery(index, 1)}>↓</button>
                                <button type="button" aria-label="Quitar foto" onClick={() => removeGalleryImage(url)}>
                                  <X size={14} />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </>
            )}

            <div className="news-cms-save-row">
              <button type="button" className="btn btn-secondary" onClick={cancelEdit}>Cancelar</button>
              {draft.status !== 'published' && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={saving || uploading}
                  onClick={() => void handleSave(null, { status: 'published', isPublished: true })}
                >
                  <Eye size={16} aria-hidden="true" /> Publicar ahora
                </button>
              )}
              <button
                type="button"
                className="btn btn-primary"
                disabled={saving || uploading}
                onClick={(e) => {
                  const status = draft.status || 'draft';
                  void handleSave(e, {
                    status,
                    isPublished: status === 'published',
                  });
                }}
              >
                <Save size={16} aria-hidden="true" />
                {saving
                  ? 'Guardando…'
                  : draft.status === 'scheduled'
                    ? 'Guardar programación'
                    : draft.status === 'published'
                      ? 'Guardar publicada'
                      : 'Guardar borrador'}
              </button>
            </div>
          </form>
        )}
      </div>

      {!editingId && (
        <p className="news-cms-hint">
          Tip: usá <strong>Destacadas</strong> y <strong>Fijadas</strong> para la portada de la revista.
          Las programadas se publican solas al llegar la fecha.
        </p>
      )}
    </div>
  );
}
