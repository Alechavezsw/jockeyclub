/**
 * Altas y bajas del mes del período, agrupadas por categoría de cuota.
 * Informativo: los titulares del borrador siguen saliendo del padrón vivo.
 */

import { memberDuesTierIds } from '../members/dues';
import { getTierDisplayName } from '../members/tiers';
import { memberMoveKey, uniqueBajas } from '../members/membershipMoves';
import { memberCuotaCategoryNames } from './feePeriodLiquidation';

function fold(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function monthKeyOf(year, month) {
  return `${Number(year)}-${pad2(month)}`;
}

function inMonth(iso, monthKey) {
  return String(iso || '').slice(0, 7) === monthKey;
}

function emptyBucket() {
  return { altas: 0, bajas: 0, altaRows: [], bajaRows: [] };
}

function ensureBucket(map, key) {
  if (!map.has(key)) map.set(key, emptyBucket());
  return map.get(key);
}

function conceptKeys(concept) {
  const keys = new Set();
  const id = fold(concept?.id);
  const label = fold(concept?.label || concept?.name);
  if (id) keys.add(id);
  if (label) keys.add(label);
  return keys;
}

function memberCategoryKeys(member, catalog = []) {
  const keys = new Set();
  for (const id of memberDuesTierIds(member)) {
    const tid = fold(id);
    if (tid) keys.add(tid);
    const name = fold(getTierDisplayName(id, catalog));
    if (name && name !== '—') keys.add(name);
  }
  for (const name of memberCuotaCategoryNames(member, catalog)) {
    const key = fold(name);
    if (key) keys.add(key);
  }
  const tier = fold(member?.tier);
  if (tier) keys.add(tier);
  return keys;
}

function bump(map, memberKeys, kind, row) {
  if (!memberKeys.size) {
    const bucket = ensureBucket(map, '_sin_categoria');
    bucket[kind] += 1;
    bucket[kind === 'altas' ? 'altaRows' : 'bajaRows'].push(row);
    return;
  }
  const hit = new Set();
  for (const [conceptKey, bucket] of map) {
    if (conceptKey === '_sin_categoria') continue;
    if (![...memberKeys].some((k) => k === conceptKey || fold(conceptKey) === k)) continue;
    if (hit.has(conceptKey)) continue;
    hit.add(conceptKey);
    bucket[kind] += 1;
    bucket[kind === 'altas' ? 'altaRows' : 'bajaRows'].push(row);
  }
  if (!hit.size) {
    // Sin match a una fila del pack: igual cuenta en el total del mes.
    const bucket = ensureBucket(map, '_otras');
    bucket[kind] += 1;
    bucket[kind === 'altas' ? 'altaRows' : 'bajaRows'].push(row);
  }
}

/**
 * @returns {{
 *   monthKey: string,
 *   asOf: string,
 *   totalAltas: number,
 *   totalBajas: number,
 *   byConcept: Map<string, { altas: number, bajas: number, altaRows: object[], bajaRows: object[] }>,
 *   statsForConcept: (concept) => { altas: number, bajas: number },
 * }}
 */
export function feePeriodCategoryMoves({
  year,
  month,
  concepts = [],
  members = [],
  altas = [],
  bajas = [],
  asOf = '',
  periodTo = '',
  tierCatalog = [],
} = {}) {
  const monthKey = monthKeyOf(year, month);
  const byId = new Map();
  for (const member of members || []) {
    const key = memberMoveKey(member.memberId || member.id);
    if (key && !byId.has(key)) byId.set(key, member);
  }

  const byConcept = new Map();
  for (const concept of concepts || []) {
    for (const key of conceptKeys(concept)) {
      ensureBucket(byConcept, key);
    }
  }

  const knownAltaIds = new Set((altas || []).map((row) => memberMoveKey(row.memberId)).filter(Boolean));
  const mergedAltas = [...(altas || [])];
  for (const member of members || []) {
    const id = memberMoveKey(member.memberId || member.id);
    const join = String(member.joinDate || '').slice(0, 10);
    if (!id || !inMonth(join, monthKey) || knownAltaIds.has(id)) continue;
    knownAltaIds.add(id);
    mergedAltas.push({
      memberId: id,
      name: member.name,
      date: join,
      movimiento: periodTo && join > periodTo ? 'Alta en portal' : 'Alta en padrón',
    });
  }

  const seenAlta = new Set();
  for (const row of mergedAltas) {
    if (!inMonth(row.date, monthKey)) continue;
    const id = memberMoveKey(row.memberId);
    if (id && seenAlta.has(id)) continue;
    if (id) seenAlta.add(id);
    const member = byId.get(id);
    const keys = member ? memberCategoryKeys(member, tierCatalog) : new Set();
    bump(byConcept, keys, 'altas', {
      memberId: id,
      name: row.name || member?.name || id || '—',
      date: row.date,
    });
  }

  const bajaList = uniqueBajas(bajas || []);
  const seenBaja = new Set();
  for (const row of bajaList) {
    if (!inMonth(row.date, monthKey)) continue;
    const id = memberMoveKey(row.memberId);
    if (id && seenBaja.has(id)) continue;
    if (id) seenBaja.add(id);
    const member = byId.get(id);
    // Si ya no está en padrón, igual contamos la baja en categoría del movimiento si hay ficha.
    const keys = member ? memberCategoryKeys(member, tierCatalog) : new Set();
    bump(byConcept, keys, 'bajas', {
      memberId: id,
      name: row.name || member?.name || id || '—',
      date: row.date,
      motivo: row.motivo || row.kindLabel || '',
    });
  }

  // Bajas del padrón del mes que no vinieron en Societas.
  for (const member of members || []) {
    const id = memberMoveKey(member.memberId || member.id);
    const bajaFecha = String(member.bajaFecha || '').slice(0, 10);
    if (!id || !inMonth(bajaFecha, monthKey) || seenBaja.has(id)) continue;
    seenBaja.add(id);
    bump(byConcept, memberCategoryKeys(member, tierCatalog), 'bajas', {
      memberId: id,
      name: member.name || id,
      date: bajaFecha,
      motivo: member.bajaMotivo || 'Baja en padrón',
    });
  }

  const statsForConcept = (concept) => {
    let altasN = 0;
    let bajasN = 0;
    for (const key of conceptKeys(concept)) {
      const bucket = byConcept.get(key);
      if (!bucket) continue;
      altasN = Math.max(altasN, bucket.altas);
      bajasN = Math.max(bajasN, bucket.bajas);
    }
    return { altas: altasN, bajas: bajasN };
  };

  let totalAltas = seenAlta.size;
  let totalBajas = seenBaja.size;
  // Si no hubo ids, aproximar por filas contadas.
  if (!totalAltas) {
    totalAltas = [...byConcept.values()].reduce((sum, b) => sum + b.altas, 0);
  }
  if (!totalBajas) {
    totalBajas = [...byConcept.values()].reduce((sum, b) => sum + b.bajas, 0);
  }

  return {
    monthKey,
    asOf,
    totalAltas,
    totalBajas,
    byConcept,
    statsForConcept,
  };
}
