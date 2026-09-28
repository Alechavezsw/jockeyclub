/** Bonificaciones aplicadas (Accessin / LILA). */

import { bonificacionesSeed } from './discountsSeed';

export function listBonificaciones({
  query = '',
  items = bonificacionesSeed().ACCESSIN_BONIFICACIONES,
} = {}) {
  const q = String(query || '').trim().toLowerCase();
  const qDigits = String(query || '').replace(/\D/g, '');
  return (items || [])
    .filter((row) => {
      if (!q && !qDigits) return true;
      const hay = [
        row.memberName,
        row.memberNumber,
        row.documentNumber,
        row.familyGroup,
        row.concept,
        row.reason,
        row.appliedBy,
      ].map((x) => String(x || '').toLowerCase()).join(' ');
      if (q && hay.includes(q)) return true;
      if (qDigits && String(row.memberNumber || '').includes(qDigits)) return true;
      if (qDigits && String(row.documentNumber || '').includes(qDigits)) return true;
      return false;
    })
    .toSorted((a, b) => String(b.date || '').localeCompare(String(a.date || ''))
      || String(a.memberName).localeCompare(String(b.memberName), 'es'));
}

export function bonificacionesSummary(
  snapshot = bonificacionesSeed().ACCESSIN_BONIFICACIONES_SNAPSHOT,
  items = bonificacionesSeed().ACCESSIN_BONIFICACIONES,
) {
  const list = items || [];
  const members = new Set(list.map((x) => x.memberNumber).filter(Boolean));
  const totalAmount = Math.round(list.reduce((s, x) => s + (Number(x.amount) || 0), 0) * 100) / 100;
  return {
    asOf: snapshot?.asOf || '',
    asOfLabel: snapshot?.asOfLabel || snapshot?.asOf || '',
    sourceFile: snapshot?.sourceFile || '',
    count: snapshot?.count ?? list.length,
    uniqueMembers: snapshot?.uniqueMembers ?? members.size,
    totalAmount: snapshot?.totalAmount ?? totalAmount,
  };
}

export function formatBonificacionDate(iso) {
  const key = String(iso || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return iso || '—';
  const [y, m, d] = key.split('-');
  return `${Number(d)}/${m}/${y}`;
}
