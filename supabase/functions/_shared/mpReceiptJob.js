/** Cola persistente del comprobante de Mercado Pago. No acredita pagos. */

export const RECEIPT_ATTEMPT_CAP = 6;

export function storedReceiptEmail(emailId) {
  if (emailId === 'no-email' || emailId === 'skipped:no-email') return 'skipped:no-email';
  return emailId || null;
}

/**
 * sent: los canales exigidos quedaron hechos. Un mail omitido (sin casilla real)
 * se guarda como skipped:no-email y no se reintenta.
 * retry: falló algo transitorio y todavía no se agotaron los intentos.
 * attention: falló de forma permanente o se agotaron los intentos. El webhook
 * no vuelve a tomarlo; Administración puede forzarlo.
 *
 * Resend acepta Idempotency-Key durante 24 horas. Si el proveedor aceptó el
 * mail y esta función cayó antes de guardar email_id, un reintento dentro de
 * esas 24 horas no manda otro mail. Pasado ese plazo, Resend ya no garantiza
 * la misma respuesta y un reintento puede enviar un segundo correo.
 */
export function nextReceiptStatus({
  messageId,
  emailId,
  opsNoticeId,
  permanent = false,
  attempts = 0,
} = {}) {
  const email = storedReceiptEmail(emailId);
  const done = Boolean(messageId && opsNoticeId && email);
  if (done && !permanent) return 'sent';
  if (permanent || Number(attempts) >= RECEIPT_ATTEMPT_CAP) return 'attention';
  return 'retry';
}

/**
 * Un webhook repetido vuelve a entrar acá.
 * Si el trabajo ya está enviado, no manda otro comprobante.
 * Si otro proceso lo tiene tomado, no manda en paralelo.
 */
export async function settleMpReceipt({ admin, intentId, deliver, force = false }) {
  if (!intentId) return { skip: 'no-intent' };
  const claim = await admin.rpc('claim_mp_receipt_job', {
    p_intent_id: intentId,
    p_force: Boolean(force),
  });
  if (claim?.error) return deliver({});

  const row = claim?.data || {};
  if (!row.claimed) {
    if (row.status === 'sent') return { skip: 'already', status: 'sent' };
    if (row.status === 'attention') return { skip: 'attention', status: 'attention' };
    return { skip: 'locked', status: row.status || 'locked' };
  }

  const prior = {
    messageId: row.message_id || null,
    emailId: row.email_id || null,
    opsNoticeId: row.ops_notice_id || null,
  };
  let result;
  try {
    result = await deliver(prior);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'No se pudo emitir el comprobante.';
    const saved = await admin.rpc('complete_mp_receipt_job', {
      p_intent_id: intentId,
      p_message_id: prior.messageId,
      p_email_id: prior.emailId,
      p_email_error: null,
      p_ops_notice_id: prior.opsNoticeId,
      p_receipt_number: null,
      p_last_error: message,
      p_permanent: false,
      p_close: false,
    });
    return { error: message, status: saved?.data?.status || 'retry' };
  }

  const messageId = result?.messageId || prior.messageId || null;
  const emailId = storedReceiptEmail(result?.emailId || prior.emailId || null);
  const opsNoticeId = result?.opsNoticeId || prior.opsNoticeId || null;
  const saved = await admin.rpc('complete_mp_receipt_job', {
    p_intent_id: intentId,
    p_message_id: messageId,
    p_email_id: emailId,
    p_email_error: result?.emailError || null,
    p_ops_notice_id: opsNoticeId,
    p_receipt_number: result?.receiptNumber || null,
    p_last_error: result?.error || result?.emailError || null,
    p_permanent: Boolean(result?.permanent),
    p_close: result?.skip === 'dues-exempt',
  });
  return {
    ...result,
    messageId,
    emailId,
    opsNoticeId,
    status: saved?.data?.status || nextReceiptStatus({
      messageId,
      emailId,
      opsNoticeId,
      permanent: Boolean(result?.permanent),
      attempts: row.attempts,
    }),
  };
}
