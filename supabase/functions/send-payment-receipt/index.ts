import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DEFAULT_FROM = "Jockey Club San Juan <socios@jockeyclubsj.com.ar>";
const PORTAL_ACCOUNT = "https://www.jockeyclubsj.com.ar/cuenta";
const MAX_PDF_CHARS = 1_800_000;

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function escapeHtml(value: string) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function deliverableEmail(value: string | null | undefined) {
  const email = String(value || "").trim();
  if (!email.includes("@")) return "";
  const lower = email.toLowerCase();
  if (lower.includes("@lila-jockey")) return "";
  if (lower.endsWith("@jockeyclubsj.com")) return "";
  return lower;
}

function safeFileName(value: string) {
  const name = String(value || "comprobante.pdf").replace(/[^\w.\-]+/g, "-").slice(0, 80);
  return name.toLowerCase().endsWith(".pdf") ? name : `${name}.pdf`;
}

function row(label: string, value: string) {
  if (!value) return "";
  return `<tr>
    <td style="padding:7px 0;font-size:13px;color:#6a6156;width:42%;">${escapeHtml(label)}</td>
    <td style="padding:7px 0;font-size:14px;color:#1a1612;">${escapeHtml(value)}</td>
  </tr>`;
}

function buildCopy(input: {
  who: string;
  receipt: string;
  money: string;
  concept: string;
  method: string;
  date: string;
  period: string;
  number: string;
}) {
  const subject = "Comprobante de pago · Jockey Club San Juan";
  const greeting = `Hola ${input.who},`;
  const lead = `Registramos tu pago de ${input.concept}.`;
  const lines = [
    greeting,
    "",
    lead,
    "",
    `Comprobante: ${input.receipt}`,
    `Importe: ${input.money}`,
    `Medio: ${input.method}`,
    input.date ? `Fecha: ${input.date}` : "",
    input.period ? `Período: ${input.period}` : "",
    input.number ? `Socio Nº ${input.number}` : "",
    "",
    "Quedó asentado en tu cuenta. Conservá este comprobante.",
    PORTAL_ACCOUNT,
  ].filter((line, i, all) => line !== "" || all[i - 1] !== "");
  const text = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
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
              ${row("Comprobante", input.receipt)}
              ${row("Importe", input.money)}
              ${row("Concepto", input.concept)}
              ${row("Medio", input.method)}
              ${row("Fecha", input.date)}
              ${row("Período", input.period)}
              ${row("Socio", input.number ? `Nº ${input.number}` : "")}
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
  return { subject, text, html };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
    const apiKey = Deno.env.get("RESEND_API_KEY") || "";
    if (!apiKey) return json(503, { error: "Falta configurar RESEND_API_KEY en las secretas de Supabase." });
    if (!supabaseUrl || !serviceKey || !anonKey) return json(500, { error: "Falta la configuración de Supabase." });

    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: staff, error: staffError } = await userClient.rpc("has_staff_access");
    if (staffError || !staff) return json(403, { error: "Solo el personal del club puede enviar comprobantes." });

    const body = await req.json().catch(() => ({}));
    const memberNumber = String(body?.memberNumber || "").trim();
    const amountLabel = String(body?.amountLabel || "").slice(0, 40);
    const receiptNo = String(body?.receiptNo || "").slice(0, 60);
    const concept = String(body?.concept || "Pago").slice(0, 120);
    const methodLabel = String(body?.methodLabel || "Caja").slice(0, 80);
    const dateLabel = String(body?.dateLabel || "").slice(0, 60);
    const periodLabel = String(body?.periodLabel || "").slice(0, 60);
    const pdfBase64 = String(body?.pdfBase64 || "").replace(/\s/g, "");
    const fileName = safeFileName(body?.fileName);
    if (!memberNumber) return json(400, { error: "Falta el número de socio." });
    if (!pdfBase64 || pdfBase64.length > MAX_PDF_CHARS) {
      return json(400, { error: "El comprobante PDF no llegó o es demasiado grande." });
    }
    if (!/^[A-Za-z0-9+/=]+$/.test(pdfBase64)) {
      return json(400, { error: "El comprobante PDF no es válido." });
    }

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: member, error: memberError } = await admin
      .from("members")
      .select("id, email, full_name, member_number, meta")
      .eq("member_number", memberNumber)
      .maybeSingle();
    if (memberError) return json(500, { error: memberError.message });
    if (!member) return json(404, { error: "No encontramos a ese socio." });

    const contact = String((member.meta as Record<string, unknown> | null)?.contactEmail || "");
    const to = deliverableEmail(member.email) || deliverableEmail(contact);
    if (!to) return json(400, { error: "Ese socio no tiene un mail real cargado." });

    const who = String(member.full_name || "socio").trim() || "socio";
    const copy = buildCopy({
      who,
      receipt: receiptNo || "—",
      money: amountLabel || "—",
      concept: concept || "Pago",
      method: methodLabel || "Caja",
      date: dateLabel,
      period: periodLabel,
      number: String(member.member_number || memberNumber),
    });

    const from = Deno.env.get("RESEND_FROM") || DEFAULT_FROM;
    const idem = `payment-receipt/${member.id || memberNumber}/${receiptNo || fileName}`;
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idem.slice(0, 256),
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject: copy.subject,
        text: copy.text,
        html: copy.html,
        attachments: [{ filename: fileName, content: pdfBase64 }],
      }),
    });
    const payload = await res.json().catch(() => ({})) as { id?: string; message?: string };
    if (!res.ok) {
      return json(502, { error: payload?.message || "Resend no pudo enviar el comprobante." });
    }
    return json(200, { ok: true, emailed: true, id: payload?.id || null, to });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error interno";
    return json(500, { error: message });
  }
});
