import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

function welcomeHtml(name: string, logoUrl: string) {
  const who = escapeHtml(name || "socio");
  const logo = /^https:\/\//i.test(logoUrl)
    ? `<img src="${escapeHtml(logoUrl)}" width="72" height="72" alt="Jockey Club San Juan" style="display:block;margin:0 auto 12px;border:0;" />`
    : "";
  return `<!DOCTYPE html>
<html lang="es">
<body style="margin:0;padding:0;background:#efe6d4;font-family:Georgia,'Times New Roman',serif;color:#1a1612;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#efe6d4;padding:28px 12px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#fffdf8;border:1px solid #d8c7a4;">
        <tr>
          <td style="background:#096755;padding:28px 28px 22px;text-align:center;color:#fffdf8;">
            ${logo}
            <p style="margin:0;font-size:11px;letter-spacing:0.22em;text-transform:uppercase;color:#d7c48a;">Sede Rivadavia · República del Líbano 1799 Oeste</p>
            <h1 style="margin:10px 0 0;font-size:26px;font-weight:normal;color:#fffdf8;">Jockey Club San Juan</h1>
          </td>
        </tr>
        <tr>
          <td style="padding:28px 28px 8px;">
            <p style="margin:0 0 12px;font-size:18px;">Hola ${who},</p>
            <p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:#3f3830;">
              Recibimos tu solicitud para asociarte al club. Secretaría la revisa
              y te contacta. Este mail es solo la bienvenida: todavía no es el alta.
            </p>
            <p style="margin:0 0 18px;font-size:15px;line-height:1.55;color:#3f3830;">
              Cuando te den de alta te llega otro correo, ese sí con usuario y contraseña
              para entrar al portal.
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:18px 28px 26px;border-top:1px solid #eadcc0;font-size:12px;color:#6a6156;">
            Jockey Club San Juan · San Juan, Argentina
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  try {
    const applicationId = String((await req.json())?.applicationId || "").trim();
    if (!UUID_RE.test(applicationId)) return json(400, { error: "Solicitud inválida" });

    const apiKey = Deno.env.get("RESEND_API_KEY") || "";
    if (!apiKey) {
      return json(503, { error: "Falta configurar RESEND_API_KEY en las secretas de Supabase." });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: row, error } = await admin
      .from("membership_applications")
      .select("id, full_name, email, meta, created_at")
      .eq("id", applicationId)
      .maybeSingle();
    if (error || !row) return json(404, { error: "No encontramos la solicitud" });

    const to = String(row.email || "").trim();
    if (!to.includes("@")) return json(400, { error: "La solicitud no tiene email" });

    const meta = row.meta && typeof row.meta === "object" ? row.meta as Record<string, unknown> : {};
    if (meta.welcome_sent_at) {
      return json(200, { ok: true, already: true, to });
    }

    const created = row.created_at ? new Date(String(row.created_at)).getTime() : 0;
    if (created && Date.now() - created > 30 * 60 * 1000) {
      return json(400, { error: "La bienvenida ya no se puede reenviar" });
    }

    const name = String(row.full_name || "").trim();
    const from = Deno.env.get("RESEND_FROM") || "Jockey Club San Juan <onboarding@resend.dev>";
    const subject = "Recibimos tu solicitud · Jockey Club San Juan";
    const text = [
      name ? `Hola ${name}` : "Hola",
      "",
      "Recibimos tu solicitud para asociarte.",
      "Secretaría la revisa y te contacta. Esto todavía no es el alta.",
      "",
      "Cuando te den de alta te llega otro mail, ese sí con usuario y contraseña del portal.",
    ].join("\n");

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        text,
        html: welcomeHtml(name, ""),
      }),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      return json(400, { error: payload?.message || "Resend no pudo enviar el mail" });
    }

    await admin.from("membership_applications").update({
      meta: { ...meta, welcome_sent_at: new Date().toISOString() },
    }).eq("id", applicationId);

    return json(200, { ok: true, id: payload?.id || null, to });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error interno";
    return json(500, { error: message });
  }
});
