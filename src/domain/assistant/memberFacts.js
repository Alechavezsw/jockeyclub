/**
 * Ficha explicada: lo que las reglas del club dicen de UN socio hoy.
 * Jev la usa para contestar «por qué no puede…» sin adivinar: son las mismas
 * funciones que usan la caja, la puerta y la pileta.
 */

import {
  duesChargeBreakdown,
  duesDueDayForMember,
  getOverdueMembers,
  isAmetDuesMember,
  isDuesExemptMember,
  isMemberBillingActive,
  monthsBehindOnDues,
  formatMonthsBehind,
  quotaHeadline,
} from '../members/dues';
import { familyPrincipalOf, isFamilyDependent, memberNumberOf } from '../members/households';
import { memberHasPortalAccess } from '../members/memberAdminActions';
import { getTierDisplayName } from '../members/tiers';
import { mergePoolSettings } from '../pool/poolAccess';
import { piletaPayAccess, seasonDuesGate } from '../pool/seasonDuesGate';

function fold(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function digitsOf(value) {
  return String(value || '').replace(/\D/g, '');
}

function asDay(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const raw = String(value || '').slice(0, 10);
  const d = new Date(`${raw}T12:00:00`);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

const STATUS_LABEL = {
  active: 'activa',
  suspended: 'suspendida',
  inactive: 'dada de baja',
  pending: 'pendiente de aprobación',
};

/** Palabras que dicen «hablo de un socio», para no confundir un año o un monto con un número de socio. */
const NUMBER_CUE = /\b(?:socio|socia|ficha|numero|n|nro|dni|documento|credencial|carnet)\b\D{0,4}(\d{3,9})/;

/**
 * Busca al socio del que habla la pregunta. Devuelve null si no hay uno solo claro:
 * mejor no contestar de un socio que contestar del equivocado.
 */
export function findMemberInQuery(query = '', members = []) {
  const text = fold(query);
  if (!text || !members?.length) return null;

  const cue = text.match(NUMBER_CUE);
  const lone = /^\d{3,9}$/.test(text) ? text : null;
  const wanted = cue?.[1] || lone;
  if (wanted) {
    const hits = members.filter((member) => (
      memberNumberOf(member) === wanted || digitsOf(member?.documentNumber) === wanted
    ));
    return hits.length === 1 ? hits[0] : null;
  }

  const tokens = new Set(text.split(' ').filter((token) => token.length >= 3));
  if (tokens.size < 2) return null;
  let best = null;
  let bestScore = 0;
  let tie = false;
  for (const member of members) {
    const nameTokens = fold(member?.name || member?.fullName).split(' ').filter((token) => token.length >= 3);
    if (nameTokens.length < 2) continue;
    const hits = nameTokens.filter((token) => tokens.has(token)).length;
    if (hits < 2 || hits < Math.min(2, nameTokens.length)) continue;
    if (hits > bestScore) {
      best = member;
      bestScore = hits;
      tie = false;
    } else if (hits === bestScore) {
      tie = true;
    }
  }
  return best && !tie ? best : null;
}

export function memberFacts(member, { today = new Date(), poolSettings = {}, members = [] } = {}) {
  if (!member) return null;
  const when = asDay(today);
  const settings = mergePoolSettings(poolSettings);
  const status = String(member.status || 'active').toLowerCase();
  const exempt = isDuesExemptMember(member);
  const dependent = isFamilyDependent(member);
  const amet = isAmetDuesMember(member);
  const billing = isMemberBillingActive(member) && !exempt && !dependent;
  const saldo = Number(member.outstandingBalance) || 0;
  const headline = quotaHeadline(member);

  const monthsBehind = billing
    ? monthsBehindOnDues({
      lastPaymentDate: member.lastPaymentDate,
      nextDueDate: member.nextDueDate,
      today: when,
      member,
    })
    : 0;
  const inMora = billing && getOverdueMembers([member], when).length > 0;
  const split = billing && (saldo > 0 || inMora)
    ? duesChargeBreakdown(member, { paidOn: when })
    : null;

  const gate = seasonDuesGate(member, { today: when, settings });
  const entryBlocked = status !== 'active' || gate.blocked;
  const entryReason = status !== 'active'
    ? `cuenta ${STATUS_LABEL[status] || status}`
    : (gate.blocked ? gate.reason : '');
  const pool = piletaPayAccess(member, { today: when, settings });

  let titularNumber = null;
  let titularName = null;
  if (dependent) {
    titularNumber = familyPrincipalOf(member);
    const titular = (members || []).find((row) => memberNumberOf(row) === titularNumber);
    titularName = titular?.name || null;
  }

  return {
    number: memberNumberOf(member),
    name: member.name || member.fullName || '',
    tier: getTierDisplayName(member.tier),
    status,
    statusLabel: STATUS_LABEL[status] || status,
    exempt,
    dependent,
    titularNumber,
    titularName,
    amet,
    dueDay: duesDueDayForMember(member),
    billing,
    quota: headline.title,
    quotaHint: headline.hint || '',
    saldo,
    monthsBehind,
    monthsBehindLabel: formatMonthsBehind(monthsBehind),
    inMora,
    nextDueDate: member.nextDueDate || null,
    charge: split
      ? { quota: split.quota, surcharge: split.surcharge, total: split.total }
      : null,
    canEnterToday: !entryBlocked,
    entryReason,
    inPoolSeason: gate.inSeason,
    canPayPool: pool.canPay,
    poolReason: pool.canPay ? '' : pool.detail,
    hasPortal: memberHasPortalAccess(member),
  };
}

function pesos(value) {
  return `$ ${Math.round(Number(value) || 0).toLocaleString('es-AR')}`;
}

/** Líneas para el prompt de Gemini. Sin DNI, teléfono ni domicilio. */
export function memberFactsForPrompt(facts) {
  if (!facts) return '';
  const lines = [
    `Socio Nº ${facts.number} · ${facts.name} · categoría ${facts.tier} · cuenta ${facts.statusLabel}.`,
    facts.dependent
      ? `Es ADHERENTE: la cuenta, el pago y las reservas son del titular${facts.titularNumber ? ` (Nº ${facts.titularNumber}${facts.titularName ? ` · ${facts.titularName}` : ''})` : ''}.`
      : 'Es titular: lleva su propia cuenta.',
  ];
  if (facts.exempt) {
    lines.push('Es EXENTO (vitalicio, fundador o comisión): no abona cuota, no entra en mora, no recibe avisos ni paga con Mercado Pago.');
  } else if (facts.billing) {
    lines.push(`Cuota: ${facts.quota}. Vence el día ${facts.dueDay}${facts.amet ? ' (AMET: sin recargo, el 2,5 % es tarifa)' : ''}.`);
    lines.push(facts.inMora
      ? `EN MORA${facts.monthsBehindLabel ? `: ${facts.monthsBehindLabel}` : ''}. Saldo en ficha ${pesos(facts.saldo)}.`
      : `No está en mora. Saldo en ficha ${pesos(facts.saldo)}.`);
    if (facts.charge) {
      lines.push(`A cobrar hoy: cuota ${pesos(facts.charge.quota)} + recargo ${pesos(facts.charge.surcharge)} = ${pesos(facts.charge.total)}.`);
    }
  } else if (!facts.dependent) {
    lines.push(`Cuota: ${facts.quota}${facts.quotaHint ? ` (${facts.quotaHint})` : ''}.`);
  }
  lines.push(facts.canEnterToday
    ? `Puerta hoy: puede ingresar${facts.saldo > 0 && !facts.exempt ? ' (con deuda, informada)' : ''}.`
    : `Puerta hoy: NO ingresa (${facts.entryReason}).`);
  lines.push(facts.canPayPool
    ? 'Pileta: puede pagar.'
    : `Pileta: NO puede pagar (${facts.poolReason}).`);
  lines.push(facts.hasPortal ? 'Tiene usuario del portal.' : 'Todavía no tiene usuario del portal.');
  return lines.join('\n');
}

/** Dictamen local (sin Gemini): las mismas reglas, dichas en corto. */
export function memberInsight(facts) {
  if (!facts) return null;
  const parts = [];
  parts.push(`${facts.name}, categoría ${facts.tier}, cuenta ${facts.statusLabel}.`);
  if (facts.dependent) {
    parts.push(`Es adherente: paga y reserva el titular${facts.titularNumber ? ` (Nº ${facts.titularNumber}${facts.titularName ? ` · ${facts.titularName}` : ''})` : ''}.`);
  } else if (facts.exempt) {
    parts.push('No abona cuota (vitalicio, fundador o comisión): no hay mora, ni avisos, ni Mercado Pago.');
  } else if (facts.billing) {
    parts.push(facts.inMora
      ? `Está en mora${facts.monthsBehindLabel ? ` (${facts.monthsBehindLabel})` : ''} y debe ${pesos(facts.saldo)}.`
      : `No está en mora. Saldo ${pesos(facts.saldo)}.`);
    parts.push(`Vence el día ${facts.dueDay}${facts.amet ? ' (AMET, sin recargo)' : ''}.`);
    if (facts.charge?.surcharge > 0) {
      parts.push(`Hoy se cobra ${pesos(facts.charge.quota)} de cuota más ${pesos(facts.charge.surcharge)} de recargo (total ${pesos(facts.charge.total)}).`);
    }
  } else {
    parts.push(`${facts.quota}${facts.quotaHint ? `: ${facts.quotaHint}` : ''}.`);
  }
  parts.push(facts.canEnterToday
    ? 'Hoy puede ingresar.'
    : `Hoy no ingresa: ${facts.entryReason}.`);
  parts.push(facts.canPayPool ? 'Puede pagar pileta.' : `No puede pagar pileta: ${facts.poolReason}.`);

  const verdict = facts.exempt
    ? `Nº ${facts.number} no abona cuota.`
    : facts.dependent
      ? `Nº ${facts.number} es adherente: su cuenta es del titular.`
      : facts.inMora
        ? `Nº ${facts.number} está en mora.`
        : facts.status !== 'active'
          ? `Nº ${facts.number} tiene la cuenta ${facts.statusLabel}.`
          : `Nº ${facts.number} está al día.`;

  return {
    verdict,
    text: parts.join(' '),
    figures: [
      { label: 'Saldo', value: pesos(facts.saldo) },
      facts.billing ? { label: 'Vence', value: `día ${facts.dueDay}` } : null,
      facts.monthsBehind > 0 ? { label: 'Atraso', value: facts.monthsBehindLabel } : null,
    ].filter(Boolean),
    next: facts.inMora
      ? 'Se regulariza cobrando en la ficha. Tesorería puede perdonar el recargo.'
      : null,
    go: 'members',
  };
}
