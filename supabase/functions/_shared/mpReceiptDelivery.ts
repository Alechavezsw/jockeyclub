import { isApprovedCreditStatus } from "./mpSettlement.js";

const AR_TZ = "America/Argentina/Buenos_Aires";
const PORTAL_ACCOUNT = "https://www.jockeyclubsj.com.ar/cuenta";
const DEFAULT_FROM = "Jockey Club San Juan <socios@jockeyclubsj.com.ar>";

type Admin = {
  from: (table: string) => any;
  storage: { from: (bucket: string) => any };
  rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ data?: unknown }>;
};

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

export function mpReceiptMoney(amount: number) {
  const n = Number(amount);
  const safe = Number.isFinite(n) ? n : 0;
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(safe);
}

export function mpReceiptDeliverableEmail(value: string | null | undefined) {
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

export async function deliverMpReceipt(
  admin: Admin,
  intentId: string,
  prior: { messageId?: string | null; emailId?: string | null; opsNoticeId?: string | null } = {},
) {
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
  const alreadyMessage = Boolean(meta.receipt_message_id || prior.messageId);
  const alreadyEmail = Boolean(meta.receipt_email_id || prior.emailId);
  const alreadyOpsNotice = Boolean(meta.ops_payment_notice_id || prior.opsNoticeId);
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

  let messageId = String(meta.receipt_message_id || prior.messageId || "");
  let emailId = String(meta.receipt_email_id || prior.emailId || "");
  let emailError = String(meta.receipt_email_error || "");
  let emailPermanent = false;
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
        emailPermanent = true;
      } else {
        const from = Deno.env.get("RESEND_FROM") || DEFAULT_FROM;
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            // Resend recuerda esta clave 24 horas. Después no evita un segundo envío.
            "Idempotency-Key": `mp-receipt/${intent.id}`.slice(0, 256),
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
          emailPermanent = res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429;
        }
      }
    }
  }

  // Aviso a operaciones: la operación entra en «Pagos entrantes» aunque MP acredite solo.
  let opsNoticeId = String(meta.ops_payment_notice_id || prior.opsNoticeId || "");
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
    emailId: emailId || null,
    emailed: Boolean(emailId && emailId !== "no-email" && emailId !== "skipped:no-email"),
    emailError: emailError || null,
    permanent: emailPermanent,
  };
}

