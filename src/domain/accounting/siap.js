/** Padrón SIAP Accessin / LILA (identificación de ocupantes). */

import { readSnapshot } from '../../data/snapshots';

const EMPTY_SIAP_SEED = Object.freeze({
  ACCESSIN_SIAP: [],
  ACCESSIN_SIAP_AS_OF: '',
  ACCESSIN_SIAP_SNAPSHOT: {},
});

export function siapSeed() {
  return readSnapshot('accessinSiap', EMPTY_SIAP_SEED);
}

function fold(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

export function listSiapOccupants({
  query = '',
  items = siapSeed().ACCESSIN_SIAP,
} = {}) {
  const q = fold(query).trim();
  const qDigits = String(query || '').replace(/\D/g, '');
  return (items || []).filter((row) => {
    if (!q && !qDigits) return true;
    const hay = fold([
      row.occupantId,
      row.occupantName,
      row.documentNumber,
      row.documentType,
      row.memberName,
      row.memberDocumentNumber,
      row.memberFlag,
      row.cuit,
      row.locality,
      row.personType,
      row.entity,
      row.representativeName,
    ].join(' '));
    if (q && hay.includes(q)) return true;
    if (qDigits && hay.replace(/\D/g, '').includes(qDigits)) return true;
    return false;
  });
}

export function siapSummary(
  snapshot = siapSeed().ACCESSIN_SIAP_SNAPSHOT,
  items = siapSeed().ACCESSIN_SIAP,
) {
  const list = items || [];
  return {
    asOf: snapshot?.asOf || siapSeed().ACCESSIN_SIAP_AS_OF,
    asOfLabel: snapshot?.asOfLabel || snapshot?.asOf || '',
    fileName: snapshot?.fileName || '',
    generatedAt: snapshot?.generatedAt || '',
    count: snapshot?.count ?? list.length,
    withCuit: snapshot?.withCuit ?? list.filter((row) => String(row.cuit || '').replace(/\D/g, '').length >= 11).length,
    uniqueDocuments: snapshot?.uniqueDocuments ?? new Set(list.map((row) => row.documentNumber).filter(Boolean)).size,
    personTypes: snapshot?.personTypes || [...new Set(list.map((row) => row.personType).filter(Boolean))],
  };
}
