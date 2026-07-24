export const ALERT_SEVERITY = {
  info: { label: 'Informativa', color: 'var(--text-secondary)' },
  warning: { label: 'Advertencia', color: '#f59e0b' },
  critical: { label: 'Crítica', color: '#ef4444' },
};

export function createAlert({
  title,
  body,
  severity = 'info',
  audience = 'all',
  source = 'manual',
  startsAt = new Date().toISOString(),
  endsAt = null,
  requiresAck = false,
  metadata = {},
  createdBy = 'admin-local',
}) {
  return {
    id: `alert-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    title: title.trim(),
    body: body.trim(),
    severity,
    audience,
    source,
    startsAt,
    endsAt,
    isActive: true,
    requiresAck,
    metadata,
    createdBy,
    createdAt: new Date().toISOString(),
  };
}

export function isAlertVisible(alert, now = Date.now()) {
  if (!alert?.isActive) return false;
  const start = new Date(alert.startsAt).getTime();
  if (Number.isFinite(start) && start > now) return false;
  if (alert.endsAt) {
    const end = new Date(alert.endsAt).getTime();
    if (Number.isFinite(end) && end < now) return false;
  }
  return true;
}

export function filterAlertsForRole(alerts, role = 'member') {
  return alerts.filter((alert) => {
    if (!isAlertVisible(alert)) return false;
    if (alert.audience === 'all') return true;
    if (alert.audience === 'members') return role === 'member' || role === 'admin';
    if (alert.audience === 'staff') return ['staff', 'cashier', 'accountant', 'admin'].includes(role) || role === 'admin';
    if (alert.audience === 'admin') return role === 'admin';
    return true;
  });
}

export function acknowledgeAlert(acknowledgements, alertId, profileId = 'local-user') {
  if (acknowledgements.some((a) => a.alertId === alertId && a.profileId === profileId)) {
    return acknowledgements;
  }
  return [
    ...acknowledgements,
    {
      id: `ack-${Date.now()}`,
      alertId,
      profileId,
      acknowledgedAt: new Date().toISOString(),
    },
  ];
}

/** Genera / actualiza alerta Zonda automática. */
export function syncZondaAlert(alerts, isZondaActive) {
  const code = 'ZONDA';
  const existing = alerts.find((a) => a.code === code || a.source === 'zonda');
  if (isZondaActive) {
    if (existing && existing.isActive) return alerts;
    const zonda = {
      ...createAlert({
        title: 'Alerta Zonda — Actividades outdoor suspendidas',
        body: 'Viento Zonda activo en San Juan. Quedan suspendidas canchas y pistas al aire libre. Las reservas outdoor no pueden confirmarse hasta nuevo aviso.',
        severity: 'critical',
        audience: 'all',
        source: 'zonda',
        requiresAck: true,
        metadata: { suspendOutdoor: true },
      }),
      code,
      isActive: true,
    };
    const deactivated = alerts.map((a) =>
      a.code === code || a.source === 'zonda' ? { ...a, isActive: false, endsAt: new Date().toISOString() } : a
    );
    return [zonda, ...deactivated.filter((a) => a.code !== code && a.source !== 'zonda')];
  }
  return alerts.map((a) =>
    (a.code === code || a.source === 'zonda') && a.isActive
      ? { ...a, isActive: false, endsAt: new Date().toISOString() }
      : a
  );
}

export const DEFAULT_ALERTS = [
  {
    id: 'alert-seed-1',
    code: 'ASAMBLEA',
    title: 'Asamblea Anual Ordinaria',
    body: 'El 30 de mayo a las 18:00 hs en Salón de Honor (República del Líbano 1799 Oeste).',
    severity: 'info',
    audience: 'members',
    source: 'manual',
    startsAt: new Date().toISOString(),
    endsAt: null,
    isActive: true,
    requiresAck: false,
    metadata: {},
    createdBy: 'system',
    createdAt: new Date().toISOString(),
  },
];
