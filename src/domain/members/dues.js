/** Clasificación de cuotas sociales: vencidas vs próximas a vencer. */

import { getTierMonthlyDues } from './tiers';

const DAY_MS = 86400000;

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
    .filter((m) => m.status !== 'inactive')
    .filter((m) => {
      if ((Number(m.outstandingBalance) || 0) > 0) return true;
      const due = parseDate(m.nextDueDate);
      return due && due < todayStart;
    })
    .map((m) => {
      const balance = Number(m.outstandingBalance) || 0;
      const due = parseDate(m.nextDueDate);
      const since = parseDate(m.overdueSince);
      const anchor = (due && due < todayStart) ? due : (since && since < todayStart ? since : null);
      const daysOverdue = anchor
        ? Math.max(0, Math.floor((todayStart - anchor) / DAY_MS))
        : null;

      return {
        ...m,
        duesStatus: 'overdue',
        daysOverdue,
        dueDate: m.nextDueDate || m.overdueSince || null,
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
    .filter((m) => m.status !== 'inactive')
    .filter((m) => (Number(m.outstandingBalance) || 0) === 0)
    .map((m) => {
      const due = parseDate(m.nextDueDate);
      if (!due) return null;
      if (due < todayStart || due > horizon) return null;
      const daysUntil = Math.round((due - todayStart) / DAY_MS);
      return {
        ...m,
        duesStatus: 'upcoming',
        daysUntil,
        dueDate: m.nextDueDate || toISODate(due),
        amountDue: duesAmountForMember(m),
        nextDueDate: m.nextDueDate || toISODate(due),
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

/**
 * Genera la deuda de cuota automáticamente al vencer.
 * Si nextDueDate ya pasó y el socio no tiene saldo, carga el monto de su categoría.
 * No vuelve a sumar si ya hay outstandingBalance (evita doble cargo).
 */
export function applyAutomaticDues(members, today = new Date()) {
  const todayStart = startOfDay(today);

  return members.map((m) => {
    if (m.status === 'inactive' || m.status === 'suspended') return m;
    if ((Number(m.outstandingBalance) || 0) > 0) return m;

    const due = parseDate(m.nextDueDate);
    if (!due || due >= todayStart) return m;

    return {
      ...m,
      outstandingBalance: duesAmountForMember(m),
      overdueSince: m.overdueSince || toISODate(due),
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
    );
  });
}

/** Tras cobrar, deja al día y programa el próximo vencimiento (+1 mes). */
export function afterCollectDues(member, today = new Date()) {
  const base = parseDate(member.nextDueDate) || new Date(today);
  const next = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 12, 0, 0, 0);
  next.setMonth(next.getMonth() + 1);
  const todayStart = startOfDay(today);
  while (next <= todayStart) {
    next.setMonth(next.getMonth() + 1);
  }
  return {
    ...member,
    outstandingBalance: 0,
    overdueSince: null,
    nextDueDate: toISODate(next),
  };
}
