import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  currencyIsArs,
  isApprovedCreditStatus,
  isSubscriptionAdhesionIntent,
  isTennisCharge,
  moneyCentsEqual,
  paymentStatus,
} from "../_shared/mpSettlement.js";
import { settleSubscriptionCharge } from "../_shared/mpSubscriptionCharge.js";
import { settleMpReceipt } from "../_shared/mpReceiptJob.js";
import { deliverMpReceipt, mpReceiptDeliverableEmail, mpReceiptMoney } from "../_shared/mpReceiptDelivery.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PORTAL_ACCOUNT = "https://www.jockeyclubsj.com.ar/cuenta";
const DEFAULT_FROM = "Jockey Club San Juan <socios@jockeyclubsj.com.ar>";

type Admin = ReturnType<typeof createClient>;

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

function hexOf(buffer: ArrayBuffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function sameHex(left: string, right: string) {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

/** Id que Mercado Pago firma: `data.id` (nuevo), `id` (IPN viejo), o el del cuerpo. */
function signedResourceId(req: Request, rawBody: string) {
  const url = new URL(req.url);
  const fromQuery = url.searchParams.get("data.id")
    || url.searchParams.get("id")
    || "";
  if (fromQuery.trim()) return fromQuery.trim();
  try {
    const parsed = JSON.parse(rawBody || "{}") as { data?: { id?: string | number }; id?: string | number };
    return String(parsed?.data?.id || parsed?.id || "").trim();
  } catch {
    return "";
  }
}

async function resolveIntentId(admin: Admin, ref: string) {
  const raw = String(ref || "").trim();
  if (!raw) return "";
  const { data: byId } = await admin.from("mp_intents").select("id").eq("id", raw).maybeSingle();
  if (byId?.id) return String(byId.id);
  const { data: byExt } = await admin
    .from("mp_intents")
    .select("id")
    .eq("external_reference", raw)
    .maybeSingle();
  if (byExt?.id) return String(byExt.id);
  return raw;
}

async function applyCheckoutPayment(
  admin: Admin,
  intentId: string,
  providerPaymentId: string,
  status: string,
  paidAmount: number,
  currency?: string,
) {
  const resolved = await resolveIntentId(admin, intentId);
  if (!resolved) return { error: "Sin cobro vinculado." };

  const { data: intent } = await admin
    .from("mp_intents")
    .select("id, kind, amount, concept, status, applied_at, provider_payment_id, member_id, meta")
    .eq("id", resolved)
    .maybeSingle();

  if (!intent) return { error: "Intent no encontrado.", intentId: resolved };

  if (intent.applied_at) {
    if (isApprovedCreditStatus(intent.status)) {
      const receipt = await afterApprovedPayment(admin, resolved);
      return { ok: true, already: true, applied: false, intentId: resolved, receipt };
    }
    return { ok: true, already: true, applied: false, intentId: resolved };
  }

  if (providerPaymentId) {
    const { data: existingPayment } = await admin
      .from("mp_intents")
      .select("id")
      .eq("provider_payment_id", providerPaymentId)
      .neq("id", resolved)
      .maybeSingle();
    if (existingPayment) {
      console.error(`Duplicate provider_payment_id ${providerPaymentId} on intent ${existingPayment.id}`);
      return { error: "Este pago ya fue aplicado a otro cobro.", intentId: resolved, duplicate: true, permanent: true };
    }
  }

  const creditStatus = paymentStatus(status);
  const intentMeta = (intent.meta || {}) as Record<string, unknown>;
  const socialKinds = new Set(["dues", "subscription"]);
  if (
    socialKinds.has(String(intent.kind || "").toLowerCase())
    && isTennisCharge(intent.concept, intentMeta.chargeScope)
  ) {
    return {
      error: "Un cobro de cuota social no puede imputar el abono de tenis.",
      intentId: resolved,
      permanent: true,
    };
  }

  if (!isApprovedCreditStatus(creditStatus)) {
    const { error } = await admin.rpc("apply_mp_approved_payment", {
      p_intent_id: resolved,
      p_provider_payment_id: providerPaymentId,
      p_status: creditStatus || "pending",
      p_paid_amount: paidAmount,
    });
    if (error) return { error: error.message, intentId: resolved };
    return { ok: true, applied: false, status: creditStatus || "pending", intentId: resolved };
  }

  if (!currencyIsArs(currency)) {
    console.error(`Payment ${providerPaymentId}: unexpected currency ${currency || "(vacía)"}`);
    return {
      error: "Solo se acepta ARS.",
      intentId: resolved,
      permanent: true,
    };
  }

  const expectedAmount = Number(intent.amount || 0);
  if (!moneyCentsEqual(expectedAmount, paidAmount)) {
    console.error(`Payment ${providerPaymentId}: expected ${expectedAmount} ARS, got ${paidAmount} ARS`);
    return {
      error: `Monto incorrecto: esperado $${expectedAmount}, recibido $${paidAmount}.`,
      intentId: resolved,
      expectedAmount,
      paidAmount,
      permanent: true,
    };
  }

  const { data, error } = await admin.rpc("apply_mp_approved_payment", {
    p_intent_id: resolved,
    p_provider_payment_id: providerPaymentId,
    p_status: "approved",
    p_paid_amount: paidAmount,
  });
  if (error) return { error: error.message, intentId: resolved };
  const applied = Boolean((data as { applied?: boolean } | null)?.applied);
  if (!applied) return { ok: true, applied: false, intentId: resolved, detail: data };
  const receipt = await afterApprovedPayment(admin, resolved);
  return { ok: true, applied: true, intentId: resolved, receipt };
}

/** Preferencias / Checkout Pro: merchant_order → pagos. */
async function applyMerchantOrder(admin: Admin, token: string, remoteId: string) {
  const order = await mpGet(`/merchant_orders/${remoteId}`, token);
  const payments = Array.isArray(order.payments)
    ? (order.payments as Array<Record<string, unknown>>)
    : [];
  const pick = payments.find((row) => mpPaidStatus(row.status) === "approved")
    || payments.find((row) => mpApiStatus(row.status))
    || null;
  if (!pick?.id) {
    return { ok: true, ignored: true, reason: "no-payment", orderId: remoteId };
  }
  const payment = await mpGet(`/v1/payments/${pick.id}`, token);
  const intentId = String(
    payment.external_reference
    || order.external_reference
    || (payment.metadata as { intent_id?: string } | undefined)?.intent_id
    || "",
  );
  const status = mpPaidStatus(payment.status || pick.status) || "pending";
  const paidAmount = Number(payment.transaction_amount || pick.transaction_amount || 0);
  const currency = String(payment.currency_id || order.currency_id || "");
  if (!intentId) return { ok: true, ignored: true, reason: "no-intent", orderId: remoteId };
  const applied = await applyCheckoutPayment(
    admin,
    intentId,
    String(payment.id || pick.id),
    status,
    paidAmount,
    currency,
  );
  return { ok: true, kind: "merchant_order", orderId: remoteId, ...applied };
}

async function applyPaymentId(admin: Admin, token: string, remoteId: string) {
  const payment = await mpGet(`/v1/payments/${remoteId}`, token);
  const metadata = payment.metadata as { intent_id?: string } | undefined;
  const intentId = String(payment.external_reference || metadata?.intent_id || "");
  const paymentStatus = mpApiStatus(payment.status);
  const currency = String(payment.currency_id || "");
  if (!intentId || !paymentStatus) return { ok: true, ignored: true };
  return {
    ok: true,
    kind: "payment",
    ...await applyCheckoutPayment(
      admin,
      intentId,
      String(payment.id || remoteId),
      paymentStatus,
      Number(payment.transaction_amount || 0),
      currency,
    ),
  };
}

/** Repara intents pending buscando el pago aprobado en Mercado Pago. */
async function repairPendingIntents(admin: Admin, token: string, body: Record<string, unknown>) {
  const results: Array<Record<string, unknown>> = [];
  const paymentIds = Array.isArray(body.paymentIds)
    ? body.paymentIds.map((id) => String(id || "").trim()).filter(Boolean)
    : [];
  const merchantOrderIds = Array.isArray(body.merchantOrderIds)
    ? body.merchantOrderIds.map((id) => String(id || "").trim()).filter(Boolean)
    : [];

  for (const id of paymentIds) {
    try {
      results.push(await applyPaymentId(admin, token, id));
    } catch (err) {
      results.push({ paymentId: id, error: err instanceof Error ? err.message : "falló" });
    }
  }
  for (const id of merchantOrderIds) {
    try {
      results.push(await applyMerchantOrder(admin, token, id));
    } catch (err) {
      results.push({ merchantOrderId: id, error: err instanceof Error ? err.message : "falló" });
    }
  }

  if (!paymentIds.length && !merchantOrderIds.length) {
    const { data: pending } = await admin
      .from("mp_intents")
      .select("id, kind, amount, status, applied_at, preference_id, created_at")
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
          ? ((search as { results: Array<Record<string, unknown>> }).results)
          : [];
        const approved = rows.find((row) => mpPaidStatus(row.status) === "approved");
        if (!approved?.id) {
          results.push({ intentId: intent.id, skipped: true, reason: "sin-pago-aprobado" });
          continue;
        }
        results.push({
          intentId: intent.id,
          ...await applyCheckoutPayment(
            admin,
            String(intent.id),
            String(approved.id),
            "approved",
            Number(approved.transaction_amount || 0),
            String(approved.currency_id || ""),
          ),
        });
      } catch (err) {
        results.push({
          intentId: intent.id,
          error: err instanceof Error ? err.message : "falló",
        });
      }
    }
  }

  return { ok: true, kind: "repair", count: results.length, results };
}

