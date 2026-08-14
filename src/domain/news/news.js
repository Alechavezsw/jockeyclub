/** Revista digital / CMS de noticias del club. */

export const NEWS_CATEGORIES = [
  { id: 'deportes', label: 'Deportes' },
  { id: 'eventos', label: 'Eventos sociales' },
  { id: 'gourmet', label: 'Gourmet' },
  { id: 'institucional', label: 'Institucional' },
  { id: 'infraestructura', label: 'Infraestructura' },
];

export const DEFAULT_NEWS_IMAGES = {
  deportes: 'https://images.unsplash.com/photo-1544698310-74ea9d1c8258?q=80&w=1200&auto=format&fit=crop',
  eventos: 'https://images.unsplash.com/photo-1511795409834-ef04bbd61622?q=80&w=1200&auto=format&fit=crop',
  gourmet: 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?q=80&w=1200&auto=format&fit=crop',
  institucional: 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?q=80&w=1200&auto=format&fit=crop',
  infraestructura: 'https://images.unsplash.com/photo-1503387762-592deb58ef4e?q=80&w=1200&auto=format&fit=crop',
};

export function newsCategoryLabel(id) {
  return NEWS_CATEGORIES.find((c) => c.id === id)?.label || id || 'General';
}

export function formatNewsDateLabel(date = new Date()) {
  return new Date(date).toLocaleDateString('es-AR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function emptyNewsDraft() {
  return {
    id: null,
    title: '',
    category: 'institucional',
    excerpt: '',
    content: '',
    image: '',
    gallery: [],
    date: formatNewsDateLabel(),
    isEvent: false,
    isPublished: true,
  };
}

export function normalizeNewsArticle(input = {}) {
  const category = String(input.category || 'institucional').toLowerCase();
  const gallery = Array.isArray(input.gallery)
    ? input.gallery.filter(Boolean)
    : [];
  return {
    id: input.id || `tmp-news-${Date.now()}`,
    title: String(input.title || '').trim(),
    category,
    excerpt: String(input.excerpt || '').trim(),
    content: String(input.content || '').trim(),
    image: input.image || DEFAULT_NEWS_IMAGES[category] || DEFAULT_NEWS_IMAGES.institucional,
    gallery,
    date: input.date || formatNewsDateLabel(),
    isEvent: Boolean(input.isEvent ?? (category === 'eventos' || category === 'deportes')),
    isPublished: input.isPublished !== false,
  };
}

export function isNewsPublished(article) {
  return article?.isPublished !== false;
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
