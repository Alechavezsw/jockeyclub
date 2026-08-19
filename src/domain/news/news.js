/** Revista digital / CMS de noticias del club. */

export const NEWS_CATEGORIES = [
  { id: 'deportes', label: 'Deportes' },
  { id: 'eventos', label: 'Eventos sociales' },
  { id: 'gourmet', label: 'Gourmet' },
  { id: 'institucional', label: 'Institucional' },
  { id: 'infraestructura', label: 'Infraestructura' },
  { id: 'cultura', label: 'Cultura' },
  { id: 'socios', label: 'Vida social' },
];

export const NEWS_STATUSES = [
  { id: 'draft', label: 'Borrador' },
  { id: 'scheduled', label: 'Programada' },
  { id: 'published', label: 'Publicada' },
  { id: 'archived', label: 'Archivada' },
];

export const DEFAULT_NEWS_IMAGES = {
  deportes: 'https://images.unsplash.com/photo-1544698310-74ea9d1c8258?q=80&w=1200&auto=format&fit=crop',
  eventos: 'https://images.unsplash.com/photo-1511795409834-ef04bbd61622?q=80&w=1200&auto=format&fit=crop',
  gourmet: 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?q=80&w=1200&auto=format&fit=crop',
  institucional: 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?q=80&w=1200&auto=format&fit=crop',
  infraestructura: 'https://images.unsplash.com/photo-1503387762-592deb58ef4e?q=80&w=1200&auto=format&fit=crop',
  cultura: 'https://images.unsplash.com/photo-1460661419201-fd4cecdf8a8b?q=80&w=1200&auto=format&fit=crop',
  socios: 'https://images.unsplash.com/photo-1529156069898-49953e39b3ac?q=80&w=1200&auto=format&fit=crop',
};

export function newsCategoryLabel(id) {
  return NEWS_CATEGORIES.find((c) => c.id === id)?.label || id || 'General';
}

export function newsStatusLabel(id) {
  return NEWS_STATUSES.find((s) => s.id === id)?.label || id || 'Borrador';
}

export function formatNewsDateLabel(date = new Date()) {
  return new Date(date).toLocaleDateString('es-AR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function slugifyNewsTitle(title = '') {
  return String(title)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || `nota-${Date.now()}`;
}

export function estimateReadingMinutes(content = '') {
  const plain = String(content)
    .replace(/\[imagen\]\([^)]+\)/g, ' ')
    .replace(/[#*_>`]/g, ' ')
    .trim();
  const words = plain.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 200));
}

