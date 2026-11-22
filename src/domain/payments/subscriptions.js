const ACTIVE = new Set(['authorized', 'approved']);
const OPEN = new Set(['authorized', 'approved', 'pending', 'in_process']);

export function subscriptionStatusLabel(status) {
  const value = String(status || '').toLowerCase();
  if (ACTIVE.has(value)) return 'Activa';
  if (value === 'pending' || value === 'in_process') return 'Pendiente';
  if (value === 'cancelled' || value === 'paused') return 'Cancelada';
  if (value === 'rejected') return 'Rechazada';
  return value || '—';
}

export function subscriptionIsActive(status) {
  return ACTIVE.has(String(status || '').toLowerCase());
}

/** Una sola adhesión abierta por socio: activa o todavía en curso en MP. */
export function subscriptionBlocksNewAdhesion(status) {
  return OPEN.has(String(status || '').toLowerCase());
}

/**
 * Entre intents de kind=subscription, el que bloquea una nueva adhesión
 * (prioriza autorizada; si no, la pendiente más reciente).
 */
export function findBlockingSubscription(intents = []) {
  const open = (intents || []).filter((row) => (
    String(row?.kind || 'subscription') === 'subscription'
    && subscriptionBlocksNewAdhesion(row?.status)
  ));
  if (!open.length) return null;
  const active = open.find((row) => subscriptionIsActive(row.status));
  if (active) return active;
  return [...open].sort((a, b) => (
    String(b.created_at || b.createdAt || '').localeCompare(String(a.created_at || a.createdAt || ''))
  ))[0] || null;
}

function stamp(row) {
  return String(row?.applied_at || row?.created_at || '');
}

function memberKey(row) {
  const id = String(row?.member_id || '').trim();
  if (id) return `id:${id}`;
  const nro = String(row?.member_number || '').replace(/\D/g, '');
  if (nro) return `nro:${nro}`;
  return `row:${row?.id || ''}`;
}

function shortPreapproval(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.length <= 12) return raw;
  return `${raw.slice(0, 6)}…${raw.slice(-4)}`;
}

/**
 * Une cada adhesión con su último débito acreditado.
 * Por defecto oculta repeticiones: un socio = una fila (la más reciente).
 */
export function buildSubscriptionRows(adhesions = [], charges = [], members = [], {
  hideDuplicates = true,
} = {}) {
  const byId = new Map((members || []).map((row) => [row.id, row]));
  const lastCharge = new Map();
  const chargeStats = new Map();
  for (const charge of charges || []) {
    const parent = charge?.meta?.from_subscription;
    if (!parent) continue;
    const prev = lastCharge.get(parent);
    if (!prev || stamp(charge) > stamp(prev)) lastCharge.set(parent, charge);
    const stats = chargeStats.get(parent) || { total: 0, credited: 0 };
    stats.total += 1;
    if (subscriptionIsActive(charge.status)) stats.credited += 1;
    chargeStats.set(parent, stats);
  }

  const sorted = [...(adhesions || [])].sort((a, b) => stamp(b).localeCompare(stamp(a)));
  const seen = new Map();
  const built = [];

  for (const row of sorted) {
    const key = memberKey(row);
    const member = byId.get(row.member_id) || null;
    const charge = lastCharge.get(row.id) || null;
    const stats = chargeStats.get(row.id) || { total: 0, credited: 0 };
    const dupIndex = seen.has(key) ? seen.get(key) + 1 : 0;
    seen.set(key, dupIndex);

    built.push({
      id: row.id,
      memberId: row.member_id || member?.id || null,
      memberNumber: member?.member_number || row.member_number || '',
      name: member?.full_name || '',
      email: row.payer_email || member?.email || '',
      phone: member?.phone || '',
      tier: member?.tier || '',
      memberStatus: member?.status || '',
      outstandingBalance: Number(member?.outstanding_balance) || 0,
      amount: Number(row.amount) || 0,
      status: row.status,
      statusLabel: subscriptionStatusLabel(row.status),
      active: subscriptionIsActive(row.status),
      since: row.applied_at || row.created_at || null,
      preapprovalId: row.preapproval_id || '',
      preapprovalShort: shortPreapproval(row.preapproval_id),
      concept: row.concept || '',
      chargeCount: stats.total,
      creditedCount: stats.credited,
      duplicateOf: dupIndex > 0,
      duplicateRank: dupIndex,
      lastCharge: charge
        ? {
          id: charge.id,
          amount: Number(charge.amount) || 0,
          status: charge.status,
          statusLabel: subscriptionStatusLabel(charge.status),
          concept: charge.concept || '',
          at: charge.applied_at || charge.created_at || null,
          credited: subscriptionIsActive(charge.status),
        }
        : null,
    });
  }

  // Marca el canónico (más reciente) con cuántas repeticiones ocultas hay.
  const dupTotals = new Map();
  for (const row of built) {
    const key = memberKey({
      member_id: row.memberId,
      member_number: row.memberNumber,
      id: row.id,
    });
    dupTotals.set(key, (dupTotals.get(key) || 0) + 1);
  }
  for (const row of built) {
    const key = memberKey({
      member_id: row.memberId,
      member_number: row.memberNumber,
      id: row.id,
    });
    const total = dupTotals.get(key) || 1;
    row.duplicateTotal = total;
    row.hasDuplicates = total > 1;
  }

  const visible = hideDuplicates
    ? built.filter((row) => !row.duplicateOf)
    : built;

  return visible.sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    const pendingA = String(a.status || '').toLowerCase() === 'pending';
    const pendingB = String(b.status || '').toLowerCase() === 'pending';
    if (pendingA !== pendingB) return pendingA ? -1 : 1;
    return String(b.since || '').localeCompare(String(a.since || ''));
  });
}

export function summarizeSubscriptionRows(rows = []) {
  const list = rows || [];
  let active = 0;
  let pending = 0;
  let cancelled = 0;
  let monthlyActive = 0;
  let withCharges = 0;
  let duplicates = 0;
  for (const row of list) {
    if (row.active) {
      active += 1;
      monthlyActive += Number(row.amount) || 0;
    } else if (/pendiente/i.test(row.statusLabel)) {
      pending += 1;
    } else {
      cancelled += 1;
    }
    if ((row.chargeCount || 0) > 0) withCharges += 1;
    if (row.hasDuplicates) duplicates += 1;
  }
  return {
    total: list.length,
    active,
    pending,
    cancelled,
    monthlyActive,
    withCharges,
    duplicates,
  };
}
