/** Columnas reales de public.profiles. username y el mail de contacto viven en meta. */
export const PROFILE_SESSION_COLUMNS = 'full_name, role, document_number, discipline_ids, meta';

export function profileSessionFields(profileRow) {
  const meta = profileRow?.meta && typeof profileRow.meta === 'object' && !Array.isArray(profileRow.meta)
    ? profileRow.meta
    : {};
  const contact = meta.contactEmail || meta.contact_email || '';
  return {
    fullName: profileRow?.full_name || '',
    role: profileRow?.role || null,
    documentNumber: profileRow?.document_number || '',
    username: meta.username ? String(meta.username) : null,
    contactEmail: contact ? String(contact) : null,
    disciplineIds: Array.isArray(profileRow?.discipline_ids) ? profileRow.discipline_ids : null,
  };
}
