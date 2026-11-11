const ACTIVE = new Set(['authorized', 'approved']);

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

function stamp(row) {
  return String(row?.applied_at || row?.created_at || '');
}

/** Une cada adhesión con su último débito acreditado. */
export function buildSubscriptionRows(adhesions = [], charges = [], members = []) {
  const byId = new Map((members || []).map((row) => [row.id, row]));
  const lastCharge = new Map();
  for (const charge of charges || []) {
    const parent = charge?.meta?.from_subscription;
    if (!parent) continue;
    const prev = lastCharge.get(parent);
    if (!prev || stamp(charge) > stamp(prev)) lastCharge.set(parent, charge);
  }
  return (adhesions || []).map((row) => {
    const member = byId.get(row.member_id) || null;
    const charge = lastCharge.get(row.id) || null;
    return {
      id: row.id,
      memberId: row.member_id || null,
      memberNumber: member?.member_number || row.member_number || '',
      name: member?.full_name || '',
      email: row.payer_email || '',
      amount: Number(row.amount) || 0,
      status: row.status,
      statusLabel: subscriptionStatusLabel(row.status),
      active: subscriptionIsActive(row.status),
      since: row.applied_at || row.created_at || null,
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
    };
  }).sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    return String(b.since || '').localeCompare(String(a.since || ''));
  });
}
