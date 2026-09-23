/** Clasificación de cuotas sociales: vencidas vs próximas a vencer. */

import { getTierMonthlyDues } from './tiers';

const DAY_MS = 86400000;

/** Día de vencimiento de todas las cuotas sociales. */
export const DUES_DUE_DAY = 10;

function parseDate(value) {
  if (!value) return null;
  // Acepta YYYY-MM-DD o ISO completo
  const raw = String(value);
  const d = raw.includes('T') ? new Date(raw) : new Date(`${raw.slice(0, 10)}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(12, 0, 0, 0);
  return d;
}

function duesDateOnTenth(year, monthIndex) {
  return new Date(year, monthIndex, DUES_DUE_DAY, 12, 0, 0, 0);
}

function asDueAnchor(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return startOfDay(value);
  return parseDate(value) || startOfDay(new Date());
}

/** Fija cualquier fecha al día 10 de ese mes. */
export function pinDuesDueDate(value) {
  if (!value && !(value instanceof Date)) return null;
  const d = value instanceof Date ? startOfDay(value) : parseDate(value);
  if (!d) return null;
  return toISODate(duesDateOnTenth(d.getFullYear(), d.getMonth()));
}

function parseDueDate(value) {
  const pinned = pinDuesDueDate(value);
  return pinned ? parseDate(pinned) : null;
}

/**
 * Próximo vencimiento: el 10 de este mes, o el 10 del siguiente si ya pasó.
 */
export function nextDuesDueDate(from = new Date()) {
  const d = asDueAnchor(from);
  if (d.getDate() <= DUES_DUE_DAY) {
    return toISODate(duesDateOnTenth(d.getFullYear(), d.getMonth()));
  }
  return toISODate(duesDateOnTenth(d.getFullYear(), d.getMonth() + 1));
}

/**
 * Un pago cubre el mes en que se hizo. El próximo vencimiento es el 10 del mes siguiente.
 * Último pago 13/08 → cubre agosto → vence 10/09. El 21/09 ya hay 1 mes atrasado.
 */
export function firstUnpaidDuesDate({ lastPaymentDate, nextDueDate, today = new Date() } = {}) {
  const paid = parseDate(lastPaymentDate);
  if (paid) {
    return toISODate(duesDateOnTenth(paid.getFullYear(), paid.getMonth() + 1));
  }
  const pinned = pinDuesDueDate(nextDueDate);
  if (pinned) return pinned;
  return nextDuesDueDate(today);
}

/** Cuántos vencimientos del día 10 quedaron sin pagar desde el último cobro. */
export function monthsBehindOnDues({ lastPaymentDate, nextDueDate, today = new Date() } = {}) {
  const firstUnpaid = parseDate(firstUnpaidDuesDate({ lastPaymentDate, nextDueDate, today }));
  if (!firstUnpaid) return 0;
  const todayStart = startOfDay(today);
  let months = 0;
  let cursor = firstUnpaid;
  while (cursor < todayStart) {
    months += 1;
    cursor = duesDateOnTenth(cursor.getFullYear(), cursor.getMonth() + 1);
    if (months > 120) break;
  }
  return months;
}

export function formatMonthsBehind(months) {
  const n = Number(months) || 0;
  if (n <= 0) return null;
  return n === 1 ? '1 mes atrasado' : `${n} meses atrasados`;
}

/** Solo activos operan cuota / mora. Baja, suspensión y pendiente no generan ni figuran. */
export function isMemberBillingActive(member) {
  const s = String(member?.status || 'active').toLowerCase();
  return s === 'active';
}

/**
 * Texto de cuota para la ficha.
 * Baja / suspensión / pendiente no son «al día»: no facturan.
 */
export function quotaHeadline(member) {
  const status = String(member?.status || 'active').toLowerCase();
  const balance = Number(member?.outstandingBalance) || 0;
  const billing = isMemberBillingActive(member);

  if (balance > 0) {
    return {
      kind: 'debt',
      title: 'Saldo de cuota',
      hint: billing
        ? null
        : (status === 'inactive'
          ? 'Deuda previa · no se liquida más'
          : 'Deuda previa · cuota en pausa'),
      billing,
    };
  }

  if (status === 'inactive') {
    return {
      kind: 'off',
      title: 'Sin cuota',
      hint: 'No factura mientras esté de baja',
      billing: false,
    };
  }
  if (status === 'suspended') {
    return {
      kind: 'off',
      title: 'Cuota en pausa',
      hint: 'Cuenta suspendida · no se liquida',
      billing: false,
    };
  }
  if (status === 'pending') {
    return {
      kind: 'off',
      title: 'Sin liquidar',
      hint: 'El alta todavía no factura',
      billing: false,
    };
  }

  return { kind: 'clear', title: 'Al día', hint: null, billing: true };
}

/** Monto de cuota según categoría (catálogo editable / referencia operativa). */
export function duesAmountForTier(tier, catalog) {
  return getTierMonthlyDues(tier, catalog);
}

/**
 * Cuota del grupo familiar al alta: titular + cada adherente según su categoría.
 */
export function duesAmountForHousehold(titularTier, familyGroup = []) {
  const titular = duesAmountForTier(titularTier);
  const family = (familyGroup || []).reduce(
    (sum, row) => sum + duesAmountForTier(row?.tier || titularTier),
    0
  );
  return titular + family;
}

/** Cuota vigente del socio: titular + adherentes activos. */
export function duesAmountForMember(member) {
  const family = (member?.adherents || []).filter((a) => a && a.status !== 'inactive');
  return duesAmountForHousehold(member?.tier, family);
}

/**
 * Normaliza teléfono AR para wa.me (solo dígitos con código país).
 */
export function toWhatsAppPhone(phone) {
  let digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('54')) return digits;
  if (digits.startsWith('0')) digits = digits.slice(1);
  if (digits.length === 10) return `549${digits}`;
  if (digits.length === 11 && digits.startsWith('9')) return `54${digits}`;
  return digits;
}

/**
 * Socios con cuota vencida: saldo pendiente > 0,
 * o fecha de vencimiento ya pasada (aunque el saldo aún no se haya persistido).
 */
export function getOverdueMembers(members, today = new Date()) {
  const todayStart = startOfDay(today);

  return members
    .filter((m) => isMemberBillingActive(m))
    .filter((m) => {
      if ((Number(m.outstandingBalance) || 0) > 0) return true;
      const due = parseDueDate(m.nextDueDate);
      return due && due < todayStart;
    })
    .map((m) => {
      const balance = Number(m.outstandingBalance) || 0;
      const due = parseDueDate(m.nextDueDate);
      const since = parseDate(m.overdueSince);
      const anchor = (due && due < todayStart) ? due : (since && since < todayStart ? since : null);
      const daysOverdue = anchor
        ? Math.max(0, Math.floor((todayStart - anchor) / DAY_MS))
        : null;

      return {
        ...m,
        duesStatus: 'overdue',
        daysOverdue,
        dueDate: pinDuesDueDate(m.nextDueDate) || m.overdueSince || null,
        amountDue: balance > 0 ? balance : duesAmountForMember(m),
      };
    })
    .sort((a, b) => (b.amountDue || 0) - (a.amountDue || 0));
}

/**
 * Socios al día cuya próxima cuota vence dentro de `withinDays` (default 15).
 */
export function getUpcomingDuesMembers(members, { withinDays = 15, today = new Date() } = {}) {
  const todayStart = startOfDay(today);
  const horizon = new Date(todayStart.getTime() + withinDays * DAY_MS);

  return members
    .filter((m) => isMemberBillingActive(m))
    .filter((m) => (Number(m.outstandingBalance) || 0) === 0)
    .map((m) => {
      const due = parseDueDate(m.nextDueDate);
      if (!due) return null;
      if (due < todayStart || due > horizon) return null;
      const daysUntil = Math.round((due - todayStart) / DAY_MS);
      const dueIso = toISODate(due);
      return {
        ...m,
        duesStatus: 'upcoming',
        daysUntil,
        dueDate: dueIso,
        amountDue: duesAmountForMember(m),
        nextDueDate: dueIso,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.daysUntil - b.daysUntil);
}

export function formatShortDate(iso) {
  if (!iso) return '—';
  const d = parseDate(iso);
  if (!d) return String(iso);
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** Link de recordatorio de cuota por WhatsApp. Null si no hay teléfono válido. */
export function buildWhatsAppDuesUrl(member, formatCurrency) {
  const cleanPhone = toWhatsAppPhone(member?.phone);
  if (!cleanPhone) return null;
  const dueLabel = formatShortDate(member.dueDate || member.nextDueDate);
  const amount = typeof formatCurrency === 'function'
    ? formatCurrency(member.amountDue)
    : (member.amountDue ?? '');
  const name = member.name || 'socio/a';
  const msg = `Estimado/a ${name}, le saludamos del Jockey Club San Juan. Le recordamos que posee una cuota vencida de ${amount} (vencimiento ${dueLabel}). Puede regularizarla en administración o por transferencia. ¡Gracias!`;
  return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg)}`;
}

/**
 * Genera la deuda de cuota automáticamente al vencer.
 * Si nextDueDate ya pasó y el socio no tiene saldo, carga el monto de su categoría.
 * No vuelve a sumar si ya hay outstandingBalance (evita doble cargo).
 */
export function applyAutomaticDues(members, today = new Date()) {
  const todayStart = startOfDay(today);

  return members.map((m) => {
    const pinnedDue = pinDuesDueDate(m.nextDueDate);
    const normalized = pinnedDue && pinnedDue !== m.nextDueDate
      ? { ...m, nextDueDate: pinnedDue }
      : m;

    if (!isMemberBillingActive(normalized)) return normalized;
    if ((Number(normalized.outstandingBalance) || 0) > 0) return normalized;

    const due = parseDueDate(normalized.nextDueDate);
    if (!due || due >= todayStart) return normalized;

    return {
      ...normalized,
      outstandingBalance: duesAmountForMember(normalized),
      overdueSince: normalized.overdueSince || toISODate(due),
    };
  });
}

/** Socios cuyo saldo/fecha cambió tras applyAutomaticDues (para persistir en nube). */
export function diffAutomaticDues(before = [], after = []) {
  const prevById = new Map(before.map((m) => [m.memberId, m]));
  return after.filter((m) => {
    const prev = prevById.get(m.memberId);
    if (!prev) return false;
    return (
      Number(prev.outstandingBalance || 0) !== Number(m.outstandingBalance || 0)
      || (prev.overdueSince || null) !== (m.overdueSince || null)
      || (prev.nextDueDate || null) !== (m.nextDueDate || null)
    );
  });
}

/** Tras cobrar, deja al día y programa el próximo vencimiento (siempre el día 10). */
export function afterCollectDues(member, today = new Date()) {
  const base = parseDate(member.nextDueDate) || startOfDay(today);
  let next = duesDateOnTenth(base.getFullYear(), base.getMonth());
  if (next <= base) {
    next = duesDateOnTenth(base.getFullYear(), base.getMonth() + 1);
  }
  const todayStart = startOfDay(today);
  while (next <= todayStart) {
    next = duesDateOnTenth(next.getFullYear(), next.getMonth() + 1);
  }
  return {
    ...member,
    outstandingBalance: 0,
    overdueSince: null,
    nextDueDate: toISODate(next),
  };
}