const SIGNATURE_TIMESTAMP_TOLERANCE_SECONDS = 300;

type SignatureValidationResult = {
  valid: boolean;
  reason?: string;
};

async function mpSignatureOk(req: Request, rawBody: string, secret: string): Promise<SignatureValidationResult> {
  const header = String(req.headers.get("x-signature") || "").trim();
  const requestId = String(req.headers.get("x-request-id") || "").trim();
  if (!header) return { valid: false, reason: "missing-header" };
  if (!secret) return { valid: false, reason: "missing-secret" };

  const parts: Record<string, string> = {};
  for (const chunk of header.split(",")) {
    const [key, ...rest] = chunk.split("=");
    if (key) parts[key.trim()] = rest.join("=").trim();
  }
  const ts = parts.ts || "";
  const hash = String(parts.v1 || "").toLowerCase();
  const dataId = signedResourceId(req, rawBody).toLowerCase();
  if (!ts) return { valid: false, reason: "missing-timestamp" };
  if (!hash) return { valid: false, reason: "missing-hash" };
  if (!dataId) return { valid: false, reason: "missing-data-id" };

  const tsNum = parseInt(ts, 10);
  if (Number.isNaN(tsNum)) return { valid: false, reason: "invalid-timestamp" };

  const nowSeconds = Math.floor(Date.now() / 1000);
  const age = nowSeconds - tsNum;
  if (age < -60) return { valid: false, reason: "timestamp-in-future" };
  if (age > SIGNATURE_TIMESTAMP_TOLERANCE_SECONDS) return { valid: false, reason: "timestamp-expired" };

  const chunks = [`id:${dataId}`];
  if (requestId) chunks.push(`request-id:${requestId}`);
  chunks.push(`ts:${ts}`);
  const manifest = `${chunks.join(";")};`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(manifest));
  if (!sameHex(hexOf(signed), hash)) return { valid: false, reason: "signature-mismatch" };

  return { valid: true };
}

