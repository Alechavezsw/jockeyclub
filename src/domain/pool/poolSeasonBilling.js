/**
 * Canon de pileta por temporada (dic–mar): $ / persona del hogar,
 * hasta N personas pagan; menores de `freeUnderAgeYears` no pagan.
 */

import { ageYearsOn } from '../members/memberStats';
import {
  familyPrincipalOf,
  isFamilyDependent,
  listHouseholdIntegrantes,
  memberNumberOf,
} from '../members/households';
import { poolSeasonWindow } from './poolSeason';

/** Defaults locales para no importar poolAccess (evita ciclo). */
const BILLING_DEFAULTS = {
  memberSeasonFee: 90000,
  maxPayingPerHousehold: 4,
  freeUnderAgeYears: 4,
};

function billingCfg(settings = {}) {
  const raw = settings && typeof settings === 'object' ? settings : {};
  const season = raw.memberSeasonFee != null
    ? Number(raw.memberSeasonFee)
    : (raw.memberDayFee != null ? Number(raw.memberDayFee) : BILLING_DEFAULTS.memberSeasonFee);
  return {
    memberSeasonFee: Math.max(0, Number.isFinite(season) ? season : BILLING_DEFAULTS.memberSeasonFee),
    maxPayingPerHousehold: Math.max(
      0,
      Number(raw.maxPayingPerHousehold ?? BILLING_DEFAULTS.maxPayingPerHousehold) || 0,
    ),
    freeUnderAgeYears: Math.max(
      0,
      Number(raw.freeUnderAgeYears ?? BILLING_DEFAULTS.freeUnderAgeYears) || 0,
    ),
  };
}

export function poolSeasonKey(today) {
  const win = poolSeasonWindow(today);
  return `${win.open}:${win.close}`;
}

/** Titular + integrantes del padrón (o el socio solo si es individual). */
export function listPoolSeasonHousehold(member, members = []) {
  if (!member) return [];
  const list = Array.isArray(members) ? members : [];
  const selfId = memberNumberOf(member);
  const principalId = isFamilyDependent(member)
    ? (familyPrincipalOf(member) || selfId)
    : selfId;
  if (!principalId) return [member];

  const byId = new Map();
  for (const row of list) {
    const id = memberNumberOf(row);
    if (id) byId.set(id, row);
  }

  const titular = byId.get(principalId)
    || (!isFamilyDependent(member) ? member : null)
    || member;
  const extras = listHouseholdIntegrantes(list, principalId);
  const out = [];
  const seen = new Set();
  for (const row of [titular, ...extras]) {
    const id = memberNumberOf(row) || String(row?.memberId || '');
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(row);
  }
  if (!out.length) out.push(member);
  return out;
}

function payerSortKey(person, principalId) {
  const id = memberNumberOf(person) || '';
  const isTitular = id && id === String(principalId || '');
  // Titular primero; después mayores primero (si hay edad); luego Nº.
  const age = ageYearsOn(person?.birthDate || person?.birth_date);
  const ageRank = age == null ? 0 : age;
  return [
    isTitular ? 0 : 1,
    -ageRank,
    id,
  ];
}

/**
 * Cotización del hogar para la temporada vigente.
 * @returns {{ people: Array, payingCount: number, freeCount: number, total: number, feePerPerson: number, maxPaying: number, seasonKey: string, open: string, close: string }}
 */
