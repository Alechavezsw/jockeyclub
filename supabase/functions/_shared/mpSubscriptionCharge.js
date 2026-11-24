import {
  currencyIsArs,
  debitInstant,
  duesDueOn,
  duesMonthPhrase,
  isSubscriptionAdhesionIntent,
  isUniqueViolation,
  moneyCentsEqual,
  paymentStatus,
  sameMember,
  subscriptionDebitCredits,
} from './mpSettlement.js';

async function loadCharge(admin, remoteId) {
  const { data } = await admin
    .from('mp_intents')
    .select('id, applied_at, member_id, amount')
    .contains('meta', { authorized_payment_id: remoteId })
    .maybeSingle();
  return data || null;
}

async function loadSubscription(admin, preapprovalId) {
  const { data } = await admin
    .from('mp_intents')
    .select('*')
    .eq('preapproval_id', preapprovalId)
    .eq('kind', 'subscription')
    .in('status', ['authorized', 'approved'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data || null;
}

function mismatch(charge, subscription) {
  return Boolean(charge?.member_id) && !sameMember(charge.member_id, subscription?.member_id);
}

/**
 * Débito recurrente. La adhesión no entra acá.
 * Solo un pago approved acredita, y un webhook repetido no genera otro recibo.
 */
export async function settleSubscriptionCharge({
  admin,
  remoteId,
  pay,
  applyCheckoutPayment,
  notifyDebitFailed,
}) {
  const preapprovalId = String(pay?.preapproval_id || '');
  const payment = pay?.payment || {};
  const paymentStatusValue = paymentStatus(payment.status);
  const amount = Number(payment.transaction_amount ?? pay?.transaction_amount ?? 0);
  const currency = String(payment.currency_id || pay?.currency_id || '');
  if (!preapprovalId) return { http: 200, body: { ok: true, ignored: true } };

  let charge = await loadCharge(admin, remoteId);
  if (charge?.applied_at) {
    return { http: 200, body: { ok: true, kind: 'subscription_charge', already: true, applied: false } };
  }

  const subscription = await loadSubscription(admin, preapprovalId);
  if (!isSubscriptionAdhesionIntent(subscription)) {
    return { http: 200, body: { ok: true, ignored: true, reason: 'subscription-without-member' } };
  }
  if (mismatch(charge, subscription)) {
    return {
      http: 200,
      body: { ok: false, applied: false, permanent: true, error: 'El débito no corresponde al socio de la suscripción.' },
    };
  }

  const { data: exempt } = await admin.rpc('member_id_is_dues_exempt', { mid: subscription.member_id });
  if (exempt === true) return { http: 200, body: { ok: true, ignored: true, reason: 'exempt' } };

  const credits = subscriptionDebitCredits(paymentStatusValue);
  if (credits && (!currencyIsArs(currency) || !moneyCentsEqual(amount, subscription.amount))) {
    return {
      http: 200,
      body: {
        ok: false,
        applied: false,
        permanent: true,
        error: 'El débito no coincide con el capital de la adhesión.',
      },
    };
  }
  if (credits && !(amount > 0)) {
    return {
      http: 200,
      body: { ok: false, applied: false, permanent: true, error: 'Importe de Mercado Pago inválido.' },
    };
  }
  if (!credits && !(amount > 0)) {
    return {
      http: 200,
      body: { ok: true, kind: 'subscription_charge_open', status: paymentStatusValue || 'pending', applied: false },
    };
  }

  if (!charge?.id) {
    const periodDate = debitInstant(String(payment.date_approved || pay?.debit_date || pay?.date_created || ''));
    const inserted = await admin
      .from('mp_intents')
      .insert({
        kind: 'dues',
        status: 'pending',
        member_id: subscription.member_id,
        member_number: subscription.member_number,
        amount,
        concept: `Cuota social · ${duesMonthPhrase(periodDate)}`,
        payer_email: subscription.payer_email,
        external_reference: crypto.randomUUID(),
        preapproval_id: preapprovalId,
        meta: {
          from_subscription: subscription.id,
          authorized_payment_id: remoteId,
          channel: 'subscription',
          periodDueOn: duesDueOn(periodDate),
          chargeScope: 'cuota_social',
        },
      })
      .select('id, member_id')
      .single();
    if (inserted.error) {
      if (!isUniqueViolation(inserted.error)) {
        return { http: 500, body: { error: inserted.error.message || 'No se pudo anotar el débito.' } };
      }
      charge = await loadCharge(admin, remoteId);
      if (!charge?.id) return { http: 500, body: { error: 'No se pudo anotar el débito.' } };
      if (mismatch(charge, subscription)) {
        return {
          http: 200,
          body: { ok: false, applied: false, permanent: true, error: 'El débito no corresponde al socio de la suscripción.' },
        };
      }
      if (charge.applied_at) {
        return { http: 200, body: { ok: true, kind: 'subscription_charge', already: true, applied: false } };
      }
    } else {
      charge = inserted.data;
    }
  }

  if (!credits) {
    const { error } = await admin.rpc('apply_mp_approved_payment', {
      p_intent_id: charge.id,
      p_provider_payment_id: String(payment.id || remoteId),
      p_status: paymentStatusValue || 'pending',
      p_paid_amount: amount,
    });
    if (error) return { http: 500, body: { error: error.message } };
    if (paymentStatusValue === 'rejected' || paymentStatusValue === 'cancelled') {
      const notice = await notifyDebitFailed(subscription, {
        status: paymentStatusValue,
        amount,
      });
      return { http: 200, body: { ok: true, kind: 'subscription_charge_failed', status: paymentStatusValue, applied: false, notice } };
    }
    return {
      http: 200,
      body: { ok: true, kind: 'subscription_charge_open', status: paymentStatusValue || 'pending', applied: false },
    };
  }

  const applied = await applyCheckoutPayment(
    String(charge.id),
    String(payment.id || remoteId),
    'approved',
    amount,
    currency,
  );
  if (applied?.error) return { http: applied.permanent ? 200 : 500, body: { error: applied.error, ...applied } };
  return { http: 200, body: { ok: true, kind: 'subscription_charge', ...applied } };
}
