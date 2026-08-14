import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { unwrap } from './errors';

const BUCKET = 'concession-docs';
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
]);

function extFromFile(file) {
  const fromName = String(file?.name || '').split('.').pop()?.toLowerCase();
  if (fromName && fromName.length <= 5) return fromName;
  if (file?.type === 'application/pdf') return 'pdf';
  if (file?.type === 'image/png') return 'png';
  if (file?.type === 'image/webp') return 'webp';
  if (file?.type === 'image/gif') return 'gif';
  return 'jpg';
}

export function validateConcessionDocFile(file) {
  if (!file) throw new Error('Seleccioná un archivo.');
  if (file.size > MAX_BYTES) throw new Error('El archivo supera 10 MB.');
  if (file.type && !ALLOWED.has(file.type)) {
    throw new Error('Solo PDF o imagen (JPG, PNG, WEBP).');
  }
  return true;
}

/**
 * Sube PDF/foto de contrato u otro documento de concesión a Storage.
 * @returns {{ path, url, name, mimeType, size }}
 */
export async function uploadConcessionDocument(file, { concessionId, type = 'contrato' } = {}) {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase no configurado: no se puede subir el archivo.');
  }
  validateConcessionDocFile(file);

  const safeType = String(type || 'doc').replace(/[^a-z0-9_-]/gi, '');
  const folder = concessionId || 'pending';
  const path = `${folder}/${safeType}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${extFromFile(file)}`;

  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    cacheControl: '3600',
    upsert: false,
    contentType: file.type || undefined,
  });
  if (error) throw new Error(error.message || 'No se pudo subir el archivo.');

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return {
    path,
    url: data?.publicUrl || '',
    name: file.name || path.split('/').pop(),
    mimeType: file.type || '',
    size: file.size || 0,
  };
}

export async function removeConcessionDocumentFile(path) {
  if (!isSupabaseConfigured || !supabase || !path) return;
  await unwrap(
    supabase.storage.from(BUCKET).remove([path]),
    'No se pudo borrar el archivo'
  );
}

/**
 * Sube imagen de portada/galería de la revista a Storage (misma bucket, carpeta news/).
 * @returns {{ path, url, name, mimeType, size }}
 */
export async function uploadNewsImage(file, { articleId = 'draft' } = {}) {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase no configurado: no se puede subir la imagen.');
  }
  if (!file) throw new Error('Seleccioná una imagen.');
  if (file.size > MAX_BYTES) throw new Error('La imagen supera 10 MB.');
  if (file.type && !String(file.type).startsWith('image/')) {
    throw new Error('Solo se permiten imágenes.');
  }

  const folder = String(articleId || 'draft').replace(/[^a-z0-9_-]/gi, '') || 'draft';
  const path = `news/${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${extFromFile(file)}`;

  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    cacheControl: '3600',
    upsert: false,
    contentType: file.type || undefined,
  });
  if (error) throw new Error(error.message || 'No se pudo subir la imagen.');

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return {
    path,
    url: data?.publicUrl || '',
    name: file.name || path.split('/').pop(),
    mimeType: file.type || '',
    size: file.size || 0,
  };
}
