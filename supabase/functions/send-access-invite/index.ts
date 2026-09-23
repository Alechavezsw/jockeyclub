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

function escapeHtml(value: string) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inviteHtml(input: {
  name: string;
  username: string;
  loginEmail: string;
  password: string;
  portalUrl: string;
  logoUrl: string;
}) {
  const who = escapeHtml(input.name || "socio");
  const user = escapeHtml(input.username);
  const mail = escapeHtml(input.loginEmail);
  const pass = escapeHtml(input.password);
  const href = escapeHtml(input.portalUrl);
  const logo = /^https:\/\//i.test(input.logoUrl)
    ? `<img src="${escapeHtml(input.logoUrl)}" width="72" height="72" alt="Jockey Club San Juan" style="display:block;margin:0 auto 12px;border:0;" />`
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
            <p style="margin:0 0 18px;font-size:15px;line-height:1.55;color:#3f3830;">
              Secretaría ya dejó listo tu usuario del portal. Guardá estos datos:
              el ingreso es personal y la contraseña se puede cambiar apenas entres.
            </p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4efe4;border:1px solid #e2d3b4;margin:0 0 20px;">
              <tr><td style="padding:16px 18px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1a1612;">
                <p style="margin:0 0 8px;"><strong style="color:#096755;">Usuario</strong><br />${user}</p>
                <p style="margin:0 0 8px;"><strong style="color:#096755;">Email de ingreso</strong><br />${mail}</p>
                <p style="margin:0;"><strong style="color:#096755;">Contraseña</strong><br />${pass}</p>
              </td></tr>
            </table>
            <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 22px;">
              <tr><td style="background:#ca390c;border-radius:999px;">
                <a href="${href}" style="display:inline-block;padding:12px 22px;color:#fffdf8;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:14px;">Entrar al portal</a>
              </td></tr>
            </table>
            <p style="margin:0;font-size:13px;line-height:1.5;color:#6a6156;">
              Si el botón no abre, copiá esta dirección:<br />
              <a href="${href}" style="color:#096755;">${href}</a>
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
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: authData, error: authErr } = await userClient.auth.getUser();
    if (authErr || !authData?.user) return json(401, { error: "No autenticado" });

    const { data: staff, error: staffErr } = await userClient.rpc("has_staff_access");
    if (staffErr || !staff) return json(403, { error: "Solo secretaría puede enviar accesos" });

    const apiKey = Deno.env.get("RESEND_API_KEY") || "";
    if (!apiKey) {
      return json(503, { error: "Falta configurar RESEND_API_KEY en las secretas de Supabase." });
    }

    const body = await req.json();
    const to = String(body.to || "").trim();
    const name = String(body.name || "").trim();
    const username = String(body.username || "").trim();
    const loginEmail = String(body.loginEmail || "").trim();
    const password = String(body.password || "").trim();
    const portalUrl = String(body.portalUrl || "").trim();
    const logoUrl = String(body.logoUrl || "").trim();

    if (!to.includes("@")) return json(400, { error: "Falta el email de contacto" });
    if (!username || !password || !portalUrl) {
      return json(400, { error: "Faltan usuario, contraseña o el link del portal" });
    }

    const from = Deno.env.get("RESEND_FROM") || "Jockey Club San Juan <onboarding@resend.dev>";
    const subject = "Tu acceso al portal · Jockey Club San Juan";
    const text = [
      name ? `Hola ${name}` : "Hola",
      "",
      "Ya tenés acceso al portal de socios.",
      portalUrl,
      "",
      `Usuario: ${username}`,
      `Email de ingreso: ${loginEmail}`,
      `Contraseña: ${password}`,
      "",
      "Ingresá con esos datos y cambiá la contraseña cuando puedas.",
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
        html: inviteHtml({ name, username, loginEmail, password, portalUrl, logoUrl }),
      }),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      return json(400, { error: payload?.message || "Resend no pudo enviar el mail" });
    }
    return json(200, { ok: true, id: payload?.id || null, to });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error interno";
    return json(500, { error: message });
  }
});
