/** Descuentos y extras del socio (Accessin / LILA). */

import { readSnapshot } from '../../data/snapshots';

const EMPTY_MEMBER_DISCOUNTS_SEED = Object.freeze({
  ACCESSIN_MEMBER_DISCOUNTS: [],
  ACCESSIN_MEMBER_DISCOUNTS_AS_OF: '',
  ACCESSIN_MEMBER_DISCOUNTS_SNAPSHOT: {},
});

export function memberDiscountsSeed() {
  return readSnapshot('accessinMemberDiscounts', EMPTY_MEMBER_DISCOUNTS_SEED);
}

export const MEMBER_DISCOUNT_SCOPES = [
  { id: 'all', label: 'Todos' },
  { id: 'member', label: 'Socio' },
  { id: 'fee_category', label: 'Categoría de cuota' },
  { id: 'family', label: 'Grupo familiar' },
  { id: 'general', label: 'General' },
];

export function memberDiscountScopeLabel(id) {
  return MEMBER_DISCOUNT_SCOPES.find((s) => s.id === id)?.label || id || '—';
}

export function formatMemberDiscountValue(item) {
  if (!item) return '—';
  if (item.valueLabel) return item.valueLabel;
  if (item.valueType === 'percent') {
    return `${Number(item.value || 0).toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 2 })}%`;
  }
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 2,
  }).format(Number(item.value) || 0);
}

export function formatMemberDiscountRange(item) {
  const from = item?.validFrom || '';
  const to = item?.validTo || '';
  if (!from && !to) return 'Sin límite';
  const fmt = (iso) => {
    if (!iso) return '';
    const [y, m, d] = String(iso).split('-');
    if (!y || !m || !d) return iso;
    return `${Number(d)}/${m}/${y}`;
  };
  if (from && to) return `${fmt(from)} → ${fmt(to)}`;
  if (from) return `Desde ${fmt(from)}`;
  return `Hasta ${fmt(to)}`;
}

export function listMemberDiscounts({
  query = '',
  scope = 'all',
  status = 'all',
  items = memberDiscountsSeed().ACCESSIN_MEMBER_DISCOUNTS,
} = {}) {
  const q = String(query || '').trim().toLowerCase();
  const qDigits = String(query || '').replace(/\D/g, '');
  return (items || [])
    .filter((row) => {
      if (scope !== 'all' && row.scope !== scope) return false;
      if (status === 'active' && !row.isActive) return false;
      if (status === 'expired' && row.isActive) return false;
      if (!q && !qDigits) return true;
      const hay = [
        row.memberName,
        row.memberNumber,
        row.documentNumber,
        row.familyGroup,
        row.description,
        row.feeConcept,
        row.scopeLabel,
        row.kind,
        row.status,
      ].map((x) => String(x || '').toLowerCase()).join(' ');
      if (q && hay.includes(q)) return true;
      if (qDigits && String(row.memberNumber || '').includes(qDigits)) return true;
      if (qDigits && String(row.documentNumber || '').includes(qDigits)) return true;
      return false;
    })
    .toSorted((a, b) => Number(a.isActive === b.isActive ? 0 : a.isActive ? -1 : 1)
      || String(a.memberName).localeCompare(String(b.memberName), 'es'));
}

export function memberDiscountsSummary(
  snapshot = memberDiscountsSeed().ACCESSIN_MEMBER_DISCOUNTS_SNAPSHOT,
  items = memberDiscountsSeed().ACCESSIN_MEMBER_DISCOUNTS,
) {
  const list = items || [];
  const active = list.filter((x) => x.isActive);
  const expired = list.filter((x) => !x.isActive);
  const byScope = {};
  list.forEach((row) => {
    byScope[row.scope] = (byScope[row.scope] || 0) + 1;
  });
  return {
    asOf: snapshot?.asOf || '',
    asOfLabel: snapshot?.asOfLabel || snapshot?.asOf || '',
    sourceFile: snapshot?.sourceFile || '',
    count: snapshot?.count ?? list.length,
    activeCount: snapshot?.activeCount ?? active.length,
    expiredCount: snapshot?.expiredCount ?? expired.length,
    uniqueMembers: snapshot?.uniqueMembers ?? new Set(list.map((x) => x.memberNumber)).size,
    byScope,
  };
}