export function quoteHouseholdPoolSeason(member, {
  today = new Date(),
  settings = {},
  members = [],
  accesses = [],
} = {}) {
  const cfg = billingCfg(settings);
  const fee = cfg.memberSeasonFee;
  const maxPaying = cfg.maxPayingPerHousehold;
  const freeUnder = cfg.freeUnderAgeYears;
  const win = poolSeasonWindow(today);
  const seasonKey = `${win.open}:${win.close}`;
  const household = listPoolSeasonHousehold(member, members);
  const principalId = memberNumberOf(
    household.find((p) => !isFamilyDependent(p)) || household[0],
  ) || familyPrincipalOf(member) || memberNumberOf(member);

  const ranked = [...household].toSorted((a, b) => {
    const ka = payerSortKey(a, principalId);
    const kb = payerSortKey(b, principalId);
    for (let i = 0; i < ka.length; i += 1) {
      if (ka[i] < kb[i]) return -1;
      if (ka[i] > kb[i]) return 1;
    }
    return 0;
  });

  let payingSlots = 0;
  const people = ranked.map((person) => {
    const id = memberNumberOf(person) || String(person.memberId || '');
    const age = ageYearsOn(person?.birthDate || person?.birth_date, today);
    const alreadyPaid = memberHasPoolSeasonPass(accesses, id, today, cfg);
    let amount = fee;
    let reason = 'paga temporada';
    let pays = true;

    if (age != null && age < freeUnder) {
      amount = 0;
      pays = false;
      reason = `Menor de ${freeUnder} años · sin cargo`;
    } else if (payingSlots >= maxPaying) {
      amount = 0;
      pays = false;
      reason = `Tope ${maxPaying} personas por grupo · sin cargo`;
    } else {
      payingSlots += 1;
      if (alreadyPaid) {
        amount = 0;
        reason = 'Temporada ya abonada';
      }
    }

    return {
      memberId: id,
      name: person.name || person.full_name || '',
      birthDate: person.birthDate || person.birth_date || '',
      age,
      amount,
      pays,
      reason,
      alreadyPaid,
      isTitular: id === String(principalId || ''),
    };
  });

  const total = people.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
  return {
    people,
    payingCount: people.filter((p) => p.pays).length,
    freeCount: people.filter((p) => !p.pays).length,
    total,
    feePerPerson: fee,
    maxPaying,
    freeUnderAgeYears: freeUnder,
    seasonKey,
    open: win.open,
    close: win.close,
    live: win.live,
  };
}

/** Importe a cobrar hoy por una persona (0 si exenta, tope o ya pagó la temporada). */
export function quotePersonPoolSeason(member, opts = {}) {
  const quote = quoteHouseholdPoolSeason(member, opts);
  const id = memberNumberOf(member) || String(member?.memberId || '');
  const row = quote.people.find((p) => String(p.memberId) === String(id));
  return row || {
    memberId: id,
    name: member?.name || '',
    amount: billingCfg(opts.settings).memberSeasonFee,
    pays: true,
    reason: 'paga temporada',
    alreadyPaid: false,
  };
}

/**
 * Check if member has a valid pool season pass.
 * IMPORTANT: This explicitly excludes free attendance records ($0 payments).
 * A season pass requires either:
 * - payment.scope === 'season'
 * - concept containing 'temporada' AND amount > 0
 * - amount >= 95% of season fee
 * 
 * Free attendance (source: 'attendance', amount: 0) is NOT a season pass.
 */
export function memberHasPoolSeasonPass(accesses = [], memberId, today, settings = {}) {
  const id = String(memberId || '').replace(/\D/g, '') || String(memberId || '');
  if (!id) return false;
  const win = poolSeasonWindow(today);
  const fee = billingCfg(settings).memberSeasonFee;
  
  return (accesses || []).some((row) => {
    if (row?.status === 'revoked') return false;
    if (row?.kind && row.kind !== 'member') return false;
    
    const mid = String(row?.memberId || '').replace(/\D/g, '') || String(row?.memberId || '');
    if (mid !== id) return false;
    
    const date = String(row?.date || '').slice(0, 10);
    if (!date || date < win.open || date > win.close) return false;
    
    // Exclude explicit attendance records (not payments)
    if (row?.source === 'attendance') return false;
    
    const pay = row?.payment || {};
    const amount = Number(pay.amount) || 0;
    
    // Explicit season scope with actual payment
    if (pay.scope === 'season' && amount > 0) return true;
    
    // Concept indicates season AND has actual payment
    if (/temporada/i.test(String(pay.concept || '')) && amount > 0) return true;
    
    // Amount is at least 95% of season fee (actual payment, not $0)
    if (fee > 0 && amount >= fee * 0.95) return true;
    
    return false;
  });
}
