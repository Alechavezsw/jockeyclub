import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DEFAULT_FROM = "Jockey Club San Juan <socios@jockeyclubsj.com.ar>";
const SUBJECT = "Disculpas por el correo enviado por error";
const WINDOW_FROM = "2026-10-16T00:00:00.000Z";
const WINDOW_TO = "2026-10-16T02:00:00.000Z";

const TEXT = [
  "Estimados socios:",
  "",
  "Desde el Jockey Club San Juan queremos pedirles disculpas por el correo electrónico que recibieron por error.",
  "",
  "El mensaje fue enviado de manera involuntaria durante el proceso de implementación y puesta a punto de un sistema propio del Club, desarrollado con el objetivo de mejorar y agilizar la comunicación con nuestros socios, brindando un servicio cada vez más moderno, directo y eficiente.",
  "",
  "Les solicitamos que desestimen el correo electrónico anterior, ya que no requiere ninguna acción de su parte.",
  "",
  "Lamentamos las molestias que esta situación haya podido ocasionar y agradecemos su comprensión.",
  "",
  "Seguimos trabajando para mejorar nuestros canales de comunicación y la calidad de los servicios que ofrecemos a toda nuestra comunidad.",
  "",
  "Muchas gracias por su comprensión.",
  "",
  "Atentamente,",
  "Jockey Club San Juan",
].join("\n");

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

function apologyHtml() {
  return `<!DOCTYPE html>
<html lang="es" dir="ltr">
<head><meta charset="utf-8"><title>${escapeHtml(SUBJECT)}</title></head>
<body style="margin:0;padding:0;background:#efe6d4;font-family:Georgia,'Times New Roman',serif;color:#1a1612;">
  <div lang="es" dir="ltr">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#efe6d4;padding:28px 12px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;background:#fffdf8;border:1px solid #d8c7a4;">
        <tr>
          <td style="background:#096755;padding:28px 28px 22px;text-align:center;color:#fffdf8;">
            <p style="margin:0;font-size:11px;letter-spacing:0.22em;text-transform:uppercase;color:#d7c48a;">Sede Rivadavia</p>
            <h1 style="margin:10px 0 0;font-size:26px;font-weight:normal;">Jockey Club San Juan</h1>
          </td>
        </tr>
        <tr>
          <td style="padding:28px;font-size:15px;line-height:1.6;color:#3f3830;">
            <p style="margin:0 0 14px;">Estimados socios:</p>
            <p style="margin:0 0 14px;">Desde el <strong>Jockey Club San Juan</strong> queremos pedirles disculpas por el correo electrónico que recibieron por error.</p>
            <p style="margin:0 0 14px;">El mensaje fue enviado de manera involuntaria durante el proceso de implementación y puesta a punto de un <strong>sistema propio del Club</strong>, desarrollado con el objetivo de mejorar y agilizar la comunicación con nuestros socios, brindando un servicio cada vez más moderno, directo y eficiente.</p>
            <p style="margin:0 0 14px;">Les solicitamos que <strong>desestimen el correo electrónico anterior</strong>, ya que no requiere ninguna acción de su parte.</p>
            <p style="margin:0 0 14px;">Lamentamos las molestias que esta situación haya podido ocasionar y agradecemos su comprensión.</p>
            <p style="margin:0 0 14px;">Seguimos trabajando para mejorar nuestros canales de comunicación y la calidad de los servicios que ofrecemos a toda nuestra comunidad.</p>
            <p style="margin:0 0 18px;"><strong>Muchas gracias por su comprensión.</strong></p>
            <p style="margin:0;">Atentamente,<br><strong>Jockey Club San Juan</strong></p>
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
  </div>
</body>
</html>`;
}

type Admin = ReturnType<typeof createClient>;

async function alreadySent(admin: Admin) {
  const { data } = await admin.from("dues_apology_sends").select("email, resend_id");
  const done = new Set<string>();
  for (const row of data || []) {
    if (row.resend_id) done.add(String(row.email || "").toLowerCase());
  }
  return done;
}

async function sendBatch(
  prepared: string[],
  apiKey: string,
  from: string,
  batchId: string,
) {
  if (!prepared.length) return { sent: 0, failed: 0, ids: [] as string[], error: "" };
  const res = await fetch("https://api.resend.com/emails/batch", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `batch-dues-apology/${batchId}`,
    },
    body: JSON.stringify(
      prepared.map((email) => ({
        from,
        to: [email],
        subject: SUBJECT,
        text: TEXT,
        html: apologyHtml(),
      })),
    ),
  });
  const payload = await res.json().catch(() => ({})) as { data?: Array<{ id?: string }>; message?: string };
  const ids = Array.isArray(payload?.data) ? payload.data.map((item) => String(item?.id || "")) : [];
  if (!res.ok) return { sent: 0, failed: prepared.length, ids, error: String(payload?.message || `Resend ${res.status}`) };
  const sent = ids.filter(Boolean).length;
  return { sent, failed: prepared.length - sent, ids, error: "" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const apiKey = Deno.env.get("RESEND_API_KEY") || "";
    if (!apiKey) return json(503, { error: "Falta configurar RESEND_API_KEY." });
    if (!supabaseUrl || !serviceKey) return json(500, { error: "Falta la configuración de Supabase." });

    const admin = createClient(supabaseUrl, serviceKey);
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const { data: cronRow } = await admin.from("dues_cron_config").select("token").eq("id", 1).maybeSingle();
    const isService = token === serviceKey || (Boolean(cronRow?.token) && token === cronRow.token);
    if (!isService) return json(401, { error: "No autenticado" });

    const from = Deno.env.get("RESEND_FROM") || DEFAULT_FROM;
    const [done, mailed] = await Promise.all([
      alreadySent(admin),
      admin
        .from("dues_notice_sends")
        .select("email, email_error, resend_id")
        .not("resend_id", "is", null)
        .neq("resend_id", "no-email")
        .gte("created_at", WINDOW_FROM)
        .lt("created_at", WINDOW_TO)
        .then(({ data }) => data || []),
    ]);
    const delivered = [...new Set(
      mailed
        .filter((row) => !String(row.email_error || "").trim())
        .map((row) => deliverableEmail(row.email))
        .filter(Boolean),
    )];

    const recipients = delivered
      .filter((email) => !done.has(email))
      .toSorted();

    const counts = { candidates: delivered.length, sent: 0, already: done.size, skipped: 0, failed: 0 };

    for (let i = 0; i < recipients.length; i += 100) {
      const chunk = recipients.slice(i, i + 100);
      const batch = await sendBatch(chunk, apiKey, from, `${chunk[0]}/${chunk.length}`);
      counts.failed += batch.failed;
      for (let n = 0; n < chunk.length; n += 1) {
        const id = batch.ids[n] || null;
        if (id) counts.sent += 1;
        await admin.from("dues_apology_sends").upsert({
          email: chunk[n],
          resend_id: id,
          email_error: id ? null : (batch.error || "Resend no devolvió id"),
        }, { onConflict: "email" });
      }
      if (i + 100 < recipients.length) await new Promise((resolve) => setTimeout(resolve, 600));
    }

    return json(200, { ok: true, ...counts, pending: recipients.length });
  } catch (err) {
    return json(500, { error: err instanceof Error ? err.message : "No se pudieron enviar las disculpas." });
  }
});
