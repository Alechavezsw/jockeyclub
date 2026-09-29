import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PORTAL_PAYMENTS = "https://jockeyclubsj.org/cuenta";
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

function safeFileName(value: string) {
  const name = String(value || "boleto.pdf").replace(/[^\w.\-]+/g, "-").slice(0, 80);
  return name.toLowerCase().endsWith(".pdf") ? name : `${name}.pdf`;
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
    const { data: authData, error: authErr } = await userClient.auth.getUser();
    const user = authData?.user;
    if (authErr || !user) return json(401, { error: "No autenticado" });

    const body = await req.json().catch(() => ({}));
    const amountLabel = String(body?.amountLabel || "").slice(0, 40);
    const receiptNo = String(body?.receiptNo || "").slice(0, 40);
    const periodLabel = String(body?.periodLabel || "").slice(0, 40);
    const pdfBase64 = String(body?.pdfBase64 || "").replace(/\s/g, "");
    const fileName = safeFileName(body?.fileName);
    if (!pdfBase64 || pdfBase64.length > MAX_PDF_CHARS) {
      return json(400, { error: "El boleto PDF no llegó o es demasiado grande." });
    }
    if (!/^[A-Za-z0-9+/=]+$/.test(pdfBase64)) {
      return json(400, { error: "El boleto PDF no es válido." });
    }

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: member } = await admin
      .from("members")
      .select("id, email, full_name, member_number")
      .eq("profile_id", user.id)
      .maybeSingle();

    const to = String(member?.email || user.email || "").trim();
    if (!to.includes("@")) return json(400, { error: "El socio no tiene un mail cargado." });

    const who = member?.full_name || "socio";
    const subject = "Boleto de pago de cuota";
    const lines = [
      `Hola ${who},`,
      "",
      "Te adjuntamos el boleto para pagar la cuota social con Mercado Pago.",
      amountLabel ? `Importe: ${amountLabel}` : "",
      periodLabel ? `Período: ${periodLabel}` : "",
      receiptNo ? `Boleto: ${receiptNo}` : "",
      "",
      "También lo podés descargar en Cuotas, dentro de la app:",
      PORTAL_PAYMENTS,
    ].filter((line) => line !== "");
    const text = lines.join("\n");
    const html = `<!DOCTYPE html>
<html lang="es">
<body style="margin:0;padding:0;background:#efe6d4;font-family:Georgia,'Times New Roman',serif;color:#1a1612;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#efe6d4;padding:28px 12px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#fffdf8;border:1px solid #d8c7a4;">
        <tr>
          <td style="background:#096755;padding:28px 28px 22px;text-align:center;color:#fffdf8;">
            <p style="margin:0;font-size:11px;letter-spacing:0.22em;text-transform:uppercase;color:#d7c48a;">Sede Rivadavia</p>
            <h1 style="margin:10px 0 0;font-size:26px;font-weight:normal;">Jockey Club San Juan</h1>
          </td>
        </tr>
        <tr>
          <td style="padding:28px;">
            <p style="margin:0 0 12px;font-size:18px;">Hola ${escapeHtml(who)},</p>
            <p style="margin:0 0 18px;font-size:15px;line-height:1.55;color:#3f3830;">Te adjuntamos el boleto para pagar la cuota social con Mercado Pago. También queda para descargar en Cuotas.</p>
            <p style="margin:0 0 18px;font-size:15px;line-height:1.55;color:#3f3830;">
              ${amountLabel ? `Importe: ${escapeHtml(amountLabel)}<br>` : ""}
              ${periodLabel ? `Período: ${escapeHtml(periodLabel)}<br>` : ""}
              ${receiptNo ? `Boleto: ${escapeHtml(receiptNo)}` : ""}
            </p>
            <table role="presentation" cellpadding="0" cellspacing="0">
              <tr><td style="background:#ca390c;border-radius:999px;">
                <a href="${PORTAL_PAYMENTS}" style="display:inline-block;padding:12px 22px;color:#fffdf8;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:14px;">Abrir Cuotas</a>
              </td></tr>
            </table>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

    const from = Deno.env.get("RESEND_FROM") || "Jockey Club San Juan <onboarding@resend.dev>";
    const idem = `boleto/${member?.id || user.id}/${receiptNo || "sin-numero"}`;
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
        subject,
        text,
        html,
        attachments: [{ filename: fileName, content: pdfBase64 }],
      }),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      return json(502, { error: payload?.message || "Resend no pudo enviar el boleto." });
    }
    return json(200, { ok: true, emailed: true, id: payload?.id || null });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error interno";
    return json(500, { error: message });
  }
});