export function countNewsWords(content = '') {
  return String(content)
    .replace(/\[imagen\]\([^)]+\)/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function parseTags(input) {
  if (Array.isArray(input)) {
    return [...new Set(input.map((t) => String(t).trim()).filter(Boolean))];
  }
  return [...new Set(
    String(input || '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
  )];
}

function resolveStatus(input = {}) {
  if (input.status && NEWS_STATUSES.some((s) => s.id === input.status)) {
    return input.status;
  }
  if (input.isPublished === false) return 'draft';
  if (input.scheduledAt) {
    const when = new Date(input.scheduledAt).getTime();
    if (!Number.isNaN(when) && when > Date.now()) return 'scheduled';
  }
  return 'published';
}

export function emptyNewsDraft() {
  return {
    id: null,
    title: '',
    slug: '',
    category: 'institucional',
    excerpt: '',
    content: '',
    image: '',
    gallery: [],
    date: formatNewsDateLabel(),
    author: '',
    tags: [],
    tagsText: '',
    isEvent: false,
    isPublished: false,
    status: 'draft',
    featured: false,
    pinned: false,
    scheduledAt: '',
    eventDate: '',
    seoTitle: '',
    seoDescription: '',
    coverCredit: '',
    allowRsvp: false,
    updatedAt: null,
    createdAt: null,
  };
}

export function normalizeNewsArticle(input = {}) {
  const category = String(input.category || 'institucional').toLowerCase();
  const gallery = Array.isArray(input.gallery)
    ? input.gallery.filter(Boolean)
    : [];
  const tags = parseTags(input.tags ?? input.tagsText);
  const status = resolveStatus(input);
  const title = String(input.title || '').trim();
  const slug = String(input.slug || '').trim() || slugifyNewsTitle(title || 'nota');
  const isPublished = status === 'published';

  return {
    id: input.id || `tmp-news-${Date.now()}`,
    title,
    slug,
    category,
    excerpt: String(input.excerpt || '').trim(),
    content: String(input.content || '').trim(),
    image: input.image || DEFAULT_NEWS_IMAGES[category] || DEFAULT_NEWS_IMAGES.institucional,
    gallery,
    date: input.date || formatNewsDateLabel(),
    author: String(input.author || '').trim(),
    tags,
    tagsText: tags.join(', '),
    isEvent: Boolean(input.isEvent ?? input.allowRsvp ?? (category === 'eventos' || category === 'deportes')),
    allowRsvp: Boolean(input.allowRsvp ?? input.isEvent),
    isPublished,
    status,
    featured: Boolean(input.featured),
    pinned: Boolean(input.pinned),
    scheduledAt: input.scheduledAt || '',
    eventDate: input.eventDate || '',
    seoTitle: String(input.seoTitle || '').trim(),
    seoDescription: String(input.seoDescription || '').trim(),
    coverCredit: String(input.coverCredit || '').trim(),
    readingMinutes: estimateReadingMinutes(input.content || ''),
    wordCount: countNewsWords(input.content || ''),
    updatedAt: input.updatedAt || new Date().toISOString(),
    createdAt: input.createdAt || input.updatedAt || new Date().toISOString(),
  };
}

/**
 * Visible para socios: publicada (y no archivada), o programada cuyo horario ya pasó.
 */
export function isNewsPublished(article, now = new Date()) {
  if (!article) return false;
  const status = article.status
    || (article.isPublished === false ? 'draft' : 'published');
  if (status === 'archived' || status === 'draft') return false;
  if (status === 'scheduled') {
    const when = article.scheduledAt ? new Date(article.scheduledAt).getTime() : NaN;
    return !Number.isNaN(when) && when <= now.getTime();
  }
  return status === 'published';
}

export function isNewsFeatured(article) {
  return Boolean(article?.featured || article?.pinned);
}

export function sortNewsForCms(list = [], sortBy = 'updated') {
  const rows = [...list];
  rows.sort((a, b) => {
    if (sortBy === 'title') return (a.title || '').localeCompare(b.title || '', 'es');
    if (sortBy === 'category') return (a.category || '').localeCompare(b.category || '', 'es');
    if (sortBy === 'status') return (a.status || '').localeCompare(b.status || '', 'es');
    // updated / default: pinned first, then featured, then date
    const pin = Number(Boolean(b.pinned)) - Number(Boolean(a.pinned));
    if (pin) return pin;
    const feat = Number(Boolean(b.featured)) - Number(Boolean(a.featured));
    if (feat) return feat;
    const da = new Date(b.updatedAt || b.createdAt || 0).getTime();
    const db = new Date(a.updatedAt || a.createdAt || 0).getTime();
    return da - db;
  });
  return rows;
}

export function buildNewsCmsStats(list = []) {
  const rows = list || [];
  return {
    total: rows.length,
    published: rows.filter((n) => n.status === 'published' || (n.isPublished !== false && !n.status)).length,
    drafts: rows.filter((n) => n.status === 'draft' || n.isPublished === false).length,
    scheduled: rows.filter((n) => n.status === 'scheduled').length,
    featured: rows.filter((n) => n.featured || n.pinned).length,
    archived: rows.filter((n) => n.status === 'archived').length,
  };
}

export function duplicateNewsArticle(article) {
  const base = normalizeNewsArticle(article);
  return normalizeNewsArticle({
    ...base,
    id: `tmp-news-${Date.now()}`,
    title: `${base.title} (copia)`,
    slug: slugifyNewsTitle(`${base.title}-copia`),
    status: 'draft',
    isPublished: false,
    featured: false,
    pinned: false,
    scheduledAt: '',
    date: formatNewsDateLabel(),
    updatedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  });
}

/** Inserta markup simple alrededor de la selección del textarea. */
export function wrapTextareaSelection(value, start, end, before, after = before) {
  const selected = value.slice(start, end) || 'texto';
  const next = `${value.slice(0, start)}${before}${selected}${after}${value.slice(end)}`;
  const cursor = start + before.length + selected.length + after.length;
  return { value: next, cursor };
}

/**
 * Comprime una imagen a data URL JPEG (offline / fallback).
 */
export function readNewsImageAsDataUrl(file, maxEdge = 1400, quality = 0.82) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type?.startsWith('image/')) {
      reject(new Error('Seleccioná una imagen (JPG, PNG o WEBP).'));
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      reject(new Error('La imagen supera 12 MB.'));
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        URL.revokeObjectURL(url);
        resolve(dataUrl);
      } catch (err) {
        URL.revokeObjectURL(url);
        reject(err);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('No se pudo leer la imagen.'));
    };
    img.src = url;
  });
}
