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
    if (alert.audience === 'admin') {
      return ['admin', 'superadmin', 'accountant'].includes(role);
    }
    return true;
  });
}

export function alertDismissKey(alert) {
  if (!alert) return '';
  if (alert.code) return String(alert.code);
  const concessionId = alert.metadata?.concessionId;
  if (alert.source && concessionId != null && concessionId !== '') {
    return `${alert.source}:${concessionId}`;
  }
  return alert.id ? String(alert.id) : '';
}

export function isAlertAcknowledged(alert, acknowledgements = []) {
  if (!alert) return false;
  const key = alertDismissKey(alert);
  const concessionId = alert.metadata?.concessionId ?? null;
  return (acknowledgements || []).some((ack) => {
    if (ack.alertId && ack.alertId === alert.id) return true;
    if (alert.code && ack.alertCode && ack.alertCode === alert.code) return true;
    if (key && ack.dismissKey && ack.dismissKey === key) return true;
    if (
      concessionId != null
      && ack.concessionId != null
      && String(ack.concessionId) === String(concessionId)
      && ack.source === alert.source
    ) {
      return true;
    }
    return false;
  });
}

export function acknowledgeAlert(acknowledgements, alertId, profileId = 'local-user', alertCode = null, extra = {}) {
  const alert = extra.alert || null;
  const dismissKey = extra.dismissKey || alertCode || (alert ? alertDismissKey(alert) : alertId);
  const source = extra.source || alert?.source || null;
  const concessionId = extra.concessionId ?? alert?.metadata?.concessionId ?? null;
  if ((acknowledgements || []).some((a) => {
    if (a.alertId === alertId && a.profileId === profileId) return true;
    if (dismissKey && a.dismissKey === dismissKey && a.profileId === profileId) return true;
    return false;
  })) {
    return acknowledgements;
  }
  return [
    ...(acknowledgements || []),
    {
      id: `ack-${Date.now()}`,
      alertId,
      profileId,
      alertCode: alertCode || alert?.code || null,
      dismissKey: dismissKey || null,
      source,
      concessionId,
      acknowledgedAt: new Date().toISOString(),
    },
  ];
}

export function mergeAlertAcknowledgements(local = [], remote = []) {
  const seen = new Set();
  const out = [];
  for (const ack of [...(local || []), ...(remote || [])]) {
    if (!ack) continue;
    const key = `${ack.alertId || ''}::${ack.profileId || ''}::${ack.alertCode || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ack);
  }
  return out;
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
