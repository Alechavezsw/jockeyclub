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
