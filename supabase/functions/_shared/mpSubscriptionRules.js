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

/** Cuerpo para actualizar el capital de una preaprobación todavía pendiente. */
export function preapprovalAmountUpdate(amount) {
  const value = Math.round(Number(amount) * 100) / 100;
  return {
    auto_recurring: {
      transaction_amount: value,
      currency_id: "ARS",
    },
  };
}
