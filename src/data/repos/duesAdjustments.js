import { unwrap } from '../errors';
import { sb } from './shared.js';
import { duesPeriodAdjustmentFromRow } from '../../domain/members/duesPeriodAdjustments.js';

const COLUMNS = 'id, member_id, member_number, due_on, action, capital, previous_capital_open, reason, created_by, created_by_name, created_at, voided_at, voided_by_name, void_reason, applied_payment_ids';

/** Ajustes administrativos por período del socio (vigentes y anulados, para la auditoría). */
export async function listDuesPeriodAdjustments(memberDbId) {
  if (!memberDbId) return [];
  const rows = await unwrap(
    sb()
      .from('dues_period_adjustments')
      .select(COLUMNS)
      .eq('member_id', memberDbId)
      .order('due_on', { ascending: true })
      .order('created_at', { ascending: true }),
    'No se pudieron leer los ajustes de cuota',
  );
  return (rows || []).map(duesPeriodAdjustmentFromRow).filter(Boolean);
}

/**
 * Corrige un mes (solo administrador). `action`: 'set' (debe ese capital) o 'remove' (no se debe).
 * La base guarda quién lo hizo, cuándo, el capital anterior y el motivo.
 */
export async function ajustarCuotaPeriodo({ memberDbId, dueOn, action, capital = null, reason }) {
  const row = await unwrap(
    sb().rpc('ajustar_cuota_periodo', {
      p_member_id: memberDbId,
      p_due_on: String(dueOn || '').slice(0, 10),
      p_action: action,
      p_capital: action === 'set' ? Number(capital) || 0 : null,
      p_reason: String(reason || '').trim(),
    }),
    'No se pudo guardar el ajuste de cuota',
  );
  return duesPeriodAdjustmentFromRow(row);
}

/** Anula un ajuste todavía no cobrado (solo administrador). */
export async function anularAjusteCuotaPeriodo({ adjustmentId, reason }) {
  const row = await unwrap(
    sb().rpc('anular_ajuste_cuota_periodo', {
      p_adjustment_id: adjustmentId,
      p_reason: String(reason || '').trim(),
    }),
    'No se pudo anular el ajuste de cuota',
  );
  return duesPeriodAdjustmentFromRow(row);
}
