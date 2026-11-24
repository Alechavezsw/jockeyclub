/** Día de débito de la adhesión. AMET el 18; el resto el 10. */
export function subscriptionBillingDay(member) {
  const tier = String(member?.tier || "").toLowerCase();
  const blob = `${tier} ${JSON.stringify(member?.meta || {})}`.toLowerCase();
  if (/socio_familiar_amet|socio_individual_amet|socio familiar \(amet\)|socio individual \(amet\)/.test(blob)) {
    return 18;
  }
  return 10;
}

/**
 * Estado que se guarda en members.meta.mpAdhesion.
 * Pendiente e in_process siguen abiertas. No se anotan como rechazo.
 */
export function subscriptionAdhesionState(status) {
  const value = String(status || "").trim().toLowerCase() || "pending";
  if (value === "authorized" || value === "approved") return "authorized";
  if (value === "cancelled" || value === "paused") return "cancelled";
  if (value === "pending" || value === "in_process") return "pending";
  return "rejected";
}

/** Diferencia de tarifa. Null cuando el débito ya está en el capital vigente. */
export function subscriptionAmountDrift(subscribed, current) {
  const from = Math.round(Number(subscribed) * 100) / 100;
  const to = Math.round(Number(current) * 100) / 100;
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  if (Math.abs(from - to) < 0.01) return null;
  return { from, to };
}

/** Solo una adhesión todavía abierta puede cambiar de capital. */
export function subscriptionTariffMayUpdate(status) {
  const value = String(status || "").trim().toLowerCase();
  return value === "pending" || value === "in_process";
}

/** La preaprobación responde con el id de esta adhesión. */
export function preapprovalOwnedByIntent(remote, { preapprovalId, intentId } = {}) {
  if (!remote || typeof remote !== "object") return false;
  if (String(remote.id || "") !== String(preapprovalId || "")) return false;
  return String(remote.external_reference || "") === String(intentId || "");
}

/**
 * Mercado Pago confirmó el capital, la moneda, el día y que la adhesión sigue pendiente.
 * Un rechazo o una adhesión ya autorizada no cuenta como sincronizada.
 */
export function confirmedPreapprovalAmount(remote, { preapprovalId, intentId, amount, billingDay } = {}) {
  if (!preapprovalOwnedByIntent(remote, { preapprovalId, intentId })) {
    return { ok: false, reason: "preapproval" };
  }
  if (!subscriptionTariffMayUpdate(remote.status)) {
    return { ok: false, reason: "status" };
  }
  const currency = String(remote.auto_recurring?.currency_id || "").trim().toUpperCase();
  if (currency !== "ARS") return { ok: false, reason: "currency" };
  const confirmed = Math.round(Number(remote.auto_recurring?.transaction_amount) * 100) / 100;
  const expected = Math.round(Number(amount) * 100) / 100;
  if (!Number.isFinite(confirmed) || !Number.isFinite(expected) || Math.abs(confirmed - expected) >= 0.01) {
    return { ok: false, reason: "amount" };
  }
  const day = Number(remote.auto_recurring?.billing_day);
  if (day !== Number(billingDay)) return { ok: false, reason: "billing_day" };
  return { ok: true, amount: expected, billingDay: day };
}

/** Cuerpo para actualizar el capital de una preaprobación todavía pendiente. */
export function preapprovalAmountUpdate(amount, billingDay) {
  const value = Math.round(Number(amount) * 100) / 100;
  return {
    auto_recurring: {
      frequency: 1,
      frequency_type: "months",
      transaction_amount: value,
      currency_id: "ARS",
      billing_day: Number(billingDay),
      billing_day_proportional: false,
    },
  };
}
