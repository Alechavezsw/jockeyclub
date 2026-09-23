import { getTierDisplayName } from '../members/tiers';
import { todayISODateAR } from '../../lib/arDate';

/** Entrada de historial de molinete / Control QR. */

export const ACCESS_ACTIVITIES = [
  'Ingreso sede',
  'Ingreso pileta',
  'Ingreso con deuda',
  'Acceso denegado',
  'Pase invitado',
  'QR inválido',
  'No empadronado',
];

export const ACCESS_GROUPS = ['Socio', 'Invitado', '—'];

function clockTime(date = new Date()) {
  return date.toTimeString().slice(0, 8);
}

function todayIso(date = new Date()) {
  return todayISODateAR(date);
}

export const GATE_HISTORY_PAGE = 8;

function addDaysISO(iso, days) {
  const raw = String(iso || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const [y, m, d] = raw.split('-').map(Number);
  const next = new Date(y, m - 1, d + Number(days || 0), 12, 0, 0);
  const yy = next.getFullYear();
  const mm = String(next.getMonth() + 1).padStart(2, '0');
  const dd = String(next.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/** Día del club de un log. Los viejos usaban fecha UTC (de noche caían en el día siguiente). */
export function clubDayOfAccessLog(log = {}) {
  const n = normalizeAccessLog(log);
  const d = n.date || '';
  if (!d) return '';
  if (n.daySource === 'ar' || n.source === 'pool' || String(n.id).startsWith('pool-log-')) {
    return d;
  }
  const hour = Number(String(n.time || '').slice(0, 2));
  if (Number.isFinite(hour) && hour >= 21) return addDaysISO(d, -1);
  return d;
}

/** Lecturas del día del club (San Juan). Al cambiar el día, la lista arranca vacía. */
export function accessLogsForClubDay(logs = [], day = todayISODateAR()) {
  return (logs || [])
    .map(normalizeAccessLog)
    .filter((log) => clubDayOfAccessLog(log) === day)
    .toSorted((a, b) => {
      const da = `${a.date || ''}T${a.time || '00:00:00'}`;
      const db = `${b.date || ''}T${b.time || '00:00:00'}`;
      return db.localeCompare(da);
    });
}

export function tierToGroup(tier) {
  if (!tier) return '—';
  return getTierDisplayName(tier) || 'Socio';
}

export function groupFromRoleLabel(role = '') {
  const r = String(role);
  if (/invitado/i.test(r)) return 'Invitado';
  if (/socio/i.test(r)) return 'Socio';
  return r.trim() || '—';
}

export function buildAccessLogEntry({
  memberName,
  memberId,
  role = '',
  status = 'granted',
  notes = '',
  group = '',
  activity = '',
  source = 'access_gate',
  at = new Date(),
} = {}) {
  const resolvedGroup = group || groupFromRoleLabel(role);
  const resolvedActivity = activity
    || (status === 'granted' ? 'Ingreso sede' : 'Acceso denegado');

  return {
    id: `log-${at.getTime()}-${Math.random().toString(36).slice(2, 7)}`,
    date: todayIso(at),
    daySource: 'ar',
    time: clockTime(at),
    memberName: memberName || '—',
    memberId: memberId || null,
    role,
    group: resolvedGroup,
    activity: resolvedActivity,
    status,
    notes,
    source,
  };
}

/** Normaliza logs viejos que no traían group/activity. */
export function normalizeAccessLog(log = {}) {
  return {
    ...log,
    group: log.group || groupFromRoleLabel(log.role),
    activity: log.activity
      || (log.status === 'granted'
        ? (/invitado/i.test(log.role || '') ? 'Pase invitado' : 'Ingreso sede')
        : 'Acceso denegado'),
  };
}

export function filterAccessLogs(logs = [], {
  query = '',
  status = 'all',
  group = 'all',
  activity = 'all',
  dateFrom = '',
  dateTo = '',
  day = '',
} = {}) {
  const q = String(query || '').trim().toLowerCase();
  return (logs || [])
    .map(normalizeAccessLog)
    .filter((log) => {
      if (day && clubDayOfAccessLog(log) !== day) return false;
      if (dateFrom && clubDayOfAccessLog(log) < dateFrom) return false;
      if (dateTo && clubDayOfAccessLog(log) > dateTo) return false;
      if (status !== 'all' && log.status !== status) return false;
      if (group !== 'all' && log.group !== group) return false;
      if (activity !== 'all' && log.activity !== activity) return false;
      if (!q) return true;
      const digits = q.replace(/\D/g, '');
      const hay = [
        log.memberName,
        log.memberId,
        log.group,
        log.activity,
        log.role,
        log.notes,
        log.date,
        log.time,
      ].join(' ').toLowerCase();
      if (hay.includes(q)) return true;
      if (digits.length >= 3) {
        const idDigits = String(log.memberId || '').replace(/\D/g, '');
        const noteDigits = String(log.notes || '').replace(/\D/g, '');
        if (idDigits.includes(digits) || noteDigits.includes(digits)) return true;
      }
      return false;
    })
    .sort((a, b) => {
      const da = `${a.date || ''}T${a.time || '00:00:00'}`;
      const db = `${b.date || ''}T${b.time || '00:00:00'}`;
      return db.localeCompare(da);
    });
}

/** Convierte un ingreso de pileta al shape de /panel/access. */
export function poolIngressToAccessLog(access) {
  if (!access || access.status === 'revoked') return null;
  const rawAt = access.enabledAt || (access.date ? `${access.date}T12:00:00` : null);
  const at = rawAt ? new Date(rawAt) : new Date();
  const time = Number.isNaN(at.getTime()) ? '12:00:00' : at.toTimeString().slice(0, 8);
  const isGuest = access.kind === 'guest';
  const attended = access.payment?.method === 'asistencia' || access.source === 'attendance';
  return {
    id: `pool-log-${access.id}`,
    date: access.date || todayIso(at),
    time,
    memberName: isGuest ? (access.guestName || 'Invitado') : (access.memberName || 'Socio'),
    memberId: access.memberId || null,
    role: isGuest ? 'Invitado pileta' : 'Pileta',
    group: isGuest ? 'Invitado' : 'Socio',
    activity: 'Ingreso pileta',
    status: 'granted',
    notes: isGuest
      ? `Pileta · invitado de ${access.memberName || 'socio'}`
      : attended
        ? 'Pileta · asistió'
        : 'Pileta · canon',
    source: 'pool',
  };
}

export function mergeAccessLogsWithPool(entryLogs = [], poolAccesses = []) {
  const fromPool = (poolAccesses || []).map(poolIngressToAccessLog).filter(Boolean);
  const seen = new Set(
    fromPool.map((log) => `${log.memberId}|${log.date}|${log.activity}|${log.memberName}`),
  );
  const extras = (entryLogs || []).filter((log) => {
    const n = normalizeAccessLog(log);
    const pileta = n.activity === 'Ingreso pileta' || n.source === 'pool' || String(n.id).startsWith('pool-log-');
    if (!pileta) return true;
    const key = `${n.memberId}|${n.date}|${n.activity || 'Ingreso pileta'}|${n.memberName}`;
    if (seen.has(key) || seen.has(String(n.id))) return false;
    seen.add(key);
    return true;
  });
  return [...fromPool, ...extras];
}

/** Conteos por día YYYY-MM-DD dentro del mes. */
export function accessCountsByDay(logs = [], year, monthIndex) {
  const prefix = `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
  const map = {};
  (logs || []).forEach((log) => {
    const d = clubDayOfAccessLog(log);
    if (!d || !d.startsWith(prefix)) return;
    if (!map[d]) map[d] = { total: 0, granted: 0, denied: 0 };
    map[d].total += 1;
    if (log.status === 'granted') map[d].granted += 1;
    else map[d].denied += 1;
  });
  return map;
}
