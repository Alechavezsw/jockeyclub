/** Etiqueta y antigüedad de la categoría de socio (padrón, no Gold/Platinum). */

export function prettyMembershipName(raw) {
  const name = String(raw || '').replace(/_/g, ' ').trim();
  if (!name) return 'Socio';
  return name.toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function yearsOnClub(member, today = new Date()) {
  const join = String(member?.joinDate || '').slice(0, 10);
  if (join) {
    const started = new Date(`${join}T12:00:00`);
    if (!Number.isNaN(started.getTime())) {
      let years = today.getFullYear() - started.getFullYear();
      if (today < new Date(today.getFullYear(), started.getMonth(), started.getDate())) years -= 1;
      return Math.max(0, years);
    }
  }
  return Math.max(0, Number(member?.yearsActive) || 0);
}

export function formatJoinYear(joinDate) {
  const join = String(joinDate || '').slice(0, 10);
  if (!join) return null;
  const started = new Date(`${join}T12:00:00`);
  if (Number.isNaN(started.getTime())) return null;
  return String(started.getFullYear());
}

export function membershipCaption(member, today = new Date()) {
  const years = yearsOnClub(member, today);
  if (years > 0) return `${years} año${years === 1 ? '' : 's'} en el club`;
  const since = formatJoinYear(member?.joinDate);
  if (since) return `Desde ${since}`;
  return 'Categoría de socio';
}