/** Estado tal como lo devolvió la API. Nunca se inventa "approved". */
function mpApiStatus(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function mpPaidStatus(value: unknown) {
  const status = mpApiStatus(value);
  return isApprovedCreditStatus(status) ? "approved" : status;
}

async function afterApprovedPayment(admin: Admin, intentId: string) {
  try {
    return await settleMpReceipt({
      admin,
      intentId,
      deliver: (prior) => deliverMpReceipt(admin, intentId, prior),
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo emitir el comprobante." };
  }
}

async function notifyDebitFailed(
  admin: Admin,
  sub: { member_id?: string | null; member_number?: string | null; payer_email?: string | null },
  { status, amount }: { status: string; amount: number },
) {
  const memberId = String(sub.member_id || "");
  let email = mpReceiptDeliverableEmail(sub.payer_email);
  let name = "socio";
  let memberNumber = String(sub.member_number || "");

  if (memberId) {
    const { data: member } = await admin
      .from("members")
      .select("id, member_number, full_name, email, meta")
      .eq("id", memberId)
      .maybeSingle();
    if (member) {
      name = String(member.full_name || name);
      memberNumber = String(member.member_number || memberNumber);
      email = mpReceiptDeliverableEmail(member.email) || email;
      const meta = { ...((member.meta || {}) as Record<string, unknown>) };
      meta.lastDebitFailedAt = new Date().toISOString();
      meta.lastDebitStatus = status;
      await admin.from("members").update({ meta }).eq("id", member.id);
    }
  }

  const money = amount ? mpReceiptMoney(amount) : "";
  const subject = "No pasó el débito de tu cuota";
  const text = [
    `Hola ${name},`,
    "",
    "No pasó el débito automático de tu cuota.",
    money ? `Importe: ${money}` : "",
    memberNumber ? `Socio Nº ${memberNumber}` : "",
    "",
    "Entrá a Mi cuenta para regularizarlo:",
    PORTAL_ACCOUNT,
  ].filter(Boolean).join("\n");

  const recipient = memberNumber.replace(/[^a-zA-Z0-9._-]/g, "");
  if (recipient) {
    await admin.from("messages").insert({
      sender_name: "Secretaría del Jockey Club",
      sender_key: "ops",
      recipient_key: recipient,
      subject,
      body: text,
      is_read: false,
      meta: { kind: "dues_debit_failed", status },
    });
  }

  const apiKey = Deno.env.get("RESEND_API_KEY") || "";
  const from = Deno.env.get("RESEND_FROM") || DEFAULT_FROM;
  if (email && apiKey) {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `mp-debit-failed/${memberId || memberNumber}/${todayAR()}`,
      },
      body: JSON.stringify({ from, to: [email], subject, text }),
    });
  }

  return { emailed: Boolean(email && apiKey), memberNumber };
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
    if (!supabaseUrl || !serviceKey) return json(500, { error: "Falta la configuración de Supabase." });
    if (!token) return json(503, { error: "Falta MP_ACCESS_TOKEN en las secretas de Supabase." });

    const secret = Deno.env.get("MP_WEBHOOK_SECRET") || "";
    const url = new URL(req.url);
    const rawBody = await req.text();
    const body = (() => {
      try { return JSON.parse(rawBody || "{}") as Record<string, unknown>; }
      catch { return {} as Record<string, unknown>; }
    })();
    const admin = createClient(supabaseUrl, serviceKey);

    // Reconcile interno (service role): acredita pagos QR/app que el webhook no impactó.
    if (body.repair === true) {
      const auth = String(req.headers.get("Authorization") || "");
      if (auth !== `Bearer ${serviceKey}`) {
        return json(401, { error: "No autorizado." });
      }
      return json(200, await repairPendingIntents(admin, token, body));
    }

    const sigResult = await mpSignatureOk(req, rawBody, secret);
    if (!sigResult.valid) {
      console.error(`Webhook signature validation failed: ${sigResult.reason}`);
      return json(401, { error: "Firma inválida." });
    }
    const topic = topicOf(body, url);
    const remoteId = signedResourceId(req, rawBody);
    if (!remoteId) return json(401, { error: "Firma inválida." });

    // Checkout Pro / preferencias de la app: merchant_order (numérico).
    if (topic.includes("merchant_order") || topic.includes("topic_merchant_order")) {
      const result = await applyMerchantOrder(admin, token, remoteId);
      if (result.error) return json(result.permanent ? 200 : 500, { error: result.error, ...result });
      return json(200, result);
    }

    if (remoteId.toLowerCase().startsWith("ord") || (topic.includes("order") && !topic.includes("merchant"))) {
      const order = await mpGet(`/v1/orders/${remoteId}`, token);
      const intentId = String(order.external_reference || "");
      if (!intentId) return json(200, { ok: true, ignored: true });
      const payments = (order.transactions as { payments?: Array<Record<string, unknown>> } | undefined)?.payments || [];
      const pay = payments[0] || {};
      const status = mpPaidStatus(pay.status || order.status) || "pending";
      const currency = String((pay as Record<string, unknown>).currency_id || order.currency_id || "");
      const applied = await applyCheckoutPayment(
        admin,
        intentId,
        String(pay.id || remoteId),
        status,
        Number(pay.amount || order.total_amount || 0),
        currency,
      );
      if (applied.error) return json(applied.permanent ? 200 : 500, { error: applied.error, ...applied });
      return json(200, { ok: true, kind: "qr_order", ...applied });
    }

    if (topic.includes("preapproval") && !topic.includes("authorized_payment")) {
      const pre = await mpGet(`/preapproval/${remoteId}`, token);
      const intentId = String(pre.external_reference || "");
      const preStatus = mpApiStatus(pre.status);
      if (!intentId || !preStatus) return json(200, { ok: true, ignored: true });
      const { data: adhesion } = await admin
        .from("mp_intents")
        .select("id, kind, member_id")
        .eq("id", intentId)
        .maybeSingle();
      if (!isSubscriptionAdhesionIntent(adhesion)) {
        return json(200, { ok: true, ignored: true, reason: "not-subscription" });
      }
      const { error } = await admin.rpc("apply_mp_subscription", {
        p_intent_id: intentId,
        p_preapproval_id: String(pre.id || remoteId),
        p_status: preStatus,
      });
      if (error) return json(500, { error: error.message });
      return json(200, { ok: true, kind: "subscription" });
    }

    if (topic.includes("authorized_payment") || topic.includes("subscription_authorized")) {
      const pay = await mpGet(`/authorized_payments/${remoteId}`, token);
      const settled = await settleSubscriptionCharge({
        admin,
        remoteId,
        pay,
        applyCheckoutPayment: (intentId, providerId, status, paidAmount, currency) => (
          applyCheckoutPayment(admin, intentId, providerId, status, paidAmount, currency)
        ),
        notifyDebitFailed: (subscription, info) => notifyDebitFailed(admin, subscription, info),
      });
      return json(settled.http, settled.body);
    }

    const result = await applyPaymentId(admin, token, remoteId);
    if (result.error) return json(result.permanent ? 200 : 500, { error: result.error, ...result });
    return json(200, result);
  } catch (err) {
    return json(500, { error: err instanceof Error ? err.message : "Webhook Mercado Pago falló." });
  }
});
