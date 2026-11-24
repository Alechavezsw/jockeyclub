/**
 * Tarifario Colonia por temporada (ARS). Versionado; no recalcula cargos históricos.
 */

import { COLONIA_PLAN_KEYS, COLONIA_SEASON_2026_2027 } from './coloniaConstants';

/** Tarifas oficiales publicadas 2026/2027 (seed). */
export const COLONIA_OFFICIAL_TARIFFS_2026_2027 = Object.freeze({
  inscription: 50000,
  socio: Object.freeze({
    [COLONIA_PLAN_KEYS.cuota]: 150000,
    [COLONIA_PLAN_KEYS.temporada]: 390000,
    [COLONIA_PLAN_KEYS.promo_2]: 280000,
    [COLONIA_PLAN_KEYS.promo_3]: 410000,
    [COLONIA_PLAN_KEYS.hermano_4]: 0,
  }),
  no_socio: Object.freeze({
    [COLONIA_PLAN_KEYS.cuota]: 180000,
    [COLONIA_PLAN_KEYS.temporada]: 490000,
    [COLONIA_PLAN_KEYS.promo_2]: 340000,
    [COLONIA_PLAN_KEYS.promo_3]: 500000,
    [COLONIA_PLAN_KEYS.hermano_4]: 0,
  }),
});

export const AMBIGUOUS_PROMO_PLANS = new Set([
  COLONIA_PLAN_KEYS.promo_2,
  COLONIA_PLAN_KEYS.promo_3,
]);

export function normalizeMemberKind(kind) {
  const key = String(kind || '').toLowerCase();
  if (key === 'socio' || key === 'member' || key === 'si') return 'socio';
  if (key === 'no_socio' || key === 'nosocio' || key === 'no' || key === 'externo') return 'no_socio';
  return null;
}

export function planAmountFor(tariffs, memberKind, planKey) {
  const kind = normalizeMemberKind(memberKind);
  const plan = String(planKey || '').toLowerCase();
  if (!kind || !plan) return null;
  const table = tariffs?.[kind] || tariffs?.[kind === 'socio' ? 'socio' : 'no_socio'];
  if (!table || table[plan] == null) return null;
  return Number(table[plan]);
}

export function inscriptionAmount(tariffs = COLONIA_OFFICIAL_TARIFFS_2026_2027) {
  return Number(tariffs?.inscription ?? COLONIA_OFFICIAL_TARIFFS_2026_2027.inscription) || 0;
}

/**
 * Evalúa si se puede confirmar un cargo promocional.
 * Hasta que Administración fije promotionPeriodicity, las promos quedan bloqueadas.
 */
export function evaluatePromotionCharge({
  planKey,
  season = COLONIA_SEASON_2026_2027,
  siblingCount = 0,
  memberKinds = [],
  stackWithTemporada = false,
} = {}) {
  const plan = String(planKey || '').toLowerCase();
  const errors = [];
  const warnings = [];

  if (AMBIGUOUS_PROMO_PLANS.has(plan)) {
    const periodicity = season?.promotionPeriodicity ?? null;
    if (!periodicity) {
      errors.push({
        code: 'promo_periodicity_undefined',
        message: 'La promoción por hermanos está publicada sin periodicidad (mensual o temporada). Configurá la regla antes de confirmar el cargo.',
      });
    }
    const need = plan === COLONIA_PLAN_KEYS.promo_2 ? 2 : 3;
    if (Number(siblingCount) < need) {
      errors.push({
        code: 'promo_sibling_count',
        message: `La promoción requiere al menos ${need} hermanos en el grupo de Colonia.`,
      });
    }
  }

  if (plan === COLONIA_PLAN_KEYS.hermano_4) {
    if (Number(siblingCount) < 4) {
      errors.push({
        code: 'fourth_sibling_count',
        message: 'El cuarto hermano solo aplica con 4 integrantes en el grupo.',
      });
    }
    warnings.push({
      code: 'fourth_sibling_inscription_only',
      message: 'Cuarto hermano: solo inscripción (plan $0). No inventar cuota adicional.',
    });
  }

  if (Number(siblingCount) >= 5 && (AMBIGUOUS_PROMO_PLANS.has(plan) || plan === COLONIA_PLAN_KEYS.hermano_4)) {
    errors.push({
      code: 'fifth_sibling_undefined',
      message: 'No hay tarifa publicada para el quinto hermano o posteriores.',
    });
  }

  const kinds = [...new Set((memberKinds || []).map(normalizeMemberKind).filter(Boolean))];
  if (kinds.length > 1) {
    errors.push({
      code: 'mixed_member_kinds',
      message: 'Hay hermanos con distinta condición de socio. Definí una política tarifaria explícita antes de confirmar.',
    });
  }

  if (stackWithTemporada && AMBIGUOUS_PROMO_PLANS.has(plan)) {
    errors.push({
      code: 'promo_stack_forbidden',
      message: 'No se acumulan promociones con temporada completa sin regla expresa.',
    });
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    planKey: plan,
    periodicity: season?.promotionPeriodicity ?? null,
  };
}

export function buildSeasonTariffRows(tariffs = COLONIA_OFFICIAL_TARIFFS_2026_2027) {
  const rows = [
    { concept: 'colonia_inscripcion', memberKind: 'any', planKey: 'inscripcion', amount: inscriptionAmount(tariffs) },
  ];
  for (const kind of ['socio', 'no_socio']) {
    for (const [planKey, amount] of Object.entries(tariffs[kind] || {})) {
      rows.push({
        concept: planKey === 'temporada' ? 'colonia_temporada'
          : planKey.startsWith('promo') || planKey === 'hermano_4' ? 'colonia_promocion'
            : 'colonia_cuota',
        memberKind: kind,
        planKey,
        amount: Number(amount) || 0,
      });
    }
  }
  return rows;
}
