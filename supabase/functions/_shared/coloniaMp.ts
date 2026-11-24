/**
 * Helpers MP Colonia para edges.
 * NO desplegar mp-create/mp-webhook con kind=colonia live hasta autorización.
 * Default: rechaza acreditación.
 */

export const COLONIA_MP_KIND = "colonia";

export function coloniaMpLiveFromEnv(): boolean {
  return String(Deno.env.get("COLONIA_MP_LIVE") || "").trim() === "1";
}

export function assertColoniaMpIntentMeta(meta: Record<string, unknown> | null | undefined) {
  const enrollmentId = String(meta?.enrollment_id || meta?.enrollmentId || "").trim();
  if (!enrollmentId) {
    throw new Error("Intent Colonia sin enrollment_id");
  }
  if (String(meta?.chargeScope || meta?.charge_scope || "colonia") === "cuota_social") {
    throw new Error("Colonia no puede usar chargeScope cuota_social");
  }
  return { enrollmentId };
}

export function coloniaMpCreditGuard(args: {
  live: boolean;
  kind: string;
  status: string;
  currency: string;
  amount: number;
  expectedAmount: number;
  signatureValid: boolean;
  timestampFresh: boolean;
}) {
  const errors: string[] = [];
  if (!args.live) errors.push("colonia_mp_live_off");
  if (String(args.kind || "").toLowerCase() !== COLONIA_MP_KIND) errors.push("kind_mismatch");
  if (String(args.status || "").toLowerCase() !== "approved") errors.push("status_not_approved");
  if (String(args.currency || "").toUpperCase() !== "ARS") errors.push("currency_invalid");
  if (!args.signatureValid) errors.push("signature_invalid");
  if (!args.timestampFresh) errors.push("timestamp_stale");
  if (Math.abs(Number(args.amount || 0) - Number(args.expectedAmount || 0)) > 0.01) {
    errors.push("amount_mismatch");
  }
  return { ok: errors.length === 0, errors };
}
