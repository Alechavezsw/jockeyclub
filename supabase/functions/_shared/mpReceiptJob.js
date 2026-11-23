/** Cola persistente del comprobante de Mercado Pago. No acredita pagos. */

export function nextReceiptStatus({ messageId, emailId, opsNoticeId } = {}) {
  if (messageId && emailId && opsNoticeId) return 'sent';
  return 'retry';
}

/**
 * Un webhook repetido vuelve a entrar acá.
 * Si el trabajo ya está enviado, no manda otro comprobante.
 * Si otro proceso lo tiene tomado, no manda en paralelo.
 */
export async function settleMpReceipt({ admin, intentId, deliver }) {
  if (!intentId) return { skip: 'no-intent' };
  const claim = await admin.rpc('claim_mp_receipt_job', { p_intent_id: intentId });
  if (claim?.error) return deliver({});

  const row = claim?.data || {};
  if (!row.claimed) {
    return { skip: row.status === 'sent' ? 'already' : 'locked', status: row.status || 'locked' };
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
    await admin.rpc('complete_mp_receipt_job', {
      p_intent_id: intentId,
      p_message_id: prior.messageId,
      p_email_id: prior.emailId,
      p_email_error: null,
      p_ops_notice_id: prior.opsNoticeId,
      p_receipt_number: null,
      p_last_error: message,
    });
    return { error: message };
  }

  const messageId = result?.messageId || prior.messageId || null;
  const emailId = result?.emailId || prior.emailId || null;
  const opsNoticeId = result?.opsNoticeId || prior.opsNoticeId || null;
  await admin.rpc('complete_mp_receipt_job', {
    p_intent_id: intentId,
    p_message_id: messageId,
    p_email_id: emailId,
    p_email_error: result?.emailError || null,
    p_ops_notice_id: opsNoticeId,
    p_receipt_number: result?.receiptNumber || null,
    p_last_error: result?.error || result?.emailError || null,
  });
  return {
    ...result,
    messageId,
    emailId,
    opsNoticeId,
    status: nextReceiptStatus({ messageId, emailId, opsNoticeId }),
  };
}
