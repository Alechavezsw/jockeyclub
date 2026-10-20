import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const AR_TZ = "America/Argentina/San_Juan";
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

async function mpSignatureOk(req: Request, rawBody: string, secret: string) {
  const header = String(req.headers.get("x-signature") || "");
  const requestId = String(req.headers.get("x-request-id") || "");
  if (!header || !secret) return true;
  const parts: Record<string, string> = {};
  for (const chunk of header.split(",")) {
    const [key, ...rest] = chunk.split("=");
    if (key) parts[key.trim()] = rest.join("=").trim();
  }
  const ts = parts.ts || "";
  const hash = String(parts.v1 || "").toLowerCase();
  if (!ts || !hash) return false;
  let dataId = "";
  try {
    const parsed = JSON.parse(rawBody) as { data?: { id?: string }; id?: string };
    dataId = String(parsed?.data?.id || parsed?.id || "");
  } catch {
    dataId = "";
  }
  const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(manifest));
  return hexOf(signed) === hash;
}

function idOf(body: Record<string, unknown>, url: URL) {
  const data = body.data as { id?: string } | undefined;
  return String(data?.id || body.id || url.searchParams.get("id") || url.searchParams.get("data.id") || "");
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

function shouldIssueMpDuesReceipt(kind: string) {
  const next = String(kind || "").toLowerCase();
  return next === "dues" || next === "subscription";
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

function arISODate(date = new Date()) {
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
}) {
  const who = String(input.name || "socio").trim() || "socio";
  const via = mpReceiptChannelLabel(input.channel);
  const money = mpReceiptMoney(input.amount);
  const receipt = String(input.receiptNumber || "").trim() || "—";
  const conceptLabel = String(input.concept || "Cuota social").trim();
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
  if (!shouldIssueMpDuesReceipt(String(intent.kind || ""))) return { skip: "kind" };
  if (!intent.applied_at) return { skip: "not-applied" };

  const meta = (intent.meta || {}) as Record<string, unknown>;
  const alreadyMessage = Boolean(meta.receipt_message_id);
  const alreadyEmail = Boolean(meta.receipt_email_id);
  if (alreadyMessage && alreadyEmail) return { skip: "already" };

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
  const amount = Number(payment?.amount || intent.amount || 0);
  const paidAt = String(payment?.paid_at || intent.applied_at || arISODate()).slice(0, 10);
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
  });

  const pdf = buildReceiptPdf([
    copy.lead,
    `Comprobante: ${receiptNumber}`,
    `Importe: ${copy.money}`,
    `Concepto: ${concept}`,
    `Medio: Mercado Pago · ${copy.via}`,
    paidAt ? `Fecha: ${longDate(paidAt)}` : "",
    period ? `Periodo: ${period}` : "",
    memberNumber ? `Socio N ${memberNumber}` : "",
    name,
  ].filter(Boolean));
  const filename = `recibo-${receiptNumber}.pdf`;

  let attachment: { name: string; path: string } | undefined;
  const folder = String(member?.member_number || member?.profile_id || "").trim();
  if (folder && !alreadyMessage) {
    const path = `${folder}/${filename}`;
    const uploaded = await admin.storage.from("dues-receipts").upload(path, pdf, {
      contentType: "application/pdf",
      upsert: true,
    });
    if (!uploaded.error) attachment = { name: filename, path };
  }

  let messageId = String(meta.receipt_message_id || "");
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

  let emailId = String(meta.receipt_email_id || "");
  let emailError = String(meta.receipt_email_error || "");
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

  const nextMeta = {
    ...meta,
    channel: meta.channel || channel,
    receipt_message_id: messageId || meta.receipt_message_id || null,
    receipt_email_id: emailId || meta.receipt_email_id || null,
    receipt_email_error: emailError || null,
    receipt_number: receiptNumber,
  };
  await admin.from("mp_intents").update({ meta: nextMeta }).eq("id", intent.id);

  return {
    ok: true,
    receiptNumber,
    messageId: messageId || null,
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

    const url = new URL(req.url);
    const rawBody = await req.text();
    const secret = Deno.env.get("MP_WEBHOOK_SECRET") || "";
    if (secret && !(await mpSignatureOk(req, rawBody, secret))) {
      return json(401, { error: "Firma inválida." });
    }
    const body = (() => {
      try { return JSON.parse(rawBody || "{}") as Record<string, unknown>; }
      catch { return {} as Record<string, unknown>; }
    })();
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
      const receipt = await afterApprovedPayment(admin, intentId);
      return json(200, { ok: true, kind: "qr_order", receipt });
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

      const { data: already } = await admin
        .from("mp_intents")
        .select("id, applied_at")
        .contains("meta", { authorized_payment_id: remoteId })
        .maybeSingle();
      if (already?.applied_at) return json(200, { ok: true, kind: "subscription_charge", already: true });

      const { data: sub } = await admin
        .from("mp_intents")
        .select("*")
        .eq("preapproval_id", preapprovalId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!sub) return json(200, { ok: true, ignored: true });
      if (sub.member_id) {
        const { data: exempt } = await admin.rpc("member_id_is_dues_exempt", { mid: sub.member_id });
        if (exempt === true) return json(200, { ok: true, ignored: true, reason: "exempt" });
      }

      const { data: charge, error: chargeErr } = already?.id
        ? { data: { id: already.id }, error: null }
        : await admin
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
            meta: {
              from_subscription: sub.id,
              authorized_payment_id: remoteId,
              channel: "subscription",
            },
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
      const receipt = await afterApprovedPayment(admin, charge.id);
      return json(200, { ok: true, kind: "subscription_charge", receipt });
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
    const receipt = await afterApprovedPayment(admin, intentId);
    return json(200, { ok: true, kind: "payment", receipt });
  } catch (err) {
    return json(500, { error: err instanceof Error ? err.message : "Webhook Mercado Pago falló." });
  }
});
