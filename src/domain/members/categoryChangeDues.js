/**
 * Recálculo de cuotas pendientes al cambiar categoría.
 * No toca pagos ni recibos: solo propone un ajuste de capital abierto.
 */

import { money } from '../money';
import { getTierDisplayName } from './tiers';
import {
  collectionPeriodChoices,
  duesAmountForMember,
  isDuesExemptMember,
} from './dues';
import { duesMonthLabel } from './duesImputations';
import { isFamilyDependent } from './households';

function emptyPreview(member, fromTier, toTier, reason = '') {
  return {
    memberId: member?.memberId || null,
    fromTier: fromTier || '',
    toTier: toTier || '',
    fromLabel: getTierDisplayName(fromTier),
    toLabel: getTierDisplayName(toTier),
    periods: [],
    oldBalance: money(Math.max(0, Number(member?.outstandingBalance) || 0)),
    newBalance: money(Math.max(0, Number(member?.outstandingBalance) || 0)),
    totalDelta: 0,
    needsAdjustment: false,
    blocked: Boolean(reason),
    blockReason: reason || '',
  };
}

/**
 * Vista previa del impacto sobre cuotas sociales pendientes.
 * Los meses ya pagos (periodDueOns / imputaciones) no se tocan.
 */
export function previewCategoryChangeDues(member, newTier, { today = new Date() } = {}) {
  const fromTier = String(member?.tier || '').trim();
  const toTier = String(newTier || '').trim();
  if (!member || !toTier || toTier === fromTier) {
    return emptyPreview(member, fromTier, toTier);
  }
  if (isFamilyDependent(member)) {
    return emptyPreview(member, fromTier, toTier, 'El integrante no lleva la cuota social: el ajuste va en el titular.');
  }

  const before = { ...member, tier: fromTier };
  const after = { ...member, tier: toTier };
  if (isDuesExemptMember(after) || isDuesExemptMember(before)) {
    return emptyPreview(
      member,
      fromTier,
      toTier,
      'La exención de cuota se gestiona aparte (superadmin con motivo).',
    );
  }

  const oldBalance = money(Math.max(0, Number(member?.outstandingBalance) || 0));
  // Reconstruir meses abiertos con la categoría anterior (la que generó el capital).
  const open = collectionPeriodChoices(before, today, { chargeScope: 'social' });
  const periods = [];
  for (const row of open) {
    const dueOn = String(row?.dueOn || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueOn)) continue;
    const fullOld = money(duesAmountForMember(before, dueOn, { chargeScope: 'social' }));
    const fullNew = money(duesAmountForMember(after, dueOn, { chargeScope: 'social' }));
    const pendingOld = money(Math.max(0, Number(row.capital) || 0));
    if (!(pendingOld > 0.01) && !(fullOld > 0.01)) continue;
    let pendingNew = fullNew;
    if (fullOld > 0.01 && pendingOld + 0.01 < fullOld) {
      // Cuota parcial: conservar la fracción impaga.
      pendingNew = money(fullNew * (pendingOld / fullOld));
    }
    const delta = money(pendingNew - pendingOld);
    periods.push({
      dueOn,
      label: duesMonthLabel(dueOn) || row.label || dueOn,
      oldCapital: pendingOld,
      newCapital: pendingNew,
      delta,
    });
  }

  const totalDelta = money(periods.reduce((sum, row) => sum + row.delta, 0));
  const newBalance = money(Math.max(0, oldBalance + totalDelta));
  return {
    memberId: member.memberId || null,
    fromTier,
    toTier,
    fromLabel: getTierDisplayName(fromTier),
    toLabel: getTierDisplayName(toTier),
    periods,
    oldBalance,
    newBalance,
    totalDelta,
    needsAdjustment: Math.abs(totalDelta) > 0.01,
    blocked: false,
    blockReason: '',
  };
}

/** Clave idempotente del ajuste de categoría. */
export function categoryChangeIdempotencyKey(memberDbId, fromTier, toTier, periods = []) {
  const dues = (periods || []).map((row) => String(row.dueOn || '').slice(0, 10)).filter(Boolean).join(',');
  return `categoria:${memberDbId}:${fromTier}->${toTier}:${dues || 'sin-periodos'}`;
}

/**
 * Detecta titulares activos cuya deuda abierta no cierra con la tarifa de su categoría actual.
 * No modifica nada: solo informe.
 */
export function findCategoryDuesMismatches(members = [], { today = new Date() } = {}) {
  const out = [];
  for (const member of members || []) {
    if (!member || isFamilyDependent(member) || isDuesExemptMember(member)) continue;
    const balance = money(Math.max(0, Number(member.outstandingBalance) || 0));
    if (!(balance > 0.01)) continue;
    const atCurrent = collectionPeriodChoices(member, today, { chargeScope: 'social' });
    const priced = atCurrent.map((row) => {
      const full = money(duesAmountForMember(member, row.dueOn, { chargeScope: 'social' }));
      return { ...row, fullCapital: full };
    });
    const openCapital = money(priced.reduce((sum, row) => sum + (Number(row.capital) || 0), 0));
    const monthly = money(duesAmountForMember(member, today, { chargeScope: 'social' }));
    if (!(monthly > 0.01)) continue;
    const monthsAtCurrent = Math.round(balance / monthly);
    const residual = money(balance - monthsAtCurrent * monthly);
    const looksPartialOrWrong = Math.abs(residual) > 1
      || (atCurrent.length === 0 && balance > 0.01)
      || (openCapital + 0.01 < balance && Math.abs(balance - openCapital) > 1);

    if (!looksPartialOrWrong) continue;

    // ¿El saldo encaja exactamente con otra categoría social típica?
    const candidates = ['socio_individual', 'socio_familiar', 'socio_individual_amet', 'socio_familiar_amet'];
    let suggested = null;
    for (const tier of candidates) {
      if (tier === member.tier) continue;
      const altMonthly = money(duesAmountForMember({ ...member, tier }, today, { chargeScope: 'social' }));
      if (!(altMonthly > 0.01)) continue;
      const n = Math.round(balance / altMonthly);
      if (n >= 1 && Math.abs(balance - n * altMonthly) <= 1) {
        suggested = {
          fromTier: tier,
          fromLabel: getTierDisplayName(tier),
          months: n,
          expectedAtCurrent: money(n * monthly),
          deltaToFix: money(n * monthly - balance),
        };
        break;
      }
    }

    out.push({
      memberId: member.memberId,
      name: member.name,
      tier: member.tier,
      tierLabel: getTierDisplayName(member.tier),
      balance,
      monthlyAtCurrent: monthly,
      openPeriods: priced.map((row) => ({
        dueOn: row.dueOn,
        label: duesMonthLabel(row.dueOn) || row.label,
        capital: money(row.capital),
        fullCapital: row.fullCapital,
      })),
      suggested,
    });
  }
  return out;
}
