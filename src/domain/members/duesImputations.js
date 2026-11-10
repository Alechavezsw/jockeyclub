import { money } from '../money';

/** Deuda anterior al detalle por mes. Se cobra primero y no inventa un vencimiento. */
export const OPENING_DUE_ON = '1900-01-10';

const MONTHS_ES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

export function imputationPeriodLabel(dueOn) {
  const iso = String(dueOn || '').slice(0, 10);
  if (!iso || iso <= OPENING_DUE_ON) return 'Saldo anterior';
  const month = Number(iso.slice(5, 7));
  const name = MONTHS_ES[month - 1] || iso;
  return `${name} ${iso.slice(0, 4)}`;
}

/** Mes en español para el recibo: «Noviembre de 2026». */
export function duesMonthLabel(dueOn) {
  const iso = String(dueOn || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || iso <= OPENING_DUE_ON) return '';
  const name = MONTHS_ES[Number(iso.slice(5, 7)) - 1];
  return name ? `${name} de ${iso.slice(0, 4)}` : '';
}

/** «Septiembre de 2026, Octubre de 2026 y Noviembre de 2026». */
export function duesMonthsPhrase(dueOns = []) {
  const labels = [];
  for (const dueOn of dueOns || []) {
    const label = duesMonthLabel(dueOn);
    if (label && !labels.includes(label)) labels.push(label);
  }
  if (labels.length <= 1) return labels[0] || '';
  if (labels.length === 2) return `${labels[0]} y ${labels[1]}`;
  return `${labels.slice(0, -1).join(', ')} y ${labels[labels.length - 1]}`;
}

export function imputationSummary(rows = []) {
  return (rows || [])
    .filter((row) => (Number(row.capital) || 0) > 0 || (Number(row.surcharge) || 0) > 0)
    .map((row) => imputationPeriodLabel(row.dueOn))
    .join(', ');
}

function byDue(a, b) {
  return String(a.dueOn).localeCompare(String(b.dueOn));
}

/**
 * Parte el saldo de capital entre los meses, del más viejo al más nuevo.
 * Lo que no entra en ningún mes queda como saldo anterior, sin recargo.
 */
export function openPeriodsFromChoices(choices = [], balance = 0) {
  let left = money(balance);
  if (!(left > 0)) return [];
  const rows = [];
  const sorted = [...(choices || [])].filter((row) => row?.dueOn).toSorted(byDue);
  for (const row of sorted) {
    if (!(left > 0.009)) break;
    const full = money(row.capital);
    if (!(full > 0)) continue;
    const capital = money(Math.min(full, left));
    const lateFull = money(row.lateBase != null ? row.lateBase : full);
    const lateBase = money(lateFull * (capital / full));
    rows.push({
      dueOn: String(row.dueOn).slice(0, 10),
      capital,
      lateBase,
    });
    left = money(left - capital);
  }
  if (left > 0.009) {
    rows.unshift({
      dueOn: OPENING_DUE_ON,
      capital: left,
      lateBase: 0,
    });
  }
  return rows.toSorted(byDue);
}

/**
 * Aplica un cobro del mes más viejo al más nuevo.
 * Primero entra la cuota. El 10 % no se descuenta de ese importe:
 * solo se suma si el mes ya venció y sobra plata después del capital.
 */
export function imputeDuesPayment(periods = [], cash, paidOn) {
  let left = money(cash);
  const paid = String(paidOn || '').slice(0, 10);
  const allocations = [];
  for (const period of [...(periods || [])].toSorted(byDue)) {
    if (!(left > 0.009)) break;
    const capitalOpen = money(period.capitalOpen ?? period.capital);
    const lateBase = money(period.lateBase);
    const overdue = paid > String(period.dueOn).slice(0, 10) && String(period.dueOn) > OPENING_DUE_ON;
    const surchargeOpen = overdue ? money(lateBase * 0.1) : 0;
    if (!(capitalOpen > 0) && !(surchargeOpen > 0)) continue;
    const capital = money(Math.min(left, Math.max(0, capitalOpen)));
    left = money(left - capital);
    const surcharge = money(Math.min(left, Math.max(0, surchargeOpen)));
    left = money(left - surcharge);
    if (!(capital > 0) && !(surcharge > 0)) continue;
    const nextCapital = money(Math.max(0, capitalOpen - capital));
    const nextLate = capitalOpen > 0 ? money((lateBase * nextCapital) / capitalOpen) : 0;
    const surchargeLeft = overdue ? money(nextLate * 0.1) : 0;
    allocations.push({
      dueOn: String(period.dueOn).slice(0, 10),
      capital,
      surcharge,
      capitalOpen: nextCapital,
      surchargeOpen: surchargeLeft,
      lateBase: nextLate,
      lateBaseTaken: money(lateBase - nextLate),
    });
  }
  return {
    allocations,
    capital: money(allocations.reduce((sum, row) => sum + row.capital, 0)),
    surcharge: money(allocations.reduce((sum, row) => sum + row.surcharge, 0)),
    unapplied: left,
  };
}

/** Primer vencimiento real que sigue con capital. */
export function nextOpenDue(periods = [], allocations = []) {
  const taken = new Map((allocations || []).map((row) => [String(row.dueOn).slice(0, 10), row]));
  for (const period of [...(periods || [])].toSorted(byDue)) {
    const dueOn = String(period.dueOn || '').slice(0, 10);
    if (!dueOn || dueOn <= OPENING_DUE_ON) continue;
    const hit = taken.get(dueOn);
    const open = hit ? money(hit.capitalOpen) : money(period.capitalOpen ?? period.capital);
    if (open > 0.009) return dueOn;
  }
  return null;
}
