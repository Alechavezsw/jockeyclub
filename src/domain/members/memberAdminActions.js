import { todayAR, todayISODateAR } from '../../lib/arDate';
import { money } from '../money';
/** Acciones administrativas sobre socios: motivos trazables. */

/** La nota se presenta con un mes de anticipación. El mes en curso se cobra y la baja rige el 1.º del mes siguiente. */
export function bajaEffectiveOn(presentedOn = new Date()) {
  const d = presentedOn instanceof Date
    ? presentedOn
    : new Date(`${String(presentedOn).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  const next = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-01`;
}

export function isPendingBaja(member, today = new Date()) {
  const fecha = String(member?.bajaFecha || member?.meta?.bajaFecha || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return false;
  const iso = today instanceof Date
    ? todayAR(today)
    : String(today).slice(0, 10);
  const status = String(member?.status || 'active').toLowerCase();
  return status === 'active' && fecha > iso;
}

export const MEMBER_STATUS_REASONS = {
  suspend: [
    { id: 'mora', label: 'Mora / deuda de cuotas' },
    { id: 'conducta', label: 'Conducta / reglamento' },
    { id: 'documentacion', label: 'Documentación incompleta' },
    { id: 'pedido_socio', label: 'Pedido del socio' },
    { id: 'otro', label: 'Otro motivo' },
  ],
  activate: [
    { id: 'regularizo', label: 'Regularizó situación' },
    { id: 'revision', label: 'Revisión administrativa' },
    { id: 'error', label: 'Baja o suspensión por error' },
    { id: 'otro', label: 'Otro' },
  ],
  delete: [
    { id: 'renuncia', label: 'Renuncia / baja voluntaria' },
    { id: 'fallecimiento', label: 'Fallecimiento' },
    { id: 'mora_irrecuperable', label: 'Mora irrecuperable' },
    { id: 'duplicado', label: 'Registro duplicado' },
    { id: 'migracion', label: 'Corrección / migración de padrón' },
    { id: 'otro', label: 'Otro motivo' },
  ],
};

export const REACTIVATE_OPTIONS = [
  { id: 'regularizo', label: 'Regularizó situación', color: '#1f7a4d' },
  { id: 'revision', label: 'Revisión administrativa', color: '#1d4e89' },
  { id: 'error', label: 'Baja o suspensión por error', color: '#8a6a12' },
  { id: 'otro', label: 'Otro', color: '#5c6570' },
];

/** Inactivo, suspendido, o baja ya cargada que todavía no llegó al 1.º. */
export function canReactivateMember(member, today = new Date()) {
  const status = String(member?.status || '').toLowerCase();
  if (status === 'inactive' || status === 'suspended') return true;
  return isPendingBaja(member, today);
}

export function reasonLabel(action, reasonId) {
  const list = MEMBER_STATUS_REASONS[action] || [];
  return list.find((r) => r.id === reasonId)?.label || reasonId || '—';
}

export function splitMemberName(member) {
  if (member?.firstName || member?.lastName) {
    return {
      firstName: String(member.firstName || '').trim(),
      lastName: String(member.lastName || '').trim(),
    };
  }
  const parts = String(member?.name || '').trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] || '',
    lastName: parts.slice(1).join(' '),
  };
}

