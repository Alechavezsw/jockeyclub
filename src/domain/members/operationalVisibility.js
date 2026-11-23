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

function bajaDate(member) {
  const fecha = String(member?.bajaFecha || member?.meta?.bajaFecha || member?.baja_fecha || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(fecha) ? fecha : '';
}

/** Fecha ISO. En POSIX hace falta [0-9]: \d no es dígito. */
const VALID_BAJA_DATE = '^[0-9]{4}-[0-9]{2}-[0-9]{2}$';

/**
 * Filtros PostgREST con la misma regla que isOperationalMember / member_is_operational.
 * El status active no alcanza: una bajaFecha válida de hoy o anterior excluye,
 * aunque pendingBaja sea false o null. not.match sobre null no es verdadero,
 * por eso el nulo va en su propia rama is.null, unida por OR adentro del AND.
 */
export function operationalListFilter(today = new Date()) {
  const iso = todayAR(today);
  return [
    `and(status.eq.inactive,meta->>bajaFecha.gt.${iso},meta->>bajaFecha.match.${VALID_BAJA_DATE})`,
    `and(status.eq.active,or(meta->>bajaFecha.is.null,meta->>bajaFecha.not.match.${VALID_BAJA_DATE},meta->>bajaFecha.gt.${iso}))`,
  ].join(',');
}

/** Padrón de bajas: quien ya no opera, incluida la baja que entra hoy y sigue en active. */
export function inactiveListFilter(today = new Date()) {
  const iso = todayAR(today);
  return [
    `and(status.eq.inactive,or(meta->>bajaFecha.is.null,meta->>bajaFecha.not.match.${VALID_BAJA_DATE},meta->>bajaFecha.lte.${iso}))`,
    'status.eq.suspended',
    'status.eq.pending',
    `and(status.eq.active,meta->>bajaFecha.match.${VALID_BAJA_DATE},meta->>bajaFecha.lte.${iso})`,
  ].join(',');
}

/** Reactivar: inactivo efectivo, suspendido, o activo cuya baja ya entró. La de mañana no entra. */
export function reactivateListFilter(today = new Date()) {
  const iso = todayAR(today);
  return [
    `and(status.eq.inactive,or(meta->>bajaFecha.is.null,meta->>bajaFecha.not.match.${VALID_BAJA_DATE},meta->>bajaFecha.lte.${iso}))`,
    'status.eq.suspended',
    `and(status.eq.active,meta->>bajaFecha.match.${VALID_BAJA_DATE},meta->>bajaFecha.lte.${iso})`,
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
