import * as M from '../mappers';
import { unwrap } from '../errors';
import { todayAR } from '../../lib/arDate';
import { isUuid, sb, audit } from './shared.js';

// ---- Access ----
export async function listAccessLogs({ limit = 500 } = {}) {
  const rows = await unwrap(
    sb()
      .from('access_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(Math.max(1, Number(limit) || 500)),
    'No se pudieron cargar accesos'
  );
  return (rows || []).map(M.accessLogFromRow);
}

/** Hora HH:MM:SS 24h — Postgres `time` rechaza formatos locales (`p. m.`, puntos, etc.). */
function toSqlTime(value) {
  if (typeof value === 'string') {
    const m = value.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (m) {
      const hh = String(Math.min(23, Number(m[1]))).padStart(2, '0');
      const mm = m[2];
      const ss = (m[3] || '00').padStart(2, '0');
      return `${hh}:${mm}:${ss}`;
    }
  }
  const d = value instanceof Date ? value : new Date();
  return d.toTimeString().slice(0, 8);
}

async function findRowByClientId(table, clientId) {
  if (!clientId) return null;
  const { data, error } = await sb()
    .from(table)
    .select('*')
    .eq('meta->>clientId', clientId)
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return data || null;
}

export async function insertAccessLog(log, memberDbId = null) {
  const clientId = log.id && !isUuid(log.id) ? String(log.id) : null;
  if (clientId) {
    const existing = await findRowByClientId('access_logs', clientId);
    if (existing) return M.accessLogFromRow(existing);
  }
  const row = {
    member_id: isUuid(memberDbId) ? memberDbId : null,
    member_number: log.memberId ? String(log.memberId) : null,
    member_name: log.memberName || null,
    role_label: log.role || null,
    status: log.status || 'granted',
    notes: log.notes || null,
    logged_on: log.date || todayAR(),
    logged_at: toSqlTime(log.time || new Date()),
    meta: {
      clientId,
      source: log.source || 'access_gate',
      group: log.group || '',
      activity: log.activity || '',
      ...(log.operator ? { operator: String(log.operator) } : {}),
    },
  };
  const saved = await unwrap(
    sb().from('access_logs').insert(row).select().single(),
    'No se pudo registrar acceso'
  );
  await audit('create', 'access_logs', saved.id, { status: row.status });
  return M.accessLogFromRow(saved);
}

export async function listPoolAccesses({ limit = 2000 } = {}) {
  const rows = await unwrap(
    sb()
      .from('pool_accesses')
      .select('*')
      .order('enabled_at', { ascending: false })
      .limit(Math.max(1, Number(limit) || 2000)),
    'No se pudieron cargar los ingresos de pileta'
  );
  return (rows || []).map(M.poolAccessFromRow);
}

export async function insertPoolAccess(entry, memberDbId = null) {
  const clientId = entry.id && !isUuid(entry.id) ? String(entry.id) : null;
  if (clientId) {
    const existing = await findRowByClientId('pool_accesses', clientId);
    if (existing) return M.poolAccessFromRow(existing);
  }
  const memberId = isUuid(memberDbId) ? memberDbId : (isUuid(entry?.memberDbId) ? entry.memberDbId : null);
  const row = {
    access_date: entry.date || todayAR(),
    kind: entry.kind === 'guest' ? 'guest' : 'member',
    member_id: memberId,
    member_number: entry.memberId ? String(entry.memberId) : null,
    member_name: entry.memberName || null,
    guest_name: entry.guestName || null,
    host_member_number: entry.hostMemberId ? String(entry.hostMemberId) : null,
    payment_amount: Number(entry.payment?.amount) || 0,
    payment_method: entry.payment?.method || null,
    payment_concept: entry.payment?.concept || null,
    medical_expires_at: entry.medicalExpiresAt || null,
    status: entry.status === 'revoked' ? 'revoked' : 'active',
    source: entry.source || null,
    enabled_by: entry.enabledBy || null,
    enabled_at: entry.enabledAt || new Date().toISOString(),
    journal_entry_id: isUuid(entry.journalEntryId) ? entry.journalEntryId : null,
    cash_movement_id: isUuid(entry.cashMovementId) ? entry.cashMovementId : null,
    meta: {
      clientId: clientId || undefined,
    },
  };
  const saved = await unwrap(
    sb().from('pool_accesses').insert(row).select().single(),
    'No se pudo guardar el ingreso de pileta'
  );
  return M.poolAccessFromRow(saved);
}

/** Canon de pileta: asiento en Caja General y movimiento de la caja abierta, a nombre de quien cobra. */
export async function recordPoolCanon({ amount, concept, memberDbId, date }) {
  const data = await unwrap(
    sb().rpc('record_pool_canon', {
      p_amount: Number(amount),
      p_concept: concept || 'Canon pileta',
      p_member_id: isUuid(memberDbId) ? memberDbId : null,
      p_date: date || todayAR(),
    }),
    'No se pudo registrar el canon de pileta',
  );
  return {
    journalEntry: { id: data?.journal_entry_id || null },
    movement: { id: data?.cash_movement_id || null },
    sessionId: data?.cash_session_id || null,
  };
}

/** Abre la Caja General una vez para el día. Si ya está abierta, no crea otra. */
export async function openPoolDayCash() {
  const data = await unwrap(
    sb().rpc('open_pool_day_cash'),
    'No se pudo abrir la caja del día',
  );
  return {
    id: data?.cash_session_id || null,
    cashRegisterId: data?.cash_register_id || null,
    status: 'open',
    openingBalance: Number(data?.opening_balance) || 0,
    openedAt: data?.opened_at || null,
    notes: 'Abierta al habilitar pileta',
    openedNow: Boolean(data?.opened),
  };
}

/**
 * ¿Hay una caja del día abierta? Lo responde la base: el operario de pileta y el empleado de
 * administración no pueden leer cash_sessions, así que no se puede deducir de las sesiones.
 */
export async function getPoolDayCashOpen() {
  const data = await unwrap(
    sb().rpc('is_pool_day_cash_open'),
    'No se pudo consultar la caja del día',
  );
  return data === true;
}

export async function revokePoolAccess(id) {
  if (!isUuid(id)) return null;
  const saved = await unwrap(
    sb()
      .from('pool_accesses')
      .update({ status: 'revoked', revoked_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single(),
    'No se pudo revocar el ingreso de pileta'
  );
  return M.poolAccessFromRow(saved);
}

export async function listGuestPasses() {
  const rows = await unwrap(
    sb().from('guest_passes').select('*').order('created_at', { ascending: false }),
    'No se pudieron cargar pases'
  );
  return (rows || []).map(M.guestPassFromRow);
}

/** Un pase por su id: el molinete lo pide si el que escaneó no está en la lista cargada al entrar. */
export async function getGuestPassById(passId) {
  const id = String(passId || '').trim();
  if (!id) return null;
  const row = await unwrap(
    sb().from('guest_passes').select('*').eq('id', id).maybeSingle(),
    'No se pudo cargar el pase'
  );
  return row ? M.guestPassFromRow(row) : null;
}

/**
 * ¿La firma del QR es la de este socio? El servidor contesta sí o no (y si el socio existe):
 * el secreto no viaja al navegador del portero. Ver la migración verify_member_credential.
 */
export async function verifyMemberCredential(memberNumber, token) {
  const { data, error } = await sb().rpc('verify_member_credential', {
    p_member_number: String(memberNumber),
    p_token: String(token),
  });
  if (error) {
    const failure = new Error(error.message || 'No se pudo verificar la credencial');
    failure.code = error.code;
    throw failure;
  }
  return { found: Boolean(data?.found), valid: Boolean(data?.valid) };
}

export async function upsertGuestPass(pass, hostDbId = null) {
  const row = {
    id: pass.id,
    host_member_id: hostDbId,
    host_member_number: pass.hostMemberId,
    host_name: pass.hostName || null,
    guest_name: pass.guestName,
    pass_date: pass.date,
    status: pass.status || 'active',
    payload: pass.payload,
    meta: {
      ...(pass.meta && typeof pass.meta === 'object' ? pass.meta : {}),
      ...(pass.token ? { token: pass.token } : {}),
    },
  };
  const saved = await unwrap(
    sb().from('guest_passes').upsert(row).select().single(),
    'No se pudo guardar pase'
  );
  return M.guestPassFromRow(saved);
}
