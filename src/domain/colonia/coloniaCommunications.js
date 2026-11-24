/**
 * Comunicaciones Colonia — cola idempotente.
 * dryRun=true por defecto: no envía correos reales.
 */

export const COLONIA_NOTIFICATION_KINDS = Object.freeze([
  'solicitud_recibida',
  'inscripcion_confirmada',
  'inscripcion_observada',
  'pago_confirmado',
  'comprobante_disponible',
  'autorizacion_pendiente',
]);

export const COLONIA_NOTIFICATION_COPY = Object.freeze({
  solicitud_recibida: {
    subject: 'Colonia: recibimos tu solicitud',
    body: 'Tu solicitud de inscripción a Colonia de Verano fue recibida y será revisada.',
  },
  inscripcion_confirmada: {
    subject: 'Colonia: inscripción confirmada',
    body: 'La inscripción quedó confirmada. Consultá el estado y los cargos en tu cuenta Colonia.',
  },
  inscripcion_observada: {
    subject: 'Colonia: inscripción observada',
    body: 'Hay observaciones sobre la inscripción. Revisá el detalle en el portal.',
  },
  pago_confirmado: {
    subject: 'Colonia: pago acreditado',
    body: 'Acreditamos tu pago de Colonia. El comprobante interno ya está disponible.',
  },
  comprobante_disponible: {
    subject: 'Colonia: comprobante disponible',
    body: 'Ya podés descargar el comprobante interno de tu pago de Colonia.',
  },
  autorizacion_pendiente: {
    subject: 'Colonia: autorización pendiente',
    body: 'Hay una autorización pendiente para una actividad de Colonia.',
  },
});

export function assertColoniaNotificationKind(kind) {
  const key = String(kind || '');
  if (!COLONIA_NOTIFICATION_KINDS.includes(key)) {
    throw new Error(`Tipo de comunicación Colonia inválido: ${key}`);
  }
  return key;
}

export function buildColoniaNotificationJob({
  kind,
  enrollmentId = null,
  paymentId = null,
  recipientEmail = null,
  recipientMemberId = null,
  externalGuardianId = null,
  payload = {},
  dryRun = true,
  idempotencyKey = null,
} = {}) {
  const k = assertColoniaNotificationKind(kind);
  const copy = COLONIA_NOTIFICATION_COPY[k];
  const key = idempotencyKey
    || `${k}:${enrollmentId || ''}:${paymentId || ''}:${recipientEmail || externalGuardianId || 'x'}`;

  // No incluir datos médicos ni de salud en el payload de correo.
  const safePayload = { ...payload };
  delete safePayload.health;
  delete safePayload.allergies;
  delete safePayload.medications;
  delete safePayload.healthNotes;

  return {
    kind: k,
    enrollmentId,
    paymentId,
    recipientEmail: recipientEmail ? String(recipientEmail).trim().toLowerCase() : null,
    recipientMemberId,
    externalGuardianId,
    subject: copy.subject,
    body: copy.body,
    payload: {
      ...safePayload,
      subject: copy.subject,
      preview: copy.body,
    },
    status: dryRun ? 'dry_run' : 'queued',
    dryRun: Boolean(dryRun),
    idempotencyKey: key,
    sendRealEmail: false,
  };
}

export function coloniaNotificationRetryPlan({ attempts = 0, maxAttempts = 5 } = {}) {
  if (attempts >= maxAttempts) return { retry: false, delayMs: null };
  const delayMs = Math.min(60_000, 2 ** attempts * 1000);
  return { retry: true, delayMs };
}
