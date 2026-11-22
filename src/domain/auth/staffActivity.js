/** Actividad operativa de un usuario del portal (actor), agrupada por día AR. */

const AR_TZ = 'America/Argentina/Buenos_Aires';

const ACTION_LABELS = {
  'profile.change': 'Cambió una ficha de usuario',
  'profile.create': 'Alta de usuario del portal',
  'profile.update': 'Actualizó un perfil',
  'profile.reset_password': 'Regeneró una contraseña',
  'profile_role.grant': 'Otorgó un rol',
  'profile_role.revoke': 'Revocó un rol',
  'profile_role.update': 'Actualizó un rol',
  'member.profile_update': 'Editó ficha de socio',
  'member.create': 'Alta de socio',
  'member.update': 'Actualizó socio',
  'member.baja': 'Dio de baja a un socio',
  'member.reactivate': 'Reactivó un socio',
  upsert: 'Sincronizó / guardó padrón',
  create: 'Creó un registro',
  update: 'Actualizó un registro',
  void: 'Anuló un movimiento',
  delete: 'Eliminó un registro',
  cobro: 'Registró un cobro',
  payment: 'Registró un pago',
  cash_open: 'Abrió caja',
  cash_close: 'Cerró / rindió caja',
  journal: 'Asiento contable',
  debit_move: 'Movimiento de débito',
  reservation: 'Reserva',
  access: 'Acceso / portería',
};

const ENTITY_LABELS = {
  members: 'Socio',
  member_payments: 'Cobro',
  journal_entries: 'Asiento',
  cash_sessions: 'Caja',
  cash_movements: 'Movimiento de caja',
  debit_move_events: 'Débito',
  reservations: 'Reserva',
  profiles: 'Usuario',
  profile_roles: 'Rol',
  access_logs: 'Acceso',
  fee_periods: 'Liquidación',
  mp_intents: 'Mercado Pago',
};

function dayKeyOf(iso) {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: AR_TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(iso));
  } catch {
    return String(iso).slice(0, 10);
  }
}

function dayLabelOf(dayKey) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) return dayKey || '—';
  const [y, m, d] = dayKey.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d, 15, 0, 0));
  return date.toLocaleDateString('es-AR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function staffActivityActionLabel(action, entityType) {
  const key = String(action || '');
  if (ACTION_LABELS[key]) return ACTION_LABELS[key];
  const entity = ENTITY_LABELS[entityType] || entityType || 'registro';
  if (key === 'upsert') return `Guardó ${entity}`;
  if (key) return `${key} · ${entity}`;
  return entity;
}

export function staffActivityEntityLabel(entityType) {
  return ENTITY_LABELS[entityType] || entityType || '—';
}

function isNoisyMemberUpsert(event) {
  const action = String(event?.action || '').toLowerCase();
  const entity = String(event?.entityType || event?.entity_type || '').toLowerCase();
  return action === 'upsert' && (entity === 'members' || entity === 'member');
}

function summarizePayload(event) {
  const p = event?.payload && typeof event.payload === 'object' ? event.payload : {};
  const bits = [];
  if (p.memberNumber || p.member_number) bits.push(`Nº ${p.memberNumber || p.member_number}`);
  if (p.fullName || p.full_name || p.memberName) bits.push(p.fullName || p.full_name || p.memberName);
  if (p.amount != null && p.amount !== '') {
    const n = Number(p.amount);
    if (Number.isFinite(n)) {
      bits.push(new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n));
    }
  }
  if (p.concept) bits.push(String(p.concept).slice(0, 80));
  if (p.role_key || p.roleKey) bits.push(p.role_key || p.roleKey);
  if (event?.entityId && !bits.length) bits.push(String(event.entityId).slice(0, 8));
  return bits.filter(Boolean).join(' · ');
}

/**
 * Normaliza eventos heterogéneos (audit + cobros + caja + asientos) a un feed común.
 */
export function normalizeStaffActivityEvent(raw = {}) {
  const createdAt = raw.createdAt || raw.created_at || raw.at || null;
  const action = String(raw.action || raw.kind || 'event');
  const entityType = String(raw.entityType || raw.entity_type || raw.source || '');
  return {
    id: String(raw.id || `${action}-${createdAt}-${Math.random().toString(36).slice(2, 8)}`),
    action,
    entityType,
    entityId: raw.entityId || raw.entity_id || raw.memberId || null,
    payload: raw.payload && typeof raw.payload === 'object' ? raw.payload : {
      amount: raw.amount,
      concept: raw.concept,
      memberNumber: raw.memberNumber,
      memberName: raw.memberName,
      fullName: raw.fullName,
    },
    createdAt,
    source: raw.source || 'audit',
    label: raw.label || staffActivityActionLabel(action, entityType),
    summary: raw.summary || summarizePayload(raw),
  };
}

/**
 * Agrupa por día (AR), colapsa upserts masivos de padrón y ordena desc.
 */
export function buildStaffActivityDays(events = []) {
  const normalized = (events || []).map(normalizeStaffActivityEvent)
    .filter((row) => row.createdAt)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

  const byDay = new Map();
  for (const event of normalized) {
    const key = dayKeyOf(event.createdAt);
    if (!key) continue;
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(event);
  }

  const days = [];
  for (const [dayKey, rows] of byDay) {
    const visible = [];
    let upsertCount = 0;
    for (const row of rows) {
      if (isNoisyMemberUpsert(row)) {
        upsertCount += 1;
        continue;
      }
      visible.push(row);
    }
    if (upsertCount > 0) {
      visible.push(normalizeStaffActivityEvent({
        id: `rollup-upsert-${dayKey}`,
        action: 'upsert',
        entityType: 'members',
        createdAt: `${dayKey}T12:00:00.000-03:00`,
        source: 'rollup',
        label: upsertCount === 1
          ? 'Sincronizó 1 ficha del padrón'
          : `Sincronizó ${upsertCount} fichas del padrón`,
        summary: 'Importaciones / guardados masivos agrupados',
        payload: { count: upsertCount },
      }));
    }

    const counts = {
      total: visible.length,
      cobros: 0,
      altas: 0,
      ediciones: 0,
      caja: 0,
      contabilidad: 0,
      otros: 0,
    };
    for (const row of visible) {
      const a = String(row.action || '').toLowerCase();
      const e = String(row.entityType || '').toLowerCase();
      if (a === 'cobro' || a === 'payment' || e === 'member_payments') counts.cobros += 1;
      else if (a.includes('create') && (e === 'members' || e === 'profiles')) counts.altas += 1;
      else if (a === 'cash_open' || a === 'cash_close' || e === 'cash_sessions' || e === 'cash_movements') counts.caja += 1;
      else if (a === 'journal' || e === 'journal_entries') counts.contabilidad += 1;
      else if (a.includes('update') || a.includes('change') || a === 'member.profile_update') counts.ediciones += 1;
      else counts.otros += 1;
    }

    days.push({
      dayKey,
      dayLabel: dayLabelOf(dayKey),
      counts,
      events: visible.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
    });
  }

  return days.sort((a, b) => String(b.dayKey).localeCompare(String(a.dayKey)));
}
