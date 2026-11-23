import { todayAR } from '../../lib/arDate';

/** Circuitos de Connect que solo ven socios operativos. */
export const OPERATIONAL_CIRCUITS = Object.freeze([
  'padron',
  'caja',
  'cobranzas',
  'debitos',
  'reservas',
  'pileta',
  'tenis',
  'credenciales',
  'porteria',
  'estadisticas',
  'reportes',
  'mensajeria',
  'exportacion',
  'campanas',
  'avisos',
]);

export const VISIBILITY_SCOPES = Object.freeze({
  operational: 'operational',
  reactivate: 'reactivate',
  historical: 'historical',
});

/**
 * Fecha de calendario real, no solo AAAA-MM-DD.
 * El mismo patrón lo usa el filtro PostgREST. PostgreSQL valida con la misma
 * regla de mes, día y bisiesto, sin castear un texto inválido a date.
 */
export const CALENDAR_DATE_PATTERN = '^([0-9]{4}-((01|03|05|07|08|10|12)-(0[1-9]|[12][0-9]|3[01])|(04|06|09|11)-(0[1-9]|[12][0-9]|30)|02-(0[1-9]|1[0-9]|2[0-8]))|((([0-9]{2})(0[48]|[2468][048]|[13579][26])|0000|(0[48]|[2468][048]|[13579][26])00)-02-29))$';

export function isCalendarDate(value) {
  const fecha = String(value || '').trim().slice(0, 10);
  const match = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(fecha);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= days[month - 1];
}

export function rawBajaFecha(member) {
  return String(member?.bajaFecha || member?.meta?.bajaFecha || member?.baja_fecha || '').trim().slice(0, 10);
}

function bajaDate(member) {
  const fecha = rawBajaFecha(member);
  return isCalendarDate(fecha) ? fecha : '';
}

/** Hay un texto de baja que no es una fecha real. No bloquea a un socio activo. */
export function bajaFechaNeedsReview(member) {
  const raw = rawBajaFecha(member);
  return Boolean(raw) && !isCalendarDate(raw);
}

/**
 * Filtros PostgREST con la misma regla que isOperationalMember / member_is_operational.
 * El status active no alcanza: una bajaFecha válida de hoy o anterior excluye,
 * aunque pendingBaja sea false o null. not.match sobre null no es verdadero,
 * por eso el nulo va en su propia rama is.null, unida por OR adentro del AND.
 */
export function operationalListFilter(today = new Date()) {
  const iso = todayAR(today);
  return [
    `and(status.eq.inactive,meta->>bajaFecha.gt.${iso},meta->>bajaFecha.match.${CALENDAR_DATE_PATTERN})`,
    `and(status.eq.active,or(meta->>bajaFecha.is.null,meta->>bajaFecha.not.match.${CALENDAR_DATE_PATTERN},meta->>bajaFecha.gt.${iso}))`,
  ].join(',');
}

/** Padrón de bajas: quien ya no opera, incluida la baja que entra hoy y sigue en active. */
export function inactiveListFilter(today = new Date()) {
  const iso = todayAR(today);
  return [
    `and(status.eq.inactive,or(meta->>bajaFecha.is.null,meta->>bajaFecha.not.match.${CALENDAR_DATE_PATTERN},meta->>bajaFecha.lte.${iso}))`,
    'status.eq.suspended',
    'status.eq.pending',
    `and(status.eq.active,meta->>bajaFecha.match.${CALENDAR_DATE_PATTERN},meta->>bajaFecha.lte.${iso})`,
  ].join(',');
}

/** Reactivar: inactivo efectivo, suspendido, o activo cuya baja ya entró. La de mañana no entra. */
export function reactivateListFilter(today = new Date()) {
  const iso = todayAR(today);
  return [
    `and(status.eq.inactive,or(meta->>bajaFecha.is.null,meta->>bajaFecha.not.match.${CALENDAR_DATE_PATTERN},meta->>bajaFecha.lte.${iso}))`,
    'status.eq.suspended',
    `and(status.eq.active,meta->>bajaFecha.match.${CALENDAR_DATE_PATTERN},meta->>bajaFecha.lte.${iso})`,
  ].join(',');
}

