import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

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
  if (!res.ok) throw new Error(String(data?.message || `Mercado Pago ${res.status}`));
  return data as Record<string, unknown>;
}

function topicOf(body: Record<string, unknown>, url: URL) {
  return String(body.type || body.topic || url.searchParams.get("type") || url.searchParams.get("topic") || "").toLowerCase();
}

function idOf(body: Record<string, unknown>, url: URL) {
  const data = body.data as { id?: string } | undefined;
  return String(data?.id || body.id || url.searchParams.get("id") || url.searchParams.get("data.id") || "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS" || req.method === "GET" || req.method === "HEAD") {
    return json(200, { ok: true });
  }
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const token = Deno.env.get("MP_ACCESS_TOKEN") || "";
    if (!supabaseUrl || !serviceKey || !token) return json(500, { error: "Falta la configuración." });

    const url = new URL(req.url);
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const topic = topicOf(body, url);
    const remoteId = idOf(body, url);
    if (!remoteId) return json(200, { ok: true, ignored: true });

    const admin = createClient(supabaseUrl, serviceKey);

    if (String(remoteId).startsWith("ORD") || (topic.includes("order") && !topic.includes("merchant"))) {
      const order = await mpGet(`/v1/orders/${remoteId}`, token);
      const intentId = String(order.external_reference || "");
      if (!intentId) return json(200, { ok: true, ignored: true });
      const payments = (order.transactions as { payments?: Array<Record<string, unknown>> } | undefined)?.payments || [];
      const pay = payments[0] || {};
      const rawStatus = String(pay.status || order.status || "pending");
      const status = /process|paid|accredit|approv/i.test(rawStatus) ? "approved" : rawStatus;
      const { error } = await admin.rpc("apply_mp_approved_payment", {
        p_intent_id: intentId,
        p_provider_payment_id: String(pay.id || remoteId),
        p_status: status,
        p_paid_amount: Number(pay.amount || order.total_amount || 0),
      });
      if (error) return json(500, { error: error.message });
      return json(200, { ok: true, kind: "qr_order" });
    }

    if (topic.includes("preapproval") && !topic.includes("authorized_payment")) {
      const pre = await mpGet(`/preapproval/${remoteId}`, token);
      const intentId = String(pre.external_reference || "");
      if (!intentId) return json(200, { ok: true, ignored: true });
      const { error } = await admin.rpc("apply_mp_subscription", {
        p_intent_id: intentId,
        p_preapproval_id: String(pre.id || remoteId),
        p_status: String(pre.status || "authorized"),
      });
      if (error) return json(500, { error: error.message });
      return json(200, { ok: true, kind: "subscription" });
    }

    if (topic.includes("authorized_payment") || topic.includes("subscription_authorized")) {
      const pay = await mpGet(`/authorized_payments/${remoteId}`, token);
      const preapprovalId = String(pay.preapproval_id || "");
      const payment = pay.payment as { status?: string; id?: string; transaction_amount?: number } | undefined;
      const status = String(payment?.status || pay.status || "");
      const amount = Number(pay.transaction_amount || payment?.transaction_amount || 0);
      if (!preapprovalId) return json(200, { ok: true, ignored: true });

      const { data: sub } = await admin
        .from("mp_intents")
        .select("*")
        .eq("preapproval_id", preapprovalId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!sub) return json(200, { ok: true, ignored: true });

      const { data: charge, error: chargeErr } = await admin
        .from("mp_intents")
        .insert({
          kind: "dues",
          status: "pending",
          member_id: sub.member_id,
          member_number: sub.member_number,
          amount: amount || sub.amount,
          concept: "Cuota social · débito Mercado Pago",
          payer_email: sub.payer_email,
          external_reference: crypto.randomUUID(),
          preapproval_id: preapprovalId,
          meta: { from_subscription: sub.id, authorized_payment_id: remoteId },
        })
        .select("id")
        .single();
      if (chargeErr || !charge) return json(500, { error: chargeErr?.message || "No se pudo anotar el débito." });

      const { error } = await admin.rpc("apply_mp_approved_payment", {
        p_intent_id: charge.id,
        p_provider_payment_id: String(payment?.id || remoteId),
        p_status: status || "approved",
        p_paid_amount: amount || sub.amount,
      });
      if (error) return json(500, { error: error.message });
      return json(200, { ok: true, kind: "subscription_charge" });
    }

    const payment = await mpGet(`/v1/payments/${remoteId}`, token);
    const metadata = payment.metadata as { intent_id?: string } | undefined;
    const intentId = String(payment.external_reference || metadata?.intent_id || "");
    if (!intentId) return json(200, { ok: true, ignored: true });

    const { error } = await admin.rpc("apply_mp_approved_payment", {
      p_intent_id: intentId,
      p_provider_payment_id: String(payment.id || remoteId),
      p_status: String(payment.status || "pending"),
      p_paid_amount: Number(payment.transaction_amount || 0),
    });
    if (error) return json(500, { error: error.message });
    return json(200, { ok: true, kind: "payment" });
  } catch (err) {
    return json(500, { error: err instanceof Error ? err.message : "Webhook Mercado Pago falló." });
  }
});
