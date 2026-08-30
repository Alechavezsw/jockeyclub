/** Acciones administrativas sobre socios: motivos trazables. */

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
    { id: 'error', label: 'Alta / suspensión por error' },
    { id: 'otro', label: 'Otro motivo' },
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
} = {}) {
  const now = new Date().toISOString();
  const entry = {
    at: now,
    action,
    reasonId: reasonId || null,
    reason: label || reasonId || null,
    detail: String(detail || '').trim() || null,
    actorName: actorName || null,
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
    next.bajaMotivo = entry.reason;
    next.bajaFecha = now.slice(0, 10);
    next.bajaDetail = entry.detail;
  }
  if (action === 'suspend') {
    next.suspendMotivo = entry.reason;
    next.suspendAt = now;
    next.suspendDetail = entry.detail;
  }
  if (action === 'activate') {
    next.reactivateMotivo = entry.reason;
    next.reactivateAt = now;
    next.reactivateDetail = entry.detail;
  }
  return next;
}

export function collectMemberMeta(member = {}) {
  const base = member.meta && typeof member.meta === 'object' ? { ...member.meta } : {};
  const keys = [
    'source', 'importedAt', 'autorizacion', 'anioNacimiento', 'vencimientoAutorizacion',
    'bloodType', 'healthInsurance', 'emergencyClinic', 'prismaId', 'prismaTipoDebito',
    'prismaSuspectBloodType', 'familyPrincipalNumber', 'familyGroupName', 'cuotaCategories',
    'cuotaMissing', 'bajaFecha', 'bajaMotivo', 'bajaDetail', 'socioActivoRaw',
    'joinedAtFallback', 'fechaAltaRaw', 'joinTime', 'lifecycleHistory', 'lastLifecycle',
    'suspendMotivo', 'suspendAt', 'suspendDetail', 'reactivateMotivo', 'reactivateAt',
    'reactivateDetail', 'portalUsername', 'portalProvisionedAt', 'portalProvisionedBy',
    'documents',
    'poolMedicalExpiresAt', 'poolMedicalFileName', 'poolMedicalUploadedAt',
    'poolMedicalStatus', 'poolMedicalNote',
  ];
  for (const k of keys) {
    if (member[k] != null && member[k] !== '' && base[k] == null) base[k] = member[k];
  }
  return base;
}