/**
 * Socio que puede operar hoy.
 * La baja programada sigue en los circuitos hasta el día anterior a la fecha efectiva.
 * El día de la fecha ya no opera, aunque el status todavía diga active.
 * Un inactive con fecha futura no se saca antes de tiempo.
 */
export function isOperationalMember(member, today = new Date()) {
  if (!member) return false;
  const status = String(member.status || '').toLowerCase();
  if (status === 'suspended' || status === 'pending' || status === 'baja') return false;
  const iso = todayAR(today);
  const baja = bajaDate(member);
  if (status === 'inactive') return Boolean(baja) && baja > iso;
  if (status !== 'active') return false;
  return !baja || baja > iso;
}

/** Ficha que Reactivar puede buscar: inactivo efectivo o suspendido. */
export function isReactivateCandidate(member, today = new Date()) {
  if (!member || isOperationalMember(member, today)) return false;
  const status = String(member.status || '').toLowerCase();
  if (status === 'inactive' || status === 'suspended') return true;
  const baja = bajaDate(member);
  return status === 'active' && Boolean(baja) && baja <= todayAR(today);
}

export function filterOperationalMembers(members, today = new Date()) {
  return (members || []).filter((member) => isOperationalMember(member, today));
}

export function filterReactivateMembers(members, today = new Date()) {
  return (members || []).filter((member) => isReactivateCandidate(member, today));
}

/** Dónde puede aparecer la ficha. La contabilidad histórica no se toca. */
export function memberCircuitAccess(member, today = new Date()) {
  const operational = isOperationalMember(member, today);
  const circuits = {};
  for (const circuit of OPERATIONAL_CIRCUITS) circuits[circuit] = operational;
  return {
    operational,
    circuits,
    reactivate: isReactivateCandidate(member, today),
    historicalAccounting: true,
    bajaFechaReview: bajaFechaNeedsReview(member),
  };
}

export const REACTIVATE_SEARCH_UNAVAILABLE = 'No se pudo buscar socios inactivos. Reactivar no está disponible.';
export const HISTORICAL_SEARCH_UNAVAILABLE = 'No se pudo consultar el historial de socios. La consulta histórica no está disponible.';

/** La RPC falta de verdad. Un permiso denegado no cuenta, aunque el mensaje nombre la función. */
export function isMissingMemberSearchRpc(error) {
  const code = String(error?.code || '');
  return code === 'PGRST202' || code === '42883';
}

/**
 * operational puede caer a la tabla, siempre con el filtro de visibles.
 * reactivate e historical nunca consultan members desde el cliente.
 */
export function memberSearchPlan(scope, error) {
  if (!error) return { action: 'ok' };
  const code = String(error.code || '');
  const message = String(error.message || '');
  const denied = code === '42501' || /sin permiso|permission denied/i.test(message);
  if (scope === VISIBILITY_SCOPES.reactivate || scope === VISIBILITY_SCOPES.historical) {
    const fallback = scope === VISIBILITY_SCOPES.reactivate
      ? REACTIVATE_SEARCH_UNAVAILABLE
      : HISTORICAL_SEARCH_UNAVAILABLE;
    return {
      action: 'throw',
      message: denied && message ? message : fallback,
      code: code || 'RPC_UNAVAILABLE',
    };
  }
  if (isMissingMemberSearchRpc(error)) return { action: 'operational-fallback' };
  return {
    action: 'throw',
    message: message || 'No se pudo buscar socios',
    code,
  };
}

export function canReceiveAutomaticNotice(member, today = new Date()) {
  return isOperationalMember(member, today);
}

export function canStartOperationalWrite(member, today = new Date()) {
  return isOperationalMember(member, today);
}

/**
 * Reactivar no crea otra ficha: mismo id, número, hogar, pagos y deuda.
 * La baja queda en la meta.
 */
export function reactivateMemberRecord(member, lifecycleMeta = {}) {
  if (!member) throw new Error('Falta el socio.');
  const prevMeta = member.meta && typeof member.meta === 'object' ? member.meta : {};
  const kept = { ...member, status: 'active', pendingBaja: false, bajaFecha: '' };
  const keptMeta = { ...prevMeta, ...lifecycleMeta, pendingBaja: false, bajaFecha: null };
  return { ...kept, meta: keptMeta };
}

export const INACTIVE_MEMBER_OPERATION_ERROR = 'El socio está inactivo y no entra en los circuitos operativos.';
