/** Campos editables por el socio desde su perfil. */

export const EDITABLE_PROFILE_FIELDS = [
  'phone',
  'phoneAlt',
  'email',
  'address',
  'city',
  'province',
  'postalCode',
  'emergencyContact',
  'emergencyPhone',
  'photo',
  'disciplines',
  'notifyDues',
  'notifyReservations',
  'notifyEvents',
  'preferredSports',
];

/** Campos que se trazan al guardar la ficha (incluye overrides de staff). */
export const PROFILE_TRACE_FIELDS = [
  ...EDITABLE_PROFILE_FIELDS,
  'name',
  'documentNumber',
  'birthDate',
  'tier',
];

export const PROFILE_FIELD_LABELS = Object.freeze({
  phone: 'WhatsApp',
  phoneAlt: 'Tel. alternativo',
  email: 'Email',
  address: 'Domicilio',
  city: 'Localidad',
  province: 'Provincia',
  postalCode: 'CP',
  emergencyContact: 'Contacto emergencia',
  emergencyPhone: 'Tel. emergencia',
  photo: 'Foto',
  disciplines: 'Disciplinas',
  preferredSports: 'Disciplinas',
  notifyDues: 'Avisos de cuota',
  notifyReservations: 'Avisos de reservas',
  notifyEvents: 'Avisos de eventos',
  name: 'Nombre',
  documentNumber: 'Documento',
  birthDate: 'Nacimiento',
  tier: 'Categoría',
});

function normalizeTraceValue(key, value) {
  if (key === 'disciplines' || key === 'preferredSports') {
    const list = Array.isArray(value) ? value.map((v) => String(v || '').trim()).filter(Boolean) : [];
    return [...new Set(list)].sort((a, b) => a.localeCompare(b, 'es')).join(', ');
  }
  if (typeof value === 'boolean') return value ? 'sí' : 'no';
  if (key === 'photo') return value ? 'con foto' : 'sin foto';
  return String(value ?? '').trim();
}

/** Diff de ficha para auditoría (sin base64 de fotos). */
export function diffMemberProfile(before = {}, after = {}, fields = PROFILE_TRACE_FIELDS) {
  const changes = [];
  const seen = new Set();
  for (const key of fields) {
    if (key === 'preferredSports') continue; // se refleja en disciplines
    if (seen.has(key)) continue;
    seen.add(key);
    const from = normalizeTraceValue(key, before?.[key]);
    const to = normalizeTraceValue(key, after?.[key]);
    if (from === to) continue;
    changes.push({
      field: key,
      label: PROFILE_FIELD_LABELS[key] || key,
      from: from || '—',
      to: to || '—',
    });
  }
  return changes;
}

/**
 * Sella el socio con historial de edición (meta.profileEditHistory + lastProfileEdit).
 * Si no hubo cambios de campos trazados, devuelve `after` sin tocar el meta.
 */
export function withProfileEditTrace(before, after, {
  actorId = null,
  actorName = '',
  source = 'panel',
} = {}) {
  if (!after) return after;
  const changes = diffMemberProfile(before, after);
  if (!changes.length) return after;
  const entry = {
    at: new Date().toISOString(),
    actorId: actorId || null,
    actorName: String(actorName || '').trim() || null,
    source,
    changes,
  };
  const prev = Array.isArray(before?.meta?.profileEditHistory)
    ? before.meta.profileEditHistory
    : (Array.isArray(after?.meta?.profileEditHistory) ? after.meta.profileEditHistory : []);
  return {
    ...after,
    meta: {
      ...(after.meta && typeof after.meta === 'object' ? after.meta : {}),
      profileEditHistory: [...prev, entry].slice(-60),
      lastProfileEdit: entry,
    },
  };
}

export function applyMemberProfileUpdate(member, patch = {}) {
  if (!member) throw new Error('Socio no encontrado.');
  const next = { ...member };
  for (const key of EDITABLE_PROFILE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) {
      next[key] = patch[key];
    }
  }
  // Preferencias de notificación con defaults
  next.notifyDues = next.notifyDues !== false;
  next.notifyReservations = next.notifyReservations !== false;
  next.notifyEvents = next.notifyEvents !== false;
  next.recordScope = 'full';
  next.updatedAt = new Date().toISOString();
  return next;
}

export const DOCUMENT_TYPES = [
  { id: 'medical', label: 'Carnet médico / apto físico' },
  { id: 'insurance', label: 'Seguro deportivo' },
  { id: 'id_copy', label: 'Copia de DNI' },
];

export function upsertMemberDocument(member, { type, fileName, note }) {
  if (!type) throw new Error('Tipo de documento requerido.');
  const docs = [...(member.documents || [])];
  const row = {
    id: `doc-${type}`,
    type,
    fileName: fileName || `${type}.pdf`,
    note: note || '',
    uploadedAt: new Date().toISOString(),
    status: 'pending_review',
  };
  const idx = docs.findIndex((d) => d.type === type);
  if (idx >= 0) docs[idx] = row;
  else docs.push(row);
  return { ...member, documents: docs };
}