/** Meta de ciclo de vida (queda en members.meta + audit_logs). */
export function buildLifecycleMeta(prevMeta = {}, {
  action,
  reasonId,
  reasonLabel: label,
  detail = '',
  actorName = '',
  actorId = '',
  actorEmail = '',
  presentedOn = '',
  amount,
} = {}) {
  const now = new Date().toISOString();
  const entry = {
    at: now,
    registeredAt: now,
    action,
    reasonId: reasonId || null,
    reason: label || reasonId || null,
    detail: String(detail || '').trim() || null,
    actorId: actorId || null,
    actorName: actorName || null,
    actorEmail: actorEmail || null,
  };
  const history = Array.isArray(prevMeta.lifecycleHistory)
    ? [...prevMeta.lifecycleHistory, entry].slice(-40)
    : [entry];

  const next = {
    ...prevMeta,
    lifecycleHistory: history,
    lastLifecycle: entry,
  };

  if (action === 'delete') {
    const rawDate = String(presentedOn || '').slice(0, 10);
    const presented = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : todayISODateAR();
    const effective = bajaEffectiveOn(presented) || presented;
    next.bajaMotivo = entry.reason;
    next.bajaKind = entry.reasonId;
    next.bajaActorId = entry.actorId;
    next.bajaActorName = entry.actorName;
    next.bajaActorEmail = entry.actorEmail;
    next.bajaRegistradaAt = now;
    next.bajaPresentada = presented;
    next.bajaFecha = effective;
    next.bajaDetail = entry.detail;
    next.pendingBaja = effective > presented;
    if (amount !== undefined && amount !== null && amount !== '') {
      next.bajaMonto = money(amount);
      entry.amount = next.bajaMonto;
    }
    entry.presentedOn = presented;
    entry.effectiveOn = effective;
  }
  if (action === 'suspend') {
    next.suspendMotivo = entry.reason;
    next.suspendAt = now;
    next.suspendDetail = entry.detail;
  }
  if (action === 'activate') {
    const rawDate = String(presentedOn || '').slice(0, 10);
    const fecha = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : todayISODateAR();
    next.pendingBaja = false;
    next.reactivateMotivo = entry.reason;
    next.reactivateKind = entry.reasonId;
    next.reactivateDetail = entry.detail;
    next.reactivateFecha = fecha;
    next.reactivateAt = now;
    next.reactivateActorId = entry.actorId;
    next.reactivateActorName = entry.actorName;
    next.reactivateActorEmail = entry.actorEmail;
    next.reactivateRegistradaAt = now;
    if (amount !== undefined && amount !== null && amount !== '') {
      next.reactivateMonto = money(amount);
      entry.amount = next.reactivateMonto;
    }
    entry.presentedOn = fecha;
  }
  return next;
}

export function memberHasSocietasApp(member) {
  return member?.hasSocietasApp === true || member?.meta?.hasSocietasApp === true;
}

export function memberHasPortalAccess(member) {
  return Boolean(
    member?.profileId
    || member?.profile_id
    || member?.has_portal === true
    || member?.hasPortal === true
    || member?.meta?.portalProvisionedAt
    || member?.meta?.portalUsername
    || member?.hasApp
    || member?.appInstalled
  );
}

/** Con app = ya abrió este portal. Societas no cuenta. */
export function memberAppAccess(member) {
  if (memberHasPortalAccess(member)) {
    return {
      kind: 'portal',
      hasAccess: true,
      label: 'Con app',
      hint: 'Ya abrió el portal',
    };
  }
  return {
    kind: 'none',
    hasAccess: false,
    label: 'Sin app',
    hint: 'Todavía no abrió el portal',
  };
}

export function collectMemberMeta(member = {}) {
  const base = member.meta && typeof member.meta === 'object' ? { ...member.meta } : {};
  const keys = [
    'source', 'importedAt', 'autorizacion', 'anioNacimiento', 'vencimientoAutorizacion',
    'bloodType', 'healthInsurance', 'emergencyClinic', 'prismaId', 'prismaTipoDebito',
    'prismaSuspectBloodType', 'familyPrincipalNumber', 'familyGroupName', 'cuotaCategories',
    'cuotaMissing', 'pendingBaja', 'bajaFecha', 'bajaPresentada', 'bajaMonto', 'bajaKind', 'bajaMotivo', 'bajaDetail',
    'bajaActorId', 'bajaActorName', 'bajaActorEmail', 'bajaRegistradaAt', 'socioActivoRaw',
    'reactivateMotivo', 'reactivateKind', 'reactivateDetail', 'reactivateFecha', 'reactivateAt',
    'reactivateActorId', 'reactivateActorName', 'reactivateActorEmail', 'reactivateRegistradaAt', 'reactivateMonto',
    'joinedAtFallback', 'fechaAltaRaw', 'joinTime', 'lifecycleHistory', 'lastLifecycle',
    'altaActorId', 'altaActorName', 'altaActorEmail', 'altaRegistradaAt', 'registeredByName',
    'profileEditHistory', 'lastProfileEdit',
    'suspendMotivo', 'suspendAt', 'suspendDetail', 'portalUsername', 'portalProvisionedAt', 'portalProvisionedBy',
    'hasSocietasApp', 'societasAppAsOf', 'societasEmail',
    'documents',
    'poolMedicalExpiresAt', 'poolMedicalFileName', 'poolMedicalUploadedAt',
    'poolMedicalStatus', 'poolMedicalNote',
    'regularidadCertificates',
    'automaticDebitKind', 'debitMoves', 'mpAdhesion', 'cardExpiry', 'lastDebitCardNumber',
    'duesFreeThrough', 'duesMonthCapital',
  ];
  for (const k of keys) {
    if (member[k] != null && member[k] !== '' && base[k] == null) base[k] = member[k];
  }
  return base;
}
