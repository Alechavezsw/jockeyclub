/** Clasificación de cuotas sociales: vencidas vs próximas a vencer. */

const DAY_MS = 86400000;

function parseDate(value) {
  if (!value) return null;
  const d = new Date(`${value}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toISODate(d) {
  return d.toISOString().slice(0, 10);
}

/** Monto de cuota según categoría (referencia operativa). */
export function duesAmountForTier(tier) {
  if (tier === 'royal') return 45000;
  if (tier === 'platinum') return 38000;
  return 32000;
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
 * Socios con cuota vencida: saldo pendiente > 0,
 * o fecha de vencimiento ya pasada.
 */
export function getOverdueMembers(members, today = new Date()) {
  const todayStart = new Date(today);
  todayStart.setHours(12, 0, 0, 0);

  return members
    .filter((m) => m.status !== 'inactive')
    .filter((m) => {
      if ((m.outstandingBalance || 0) > 0) return true;
      const due = parseDate(m.nextDueDate);
      return due && due < todayStart;
    })
    .map((m) => {
      const due = parseDate(m.nextDueDate) || parseDate(m.overdueSince);
      const daysOverdue = due
        ? Math.max(0, Math.floor((todayStart - due) / DAY_MS))
        : null;
      return {
        ...m,
        duesStatus: 'overdue',
        daysOverdue,
        dueDate: m.nextDueDate || m.overdueSince || null,
        amountDue: (m.outstandingBalance || 0) > 0
          ? m.outstandingBalance
          : duesAmountForMember(m),
      };
    })
    .sort((a, b) => (b.amountDue || 0) - (a.amountDue || 0));
}

/**
 * Socios al día cuya próxima cuota vence dentro de `withinDays` (default 15).
 */
export function getUpcomingDuesMembers(members, { withinDays = 15, today = new Date() } = {}) {
  const todayStart = new Date(today);
  todayStart.setHours(12, 0, 0, 0);
  const horizon = new Date(todayStart.getTime() + withinDays * DAY_MS);

  return members
    .filter((m) => m.status !== 'inactive')
    .filter((m) => (m.outstandingBalance || 0) === 0)
    .map((m) => {
      const due = parseDate(m.nextDueDate);
      if (!due) return null;
      if (due < todayStart || due > horizon) return null;
      const daysUntil = Math.ceil((due - todayStart) / DAY_MS);
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
  if (!d) return iso;
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * Genera la deuda de cuota automáticamente al vencer.
 * Si nextDueDate ya pasó y el socio no tiene saldo, carga el monto de su categoría.
 * No vuelve a sumar si ya hay outstandingBalance (evita doble cargo).
 */
export function applyAutomaticDues(members, today = new Date()) {
  const todayStart = new Date(today);
  todayStart.setHours(12, 0, 0, 0);

  return members.map((m) => {
    if (m.status === 'inactive' || m.status === 'suspended') return m;
    if ((m.outstandingBalance || 0) > 0) return m;

    const due = parseDate(m.nextDueDate);
    if (!due || due >= todayStart) return m;

    return {
      ...m,
      outstandingBalance: duesAmountForMember(m),
      overdueSince: m.overdueSince || toISODate(due),
    };
  });
}

/** Tras cobrar, deja al día y programa el próximo vencimiento (+1 mes). */
export function afterCollectDues(member, today = new Date()) {
  const base = parseDate(member.nextDueDate) || new Date(today);
  const next = new Date(base);
  next.setMonth(next.getMonth() + 1);
  const todayStart = new Date(today);
  todayStart.setHours(12, 0, 0, 0);
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
