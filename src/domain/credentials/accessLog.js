/** Entrada de historial de molinete / Control QR. */

export const ACCESS_ACTIVITIES = [
  'Ingreso sede',
  'Ingreso con deuda',
  'Acceso denegado',
  'Pase invitado',
  'QR inválido',
  'No empadronado',
];

export const ACCESS_GROUPS = ['Royal', 'Platinum', 'Gold', 'Invitado', '—'];

function clockTime(date = new Date()) {
  return date.toTimeString().slice(0, 8);
}

function todayIso(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export function tierToGroup(tier) {
  const t = String(tier || '').toLowerCase();
  if (t === 'royal') return 'Royal';
  if (t === 'platinum') return 'Platinum';
  if (t === 'gold') return 'Gold';
  return '—';
}

export function groupFromRoleLabel(role = '') {
  const r = String(role);
  if (/invitado/i.test(r)) return 'Invitado';
  if (/royal/i.test(r)) return 'Royal';
  if (/platinum/i.test(r)) return 'Platinum';
  if (/gold/i.test(r)) return 'Gold';
  return '—';
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
      if (day && log.date !== day) return false;
      if (dateFrom && log.date < dateFrom) return false;
      if (dateTo && log.date > dateTo) return false;
      if (status !== 'all' && log.status !== status) return false;
      if (group !== 'all' && log.group !== group) return false;
      if (activity !== 'all' && log.activity !== activity) return false;
      if (!q) return true;
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
      return hay.includes(q);
    })
    .sort((a, b) => {
      const da = `${a.date || ''}T${a.time || '00:00:00'}`;
      const db = `${b.date || ''}T${b.time || '00:00:00'}`;
      return db.localeCompare(da);
    });
}

/** Conteos por día YYYY-MM-DD dentro del mes. */
export function accessCountsByDay(logs = [], year, monthIndex) {
  const prefix = `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
  const map = {};
  (logs || []).forEach((log) => {
    const d = normalizeAccessLog(log).date;
    if (!d || !d.startsWith(prefix)) return;
    if (!map[d]) map[d] = { total: 0, granted: 0, denied: 0 };
    map[d].total += 1;
    if (log.status === 'granted') map[d].granted += 1;
    else map[d].denied += 1;
  });
  return map;
}
