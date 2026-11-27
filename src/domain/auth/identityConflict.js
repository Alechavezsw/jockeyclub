/**
 * Dos personas con el mismo nombre no son la misma ficha.
 * El correo, el DNI y el número tienen que coincidir antes de vincular.
 */
export function portalIdentityConflict({
  memberNumber = '',
  memberEmail = '',
  memberDocument = '',
  accountEmail = '',
  accountDocument = '',
  emailOwnerNumber = '',
  documentOwnerNumber = '',
} = {}) {
  const digits = (value) => String(value || '').replace(/\D/g, '');
  const mail = (value) => String(value || '').trim().toLowerCase();
  const memberDni = digits(memberDocument);
  const accountDni = digits(accountDocument);
  const fichaMail = mail(memberEmail);
  const loginMail = mail(accountEmail);
  const number = String(memberNumber || '').trim();

  if (memberDni && accountDni && memberDni !== accountDni) {
    return 'Conflicto de identidad: el DNI no es el de la ficha.';
  }
  if (fichaMail && loginMail && fichaMail !== loginMail) {
    return 'Conflicto de identidad: el correo no es el de la ficha.';
  }
  if (emailOwnerNumber && number && String(emailOwnerNumber) !== number) {
    return `Conflicto de identidad: el correo pertenece a otra ficha (${emailOwnerNumber}).`;
  }
  if (documentOwnerNumber && number && String(documentOwnerNumber) !== number) {
    return `Conflicto de identidad: el DNI pertenece a otra ficha (${documentOwnerNumber}).`;
  }
  return '';
}
