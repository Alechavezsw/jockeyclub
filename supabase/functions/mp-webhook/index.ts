import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  currencyIsArs,
  isApprovedCreditStatus,
  isTennisCharge,
  moneyCentsEqual,
  paymentStatus,
  subscriptionDebitCredits,
} from "../_shared/mpSettlement.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const AR_TZ = "America/Argentina/Buenos_Aires";
const MONTHS_ES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

/** Mes de la cuota en el recibo: «Noviembre de 2026». */
function cuotaMonthParts(now = new Date()) {
  const iso = new Intl.DateTimeFormat("en-CA", {
    timeZone: AR_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const match = iso.match(/^(\d{4})-(\d{2})-/);
  if (!match) return null;
  return { year: match[1], month: match[2] };
}

function cuotaMonthPhrase(now = new Date()) {
  const parts = cuotaMonthParts(now);
  const name = parts ? MONTHS_ES[Number(parts.month) - 1] : "";
  return name && parts ? `${name} de ${parts.year}` : "";
}

function cuotaDueOn(now = new Date()) {
  const parts = cuotaMonthParts(now);
  return parts ? `${parts.year}-${parts.month}-10` : null;
}

function debitInstant(value: string) {
  const raw = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return new Date(`${raw}T12:00:00-03:00`);
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}
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

function escapeHtml(value: string) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function pdfSafe(value: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

/** Regla: todo cobro MP acreditado a socio lleva comprobante (cuota, débito, pileta, reserva). */
function shouldIssueMpDuesReceipt(kind: string) {
  const next = String(kind || "").toLowerCase();
  return next === "dues"
    || next === "subscription"
    || next === "pool"
    || next === "booking"
    || next === "reservation";
}

function mpReceiptChannelOf(meta: Record<string, unknown> = {}) {
  if (meta.from_subscription || meta.channel === "subscription") return "subscription";
  if (meta.channel === "onsite") return "onsite";
  return "online";
}

function mpReceiptChannelLabel(channel: string) {
  if (channel === "onsite") return "QR en el club";
  if (channel === "subscription") return "débito mensual";
  return "pago en Mi cuenta";
}

function mpReceiptMoney(amount: number) {
  const n = Number(amount);
  const safe = Number.isFinite(n) ? n : 0;
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(safe);
}

function mpReceiptDeliverableEmail(value: string | null | undefined) {
  const email = String(value || "").trim();
  if (!email.includes("@")) return "";
  const lower = email.toLowerCase();
  if (lower.includes("@lila-jockey")) return "";
  if (lower.endsWith("@jockeyclubsj.com")) return "";
  return email;
}

function longDate(iso: string) {
  const stamp = String(iso || "").slice(0, 10);
  const [y, m, d] = stamp.split("-").map(Number);
  if (!y || !m || !d) return stamp;
  const months = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
  ];
  return `${d} de ${months[m - 1]} de ${y}`;
}

function todayAR(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: AR_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function receiptCopy(input: {
  name: string;
  memberNumber: string;
  amount: number;
  receiptNumber: string;
  channel: string;
  date: string;
  concept: string;
  period: string;
  discount?: number;
  discountDetail?: string;
}) {
  const who = String(input.name || "socio").trim() || "socio";
  const via = mpReceiptChannelLabel(input.channel);
  const money = mpReceiptMoney(input.amount);
  const receipt = String(input.receiptNumber || "").trim() || "—";
  const conceptLabel = String(input.concept || "Cuota social").trim();
  const cut = Number(input.discount) || 0;
  const discountNote = String(input.discountDetail || "").trim();
  const discountLabel = cut > 0.009 ? `Descuento · ${discountNote || "mostrador"}` : "";
  const discountMoney = discountLabel ? mpReceiptMoney(cut) : "";
  const number = String(input.memberNumber || "").trim();
  const subject = "Comprobante de pago · Jockey Club San Juan";
  const greeting = `Hola ${who},`;
  const lead = `Acreditamos tu pago de ${conceptLabel} por Mercado Pago (${via}).`;
  const text = [
    greeting,
    "",
    lead,
    "",
    `Comprobante: ${receipt}`,
    `Importe: ${money}`,
    discountLabel ? `${discountLabel}: ${discountMoney}` : "",
    input.date ? `Fecha: ${input.date}` : "",
    input.period ? `Período: ${input.period}` : "",
    number ? `Socio Nº ${number}` : "",
    "",
    "Quedó asentado en tu cuenta. Conservá este comprobante.",
    PORTAL_ACCOUNT,
  ].filter(Boolean).join("\n");

  const row = (label: string, value: string) => {
    if (!value) return "";
    return `<tr>
    <td style="padding:7px 0;font-size:13px;color:#6a6156;width:42%;">${escapeHtml(label)}</td>
    <td style="padding:7px 0;font-size:14px;color:#1a1612;">${escapeHtml(value)}</td>
  </tr>`;
  };

  const html = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#efe6d4;font-family:Georgia,'Times New Roman',serif;color:#1a1612;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#efe6d4;padding:28px 12px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#fffdf8;border:1px solid #d8c7a4;">
        <tr>
          <td style="background:#096755;padding:28px 28px 22px;text-align:center;color:#fffdf8;">
            <p style="margin:0;font-size:11px;letter-spacing:0.22em;text-transform:uppercase;color:#d7c48a;">Comprobante de pago</p>
            <h1 style="margin:10px 0 0;font-size:26px;font-weight:normal;">Jockey Club San Juan</h1>
          </td>
        </tr>
        <tr>
          <td style="padding:28px;">
            <p style="margin:0 0 12px;font-size:18px;">${escapeHtml(greeting)}</p>
            <p style="margin:0 0 18px;font-size:15px;line-height:1.55;color:#3f3830;">${escapeHtml(lead)}</p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #eadcc0;border-bottom:1px solid #eadcc0;margin:0 0 22px;">
              ${row("Comprobante", receipt)}
              ${row("Importe", money)}
              ${row(discountLabel, discountMoney)}
              ${row("Concepto", conceptLabel)}
              ${row("Medio", `Mercado Pago · ${via}`)}
              ${row("Fecha", input.date)}
              ${row("Período", input.period)}
              ${row("Socio", number ? `Nº ${number}` : "")}
            </table>
            <table role="presentation" cellpadding="0" cellspacing="0">
              <tr><td style="background:#ca390c;border-radius:999px;">
                <a href="${PORTAL_ACCOUNT}" style="display:inline-block;padding:12px 22px;color:#fffdf8;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:14px;">Ver Mi cuenta</a>
              </td></tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:18px 28px 26px;border-top:1px solid #eadcc0;font-size:12px;color:#6a6156;">
            Jockey Club San Juan · República del Líbano 1799 Oeste, Rivadavia
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { subject, text, html, kind: "dues_receipt", receiptNumber: receipt, money, via, lead };
}

function buildReceiptPdf(lines: string[]) {
  const streamLines = [
    "BT",
    "/F1 18 Tf",
    "50 780 Td",
    `(${pdfSafe("Jockey Club San Juan")}) Tj`,
    "/F1 11 Tf",
    "0 -22 Td",
    `(${pdfSafe("Comprobante de pago")}) Tj`,
    "0 -28 Td",
    ...lines.map((line, i) => (i === 0 ? `(${pdfSafe(line)}) Tj` : `0 -16 Td (${pdfSafe(line)}) Tj`)),
    "ET",
  ];
  const stream = streamLines.join("\n");
  const objects = [
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n",
    "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj\n",
    `4 0 obj << /Length ${stream.length} >> stream\n${stream}\nendstream\nendobj\n`,
    "5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n",
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (const obj of objects) {
    offsets.push(body.length);
    body += obj;
  }
  const xrefStart = body.length;
  let xref = "xref\n0 6\n0000000000 65535 f \n";
  for (let i = 1; i <= 5; i += 1) {
    xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  body += xref;
  body += `trailer << /Size 6 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

function bytesToB64(bytes: Uint8Array) {
  let binary = "";
  const size = 0x8000;
  for (let i = 0; i < bytes.length; i += size) {
    binary += String.fromCharCode(...bytes.subarray(i, i + size));
  }
  return btoa(binary);
}

async function deliverMpReceipt(admin: Admin, intentId: string) {
  if (!intentId) return { skip: "no-intent" };

  const { data: intent } = await admin
    .from("mp_intents")
    .select("id, kind, status, amount, concept, member_id, member_number, applied_at, meta")
    .eq("id", intentId)
    .maybeSingle();

  if (!intent) return { skip: "missing" };
  const intentKind = String(intent.kind || "").toLowerCase();
  if (!shouldIssueMpDuesReceipt(intentKind)) return { skip: "kind" };
  if (!isApprovedCreditStatus(intent.status) || !intent.applied_at) return { skip: "not-applied" };

  // Cuota / débito: exentos nunca reciben comprobante de cuota.
  if ((intentKind === "dues" || intentKind === "subscription") && intent.member_id) {
    const { data: exempt } = await admin.rpc("member_id_is_dues_exempt", { mid: intent.member_id });
    if (exempt === true) return { skip: "dues-exempt" };
  }

  const meta = (intent.meta || {}) as Record<string, unknown>;
  const alreadyMessage = Boolean(meta.receipt_message_id);
  const alreadyEmail = Boolean(meta.receipt_email_id);
  const alreadyOpsNotice = Boolean(meta.ops_payment_notice_id);
  if (alreadyMessage && alreadyEmail && alreadyOpsNotice) return { skip: "already" };

  const { data: member } = await admin
    .from("members")
    .select("id, member_number, full_name, email, profile_id, meta")
    .eq("id", intent.member_id)
    .maybeSingle();

  const { data: payments } = await admin
    .from("member_payments")
    .select("id, amount, paid_at, receipt_number, concept, period_label, meta")
    .eq("member_id", intent.member_id)
    .order("paid_at", { ascending: false })
    .limit(24);

  const payment = (payments || []).find((row) => {
    const payMeta = (row.meta || {}) as Record<string, unknown>;
    return String(payMeta.mp_intent_id || "") === String(intent.id);
  });

  const receiptNumber = String(payment?.receipt_number || `MP-${String(intent.id).slice(0, 8)}`);
  const payMeta = (payment?.meta || {}) as Record<string, unknown>;
  const amount = Number(payment?.amount || intent.amount || 0);
  const discount = Number(payMeta.discount || meta.discount || 0);
  const discountDetail = String(payMeta.discountDetail || meta.discountDetail || "");
  const paidAt = String(payment?.paid_at || intent.applied_at || todayAR()).slice(0, 10);
  const period = String(payment?.period_label || "");
  const concept = String(payment?.concept || intent.concept || "Cuota social · Mercado Pago");
  const channel = mpReceiptChannelOf(meta);
  const memberNumber = String(member?.member_number || intent.member_number || "");
  const name = String(member?.full_name || "socio");
  const copy = receiptCopy({
    name,
    memberNumber,
    amount,
    receiptNumber,
    channel,
    date: longDate(paidAt),
    concept,
    period,
    discount,
    discountDetail,
  });

  let messageId = String(meta.receipt_message_id || "");
  let emailId = String(meta.receipt_email_id || "");
  let emailError = String(meta.receipt_email_error || "");
  let attachment: { name: string; path: string } | undefined;
  const filename = `recibo-${receiptNumber}.pdf`;

  if (!alreadyMessage || !alreadyEmail) {
    const pdf = buildReceiptPdf([
      copy.lead,
      `Comprobante: ${receiptNumber}`,
      `Importe: ${copy.money}`,
      discount > 0.009 ? `Descuento: ${mpReceiptMoney(discount)} ${discountDetail}`.trim() : "",
      `Concepto: ${concept}`,
      `Medio: Mercado Pago · ${copy.via}`,
      paidAt ? `Fecha: ${longDate(paidAt)}` : "",
      period ? `Periodo: ${period}` : "",
      memberNumber ? `Socio N ${memberNumber}` : "",
      name,
    ].filter(Boolean));

    const folder = String(member?.member_number || member?.profile_id || "").trim();
    if (folder && !alreadyMessage) {
      const path = `${folder}/${filename}`;
      const uploaded = await admin.storage.from("dues-receipts").upload(path, pdf, {
        contentType: "application/pdf",
        upsert: true,
      });
      if (!uploaded.error) attachment = { name: filename, path };
    }

    if (!alreadyMessage) {
      const recipient = memberNumber.replace(/[^a-zA-Z0-9._-]/g, "");
      if (recipient) {
        const inserted = await admin
          .from("messages")
          .insert({
            sender_name: "Secretaría del Jockey Club",
            sender_key: "ops",
            recipient_key: recipient,
            subject: copy.subject,
            body: copy.text,
            is_read: false,
            meta: {
              kind: copy.kind,
              method: "mercadopago",
              receiptNumber,
              mp_intent_id: intent.id,
              channel,
              ...(attachment ? { attachment } : {}),
            },
          })
          .select("id")
          .single();
        messageId = inserted.data?.id || "";
      }
    }

    const contact = String((member?.meta as Record<string, unknown> | null)?.contactEmail || "");
    const email = mpReceiptDeliverableEmail(member?.email) || mpReceiptDeliverableEmail(contact);
    if (!alreadyEmail) {
      const apiKey = Deno.env.get("RESEND_API_KEY") || "";
      if (!email) {
        emailId = "no-email";
        emailError = "Sin mail real";
      } else if (!apiKey) {
        emailError = "Falta RESEND_API_KEY";
      } else {
        const from = Deno.env.get("RESEND_FROM") || DEFAULT_FROM;
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "Idempotency-Key": `mp-receipt/${intent.id}`,
          },
          body: JSON.stringify({
            from,
            to: [email],
            subject: copy.subject,
            text: copy.text,
            html: copy.html,
            attachments: [{ filename, content: bytesToB64(pdf) }],
          }),
        });
        const payload = await res.json().catch(() => ({})) as { id?: string; message?: string };
        if (res.ok && payload.id) {
          emailId = payload.id;
          emailError = "";
        } else {
          emailError = String(payload.message || `Resend ${res.status}`);
        }
      }
    }
  }

  // Aviso a operaciones: la operación entra en «Pagos entrantes» aunque MP acredite solo.
  let opsNoticeId = String(meta.ops_payment_notice_id || "");
  if (!opsNoticeId) {
    const opsKind = intentKind === "booking" || intentKind === "reservation"
      ? "booking_payment"
      : "dues_payment";
    const opsSubject = opsKind === "booking_payment"
      ? "Operación Mercado Pago · reserva acreditada"
      : "Operación Mercado Pago · cuota acreditada";
    const opsBody = [
      `${name}${memberNumber ? ` (Nº ${memberNumber})` : ""} pagó por Mercado Pago desde la app.`,
      `Importe: ${copy.money}`,
      `Comprobante: ${receiptNumber}`,
      concept ? `Concepto: ${concept}` : "",
      period ? `Período: ${period}` : "",
      "Mercado Pago acredita solo: no hace falta imputar a mano.",
    ].filter(Boolean).join("\n");
    const opsInserted = await admin
      .from("messages")
      .insert({
        sender_name: name,
        sender_key: memberNumber.replace(/[^a-zA-Z0-9._-]/g, "") || null,
        recipient_key: "ops",
        subject: opsSubject,
        body: opsBody,
        is_read: false,
        meta: {
          kind: opsKind,
          method: "mercadopago",
          paymentAuto: true,
          paymentRequest: false,
          receiptNumber,
          mp_intent_id: intent.id,
          channel,
        },
      })
      .select("id")
      .single();
    opsNoticeId = opsInserted.data?.id || "";
  }

  const nextMeta = {
    ...meta,
    channel: meta.channel || channel,
    receipt_message_id: messageId || meta.receipt_message_id || null,
    receipt_email_id: emailId || meta.receipt_email_id || null,
    receipt_email_error: emailError || null,
    receipt_number: receiptNumber,
    ops_payment_notice_id: opsNoticeId || meta.ops_payment_notice_id || null,
  };
  await admin.from("mp_intents").update({ meta: nextMeta }).eq("id", intent.id);

  return {
    ok: true,
    receiptNumber,
    messageId: messageId || null,
    opsNoticeId: opsNoticeId || null,
    emailed: Boolean(emailId && emailId !== "no-email"),
    emailError: emailError || null,
  };
}

async function afterApprovedPayment(admin: Admin, intentId: string) {
  try {
    return await deliverMpReceipt(admin, intentId);
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
      const preapprovalId = String(pay.preapproval_id || "");
      const payment = pay.payment as {
        status?: string;
        id?: string;
        transaction_amount?: number;
        currency_id?: string;
        date_approved?: string;
      } | undefined;
      const paymentStatusValue = paymentStatus(payment?.status);
      const amount = Number(payment?.transaction_amount ?? pay.transaction_amount ?? 0);
      const currency = String(payment?.currency_id || pay.currency_id || "");
      if (!preapprovalId) return json(200, { ok: true, ignored: true });

      const { data: already } = await admin
        .from("mp_intents")
        .select("id, applied_at")
        .contains("meta", { authorized_payment_id: remoteId })
        .maybeSingle();
      if (already?.applied_at) return json(200, { ok: true, kind: "subscription_charge", already: true, applied: false });

      const { data: sub } = await admin
        .from("mp_intents")
        .select("*")
        .eq("preapproval_id", preapprovalId)
        .eq("kind", "subscription")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!sub) return json(200, { ok: true, ignored: true });
      if (sub.member_id) {
        const { data: exempt } = await admin.rpc("member_id_is_dues_exempt", { mid: sub.member_id });
        if (exempt === true) return json(200, { ok: true, ignored: true, reason: "exempt" });
      }

      const debitWhen = String(payment?.date_approved || pay.debit_date || pay.date_created || "");
      const periodDate = debitInstant(debitWhen);

      const { data: charge, error: chargeErr } = already?.id
        ? { data: { id: already.id }, error: null }
        : await admin
          .from("mp_intents")
          .insert({
            kind: "dues",
            status: "pending",
            member_id: sub.member_id,
            member_number: sub.member_number,
            amount: amount > 0 ? amount : sub.amount,
            concept: `Cuota social · ${cuotaMonthPhrase(periodDate)}`,
            payer_email: sub.payer_email,
            external_reference: crypto.randomUUID(),
            preapproval_id: preapprovalId,
            meta: {
              from_subscription: sub.id,
              authorized_payment_id: remoteId,
              channel: "subscription",
              periodDueOn: cuotaDueOn(periodDate),
              chargeScope: "cuota_social",
            },
          })
          .select("id")
          .single();
      if (chargeErr || !charge) return json(500, { error: chargeErr?.message || "No se pudo anotar el débito." });

      if (!subscriptionDebitCredits(paymentStatusValue)) {
        const { error } = await admin.rpc("apply_mp_approved_payment", {
          p_intent_id: charge.id,
          p_provider_payment_id: String(payment?.id || remoteId),
          p_status: paymentStatusValue || "pending",
          p_paid_amount: amount,
        });
        if (error) return json(500, { error: error.message });
        if (paymentStatusValue === "rejected" || paymentStatusValue === "cancelled") {
          const notice = await notifyDebitFailed(admin, sub, {
            status: paymentStatusValue,
            amount: amount || Number(sub.amount) || 0,
          });
          return json(200, { ok: true, kind: "subscription_charge_failed", status: paymentStatusValue, applied: false, notice });
        }
        return json(200, {
          ok: true,
          kind: "subscription_charge_open",
          status: paymentStatusValue || "pending",
          applied: false,
        });
      }

      const applied = await applyCheckoutPayment(
        admin,
        String(charge.id),
        String(payment?.id || remoteId),
        "approved",
        amount,
        currency,
      );
      if (applied.error) {
        return json(applied.permanent ? 200 : 500, { error: applied.error, ...applied });
      }
      return json(200, { ok: true, kind: "subscription_charge", ...applied });
    }

    const result = await applyPaymentId(admin, token, remoteId);
    if (result.error) return json(result.permanent ? 200 : 500, { error: result.error, ...result });
    return json(200, result);
  } catch (err) {
    return json(500, { error: err instanceof Error ? err.message : "Webhook Mercado Pago falló." });
  }
});
