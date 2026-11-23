import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  currencyIsArs,
  isApprovedCreditStatus,
  moneyCentsEqual,
  paymentStatus,
} from "../_shared/mpSettlement.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function mpGet(path: string, token: string) {
  const res = await fetch(`https://api.mercadopago.com${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(String((data as { message?: string }).message || `Mercado Pago ${res.status}`));
  return data as Record<string, unknown>;
}

async function resolveIntentId(admin: ReturnType<typeof createClient>, ref: string) {
  const raw = String(ref || "").trim();
  if (!raw) return "";
  const { data: byId } = await admin.from("mp_intents").select("id").eq("id", raw).maybeSingle();
  if (byId?.id) return String(byId.id);
  const { data: byExt } = await admin.from("mp_intents").select("id").eq("external_reference", raw).maybeSingle();
  if (byExt?.id) return String(byExt.id);
  return raw;
}

async function applyOne(
  admin: ReturnType<typeof createClient>,
  intentId: string,
  providerPaymentId: string,
  status: string,
  paidAmount: number,
  currency: string,
) {
  const resolved = await resolveIntentId(admin, intentId);
  if (isApprovedCreditStatus(status)) {
    if (!currencyIsArs(currency)) {
      return { intentId: resolved, applied: false, error: "Solo se acepta ARS." };
    }
    const { data: intent } = await admin.from("mp_intents").select("amount").eq("id", resolved).maybeSingle();
    if (!moneyCentsEqual(intent?.amount, paidAmount)) {
      return { intentId: resolved, applied: false, error: "Monto incorrecto." };
    }
  }
  const { data, error } = await admin.rpc("apply_mp_approved_payment", {
    p_intent_id: resolved,
    p_provider_payment_id: providerPaymentId,
    p_status: isApprovedCreditStatus(status) ? "approved" : paymentStatus(status),
    p_paid_amount: paidAmount,
  });
  if (error) return { intentId: resolved, error: error.message };
  return { intentId: resolved, applied: data };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json(200, { ok: true });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const token = Deno.env.get("MP_ACCESS_TOKEN") || "";
    if (!supabaseUrl || !serviceKey) return json(500, { error: "Falta Supabase." });
    if (!token) return json(503, { error: "Falta MP_ACCESS_TOKEN." });

    const auth = String(req.headers.get("Authorization") || "");
    if (auth !== `Bearer ${serviceKey}`) return json(401, { error: "No autorizado." });

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const admin = createClient(supabaseUrl, serviceKey);
    const results: Array<Record<string, unknown>> = [];

    const paymentIds = Array.isArray(body.paymentIds)
      ? body.paymentIds.map((id) => String(id || "").trim()).filter(Boolean)
      : [];
    const merchantOrderIds = Array.isArray(body.merchantOrderIds)
      ? body.merchantOrderIds.map((id) => String(id || "").trim()).filter(Boolean)
      : [];

    for (const id of paymentIds) {
      try {
        const payment = await mpGet(`/v1/payments/${id}`, token);
        const intentId = String(
          payment.external_reference
            || (payment.metadata as { intent_id?: string } | undefined)?.intent_id
            || "",
        );
        if (!intentId) {
          results.push({ paymentId: id, skipped: true, reason: "sin-intent" });
          continue;
        }
        results.push({
          paymentId: id,
          ...await applyOne(
            admin,
            intentId,
            String(payment.id || id),
            isApprovedCreditStatus(payment.status) ? "approved" : paymentStatus(payment.status),
            Number(payment.transaction_amount || 0),
            String(payment.currency_id || ""),
          ),
        });
      } catch (err) {
        results.push({ paymentId: id, error: err instanceof Error ? err.message : "falló" });
      }
    }

    for (const id of merchantOrderIds) {
      try {
        const order = await mpGet(`/merchant_orders/${id}`, token);
        const payments = Array.isArray(order.payments)
          ? (order.payments as Array<Record<string, unknown>>)
          : [];
        const pick = payments.find((row) => isApprovedCreditStatus(row.status)) || payments[0];
        if (!pick?.id) {
          results.push({ merchantOrderId: id, skipped: true, reason: "sin-pago" });
          continue;
        }
        const payment = await mpGet(`/v1/payments/${pick.id}`, token);
        const intentId = String(payment.external_reference || order.external_reference || "");
        if (!intentId) {
          results.push({ merchantOrderId: id, skipped: true, reason: "sin-intent" });
          continue;
        }
        results.push({
          merchantOrderId: id,
          ...await applyOne(
            admin,
            intentId,
            String(payment.id || pick.id),
            isApprovedCreditStatus(payment.status || pick.status) ? "approved" : paymentStatus(payment.status || pick.status),
            Number(payment.transaction_amount || pick.transaction_amount || 0),
            String(payment.currency_id || pick.currency_id || order.currency_id || ""),
          ),
        });
      } catch (err) {
        results.push({ merchantOrderId: id, error: err instanceof Error ? err.message : "falló" });
      }
    }

    if (!paymentIds.length && !merchantOrderIds.length) {
      const { data: pending } = await admin
        .from("mp_intents")
        .select("id, amount, status, applied_at")
        .is("applied_at", null)
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(40);
      for (const intent of pending || []) {
        try {
          const search = await mpGet(
            `/v1/payments/search?sort=date_created&criteria=desc&external_reference=${encodeURIComponent(String(intent.id))}&range=date_created&begin_date=NOW-90DAYS&end_date=NOW`,
            token,
          );
          const rows = Array.isArray((search as { results?: unknown[] }).results)
            ? (search as { results: Array<Record<string, unknown>> }).results
            : [];
          const approved = rows.find((row) => isApprovedCreditStatus(row.status));
          if (!approved?.id) {
            results.push({ intentId: intent.id, skipped: true, reason: "sin-pago-aprobado" });
            continue;
          }
          results.push({
            intentId: intent.id,
            ...await applyOne(
              admin,
              String(intent.id),
              String(approved.id),
              "approved",
              Number(approved.transaction_amount || 0),
              String(approved.currency_id || ""),
            ),
          });
        } catch (err) {
          results.push({ intentId: intent.id, error: err instanceof Error ? err.message : "falló" });
        }
      }
    }

    return json(200, { ok: true, count: results.length, results });
  } catch (err) {
    return json(500, { error: err instanceof Error ? err.message : "mp-repair falló" });
  }
});
