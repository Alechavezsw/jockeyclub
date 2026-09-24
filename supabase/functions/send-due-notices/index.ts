import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const AR_TZ = "America/Argentina/San_Juan";
const PORTAL_ACCOUNT = "https://jockeyclubsj.org/cuenta";

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

function addDays(iso: string, days: number) {
  const [y, m, d] = iso.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d));
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

function longDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  const months = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
  ];
  return `${d} de ${months[m - 1]} de ${y}`;
}

function noticeCopy(name: string, dueOn: string, today: string) {
  const when = longDate(dueOn);
  const who = name || "socio";
  const onDay = dueOn === today;
  const subject = onDay ? "Hoy vence tu cuota" : "Venció tu cuota";
  const lead = onDay
    ? `Hoy, ${when}, vence la cuota social del Jockey Club San Juan.`
    : `El ${when} venció la cuota social del Jockey Club San Juan.`;
  const text = [
    `Hola ${who},`,
    "",
    lead,
    "",
    "Entrá a Mi cuenta para ver el importe y cómo pagarla:",
    PORTAL_ACCOUNT,
  ].join("\n");
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
            <p style="margin:0 0 18px;font-size:15px;line-height:1.55;color:#3f3830;">${escapeHtml(lead)}</p>
            <table role="presentation" cellpadding="0" cellspacing="0">
              <tr><td style="background:#ca390c;border-radius:999px;">
                <a href="${PORTAL_ACCOUNT}" style="display:inline-block;padding:12px 22px;color:#fffdf8;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:14px;">Ver Mi cuenta</a>
              </td></tr>
            </table>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  return { subject, text, html };
}

type MemberRow = {
  id: string;
  member_number: string;
  full_name: string | null;
  email: string;
};

async function sendOne(
  admin: ReturnType<typeof createClient>,
  member: MemberRow,
  dueOn: string,
  today: string,
  apiKey: string,
  from: string,
) {
  const { data: existing } = await admin
    .from("dues_notice_sends")
    .select("id, resend_id, message_id")
    .eq("member_id", member.id)
    .eq("due_on", dueOn)
    .maybeSingle();
  if (existing?.resend_id) return "already";

  let rowId = existing?.id as string | undefined;
  let messageId = existing?.message_id as string | undefined;
  if (!rowId) {
    const inserted = await admin
      .from("dues_notice_sends")
      .insert({ member_id: member.id, due_on: dueOn, email: member.email })
      .select("id")
      .single();
    if (inserted.error || !inserted.data) return "skip";
    rowId = inserted.data.id;
  }

  const copy = noticeCopy(member.full_name || "", dueOn, today);
  if (!messageId && member.member_number) {
    const message = await admin
      .from("messages")
      .insert({
        sender_name: "Secretaría del Jockey Club",
        sender_key: "ops",
        recipient_key: member.member_number,
        subject: copy.subject,
        body: copy.text,
        is_read: false,
        meta: { kind: "dues_due", dueOn },
      })
      .select("id")
      .single();
    if (message.data?.id) {
      messageId = message.data.id;
      await admin.from("dues_notice_sends").update({ message_id: messageId }).eq("id", rowId);
    }
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `dues-due/${member.id}/${dueOn}`,
    },
    body: JSON.stringify({
      from,
      to: [member.email],
      subject: copy.subject,
      text: copy.text,
      html: copy.html,
    }),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    await admin
      .from("dues_notice_sends")
      .update({ email_error: payload?.message || "Resend no pudo enviar el mail" })
      .eq("id", rowId);
    return "email_failed";
  }
  await admin
    .from("dues_notice_sends")
    .update({ resend_id: payload?.id || "sent", email_error: null })
    .eq("id", rowId);
  return "sent";
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
    if (!supabaseUrl || !serviceKey) return json(500, { error: "Falta la configuración de Supabase." });

    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const isService = token === serviceKey;
    let profileId: string | null = null;
    if (!isService) {
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: authData, error: authErr } = await userClient.auth.getUser();
      if (authErr || !authData?.user) return json(401, { error: "No autenticado" });
      profileId = authData.user.id;
    }

    const admin = createClient(supabaseUrl, serviceKey);
    const today = arISODate();
    const dates = [today, addDays(today, -1)];
    const from = Deno.env.get("RESEND_FROM") || "Jockey Club San Juan <onboarding@resend.dev>";
    const counts = { sent: 0, already: 0, failed: 0 };

    for (const dueOn of dates) {
      const { data, error } = await admin.rpc("members_pending_due_notice", {
        due_on: dueOn,
        lim: profileId ? 1 : 80,
        profile_filter: profileId,
      });
      if (error) return json(500, { error: error.message });
      const members = (data || []) as MemberRow[];
      for (const member of members) {
        const result = await sendOne(admin, member, dueOn, today, apiKey, from);
        if (result === "sent") counts.sent += 1;
        else if (result === "already") counts.already += 1;
        else if (result === "email_failed") counts.failed += 1;
      }
    }

    return json(200, { ok: true, ...counts });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error interno";
    return json(500, { error: message });
  }
});
