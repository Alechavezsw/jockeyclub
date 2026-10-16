import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const AR_TZ = "America/Argentina/San_Juan";
const PORTAL_ACCOUNT = "https://jockeyclubsj.com.ar/cuenta";
const DEFAULT_FROM = "Jockey Club San Juan <socios@jockeyclubsj.com.ar>";
const MORA_CONSEQUENCES = [
  "A partir del día 11, socio familiar y socio individual pagan un recargo del 10 %.",
  "En mora no se ingresa al club hasta regularizar la cuota.",
  "Tampoco se puede pagar pileta hasta estar al día.",
];

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

function cycleDueOn(todayIso: string, dueDay = 10) {
  return `${todayIso.slice(0, 7)}-${String(dueDay).padStart(2, "0")}`;
}

function asDay(value: unknown, fallback: number) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 28 ? n : fallback;
}

function stagesForDay(todayIso: string, dueDay = 10, advanceDays = 5, moraDay = dueDay + 5) {
  const day = Number(todayIso.slice(8, 10));
  const stages: Array<"upcoming" | "due" | "mora"> = [];
  if (day >= dueDay - advanceDays && day < dueDay) stages.push("upcoming");
  if (day >= dueDay && day < moraDay) stages.push("due");
  if (day >= moraDay) stages.push("mora");
  return stages;
}

async function loadDuesClock(admin: ReturnType<typeof createClient>) {
  const { data } = await admin.from("app_settings").select("value").eq("key", "dues").maybeSingle();
  const dueDay = asDay(data?.value?.dueDay, 10);
  const advanceDays = asDay(data?.value?.noticeAdvanceDays, 5);
  return {
    dueDay,
    advanceDays,
    moraDay: asDay(data?.value?.noticeMoraDay, dueDay + advanceDays),
  };
}

function longDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  const months = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
  ];
  return `${d} de ${months[m - 1]} de ${y}`;
}

function noticeCopy(name: string, dueOn: string, stage: string) {
  const who = name || "socio";
  const when = longDate(dueOn);
  const consequences = MORA_CONSEQUENCES.join(" ");
  let subject = "Hoy vence tu cuota";
  let lead = `Hoy, ${when}, vence la cuota social del Jockey Club San Juan. Si abonás hoy no lleva recargo.`;
  if (stage === "upcoming") {
    subject = `Tu cuota vence el ${when}`;
    lead = `Faltan 5 días: el ${when} vence la cuota social del Jockey Club San Juan.`;
  } else if (stage === "mora") {
    subject = "Tu cuota está en mora";
    lead = `El ${when} venció la cuota social y seguís sin regularizar. Ya estás en mora.`;
  }
  const greeting = `Hola ${who},`;
  const text = [
    greeting,
    "",
    lead,
    "",
    "Consecuencias de estar en mora:",
    consequences,
    "",
    "Entrá a Mi cuenta para ver el importe y cómo pagarla:",
    PORTAL_ACCOUNT,
  ].join("\n");
  const html = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><title>${escapeHtml(subject)}</title></head>
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
            <p style="margin:0 0 12px;font-size:18px;">${escapeHtml(greeting)}</p>
            <p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:#3f3830;">${escapeHtml(lead)}</p>
            <p style="margin:0 0 8px;font-size:14px;font-weight:bold;color:#ca390c;">Consecuencias de estar en mora</p>
            <p style="margin:0 0 18px;font-size:15px;line-height:1.55;color:#3f3830;">${escapeHtml(consequences)}</p>
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
  const kind = stage === "upcoming" ? "dues_upcoming" : stage === "mora" ? "dues_mora" : "dues_due";
  return { subject, text, html, kind };
}

type MemberRow = {
  id: string;
  member_number: string;
  full_name: string | null;
  email: string | null;
};

type Prepared = {
  rowId: string;
  email: string;
  copy: ReturnType<typeof noticeCopy>;
};

function deliverableEmail(value: string | null | undefined) {
  const email = String(value || "").trim();
  if (!email.includes("@")) return "";
  const lower = email.toLowerCase();
  if (lower.includes("@lila-jockey")) return "";
  if (lower.endsWith("@jockeyclubsj.com")) return "";
  return email;
}

async function ensureMemberMessage(
  admin: ReturnType<typeof createClient>,
  member: MemberRow,
  copy: ReturnType<typeof noticeCopy>,
  dueOn: string,
  stage: string,
  existingMessageId?: string | null,
) {
  if (existingMessageId) return existingMessageId;
  const recipient = String(member.member_number || "").replace(/[^a-zA-Z0-9._-]/g, "");
  if (!recipient) return null;
  const inserted = await admin
    .from("messages")
    .insert({
      sender_name: "Secretaría del Jockey Club",
      sender_key: "ops",
      recipient_key: recipient,
      subject: copy.subject,
      body: copy.text,
      is_read: false,
      meta: { kind: copy.kind, dueOn, stage },
    })
    .select("id")
    .single();
  return inserted.data?.id || null;
}

async function prepareNotice(
  admin: ReturnType<typeof createClient>,
  member: MemberRow,
  dueOn: string,
  stage: string,
): Promise<{ status: "already" | "skip" | "ready"; prepared?: Prepared; messaged?: boolean }> {
  const { data: existing } = await admin
    .from("dues_notice_sends")
    .select("id, resend_id, message_id")
    .eq("member_id", member.id)
    .eq("due_on", dueOn)
    .eq("stage", stage)
    .maybeSingle();
  if (existing?.resend_id) return { status: "already" };

  let rowId = existing?.id as string | undefined;
  const email = deliverableEmail(member.email);
  if (!rowId) {
    const inserted = await admin
      .from("dues_notice_sends")
      .insert({ member_id: member.id, due_on: dueOn, stage, email: email || null })
      .select("id")
      .single();
    if (inserted.error || !inserted.data) return { status: "skip" };
    rowId = inserted.data.id;
  }

  const copy = noticeCopy(member.full_name || "", dueOn, stage);
  const messageId = await ensureMemberMessage(admin, member, copy, dueOn, stage, existing?.message_id);
  if (messageId && messageId !== existing?.message_id) {
    await admin.from("dues_notice_sends").update({ message_id: messageId }).eq("id", rowId);
  }

  if (!email) {
    await admin
      .from("dues_notice_sends")
      .update({ resend_id: "no-email", email_error: "Sin mail real" })
      .eq("id", rowId);
    return { status: "ready", messaged: Boolean(messageId) };
  }

  return { status: "ready", messaged: Boolean(messageId), prepared: { rowId, email, copy } };
}

async function sendEmailBatch(
  prepared: Prepared[],
  apiKey: string,
  from: string,
  admin: ReturnType<typeof createClient>,
) {
  if (!prepared.length) return { sent: 0, failed: 0 };
  const res = await fetch("https://api.resend.com/emails/batch", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `dues-batch/${prepared[0].copy.kind}/${prepared[0].rowId}`,
    },
    body: JSON.stringify(
      prepared.map((item) => ({
        from,
        to: [item.email],
        subject: item.copy.subject,
        text: item.copy.text,
        html: item.copy.html,
      })),
    ),
  });
  const payload = await res.json().catch(() => ({}));
  const ids = Array.isArray(payload?.data) ? payload.data : [];
  if (!res.ok) {
    const err = payload?.message || "Resend no pudo enviar el lote";
    await Promise.all(prepared.map((item) => (
      admin.from("dues_notice_sends").update({ email_error: err }).eq("id", item.rowId)
    )));
    return { sent: 0, failed: prepared.length };
  }
  let sent = 0;
  let failed = 0;
  for (let i = 0; i < prepared.length; i += 1) {
    const id = ids[i]?.id;
    if (id) {
      sent += 1;
      await admin
        .from("dues_notice_sends")
        .update({ resend_id: id, email_error: null })
        .eq("id", prepared[i].rowId);
    } else {
      failed += 1;
      await admin
        .from("dues_notice_sends")
        .update({ email_error: "Resend no devolvió id" })
        .eq("id", prepared[i].rowId);
    }
  }
  return { sent, failed };
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

    const admin = createClient(supabaseUrl, serviceKey);
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const { data: cronRow } = await admin.from("dues_cron_config").select("token").eq("id", 1).maybeSingle();
    const isService = token === serviceKey || (Boolean(cronRow?.token) && token === cronRow?.token);
    let profileId: string | null = null;
    if (!isService) {
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: authData, error: authErr } = await userClient.auth.getUser();
      if (authErr || !authData?.user) return json(401, { error: "No autenticado" });
      profileId = authData.user.id;
    }

    const today = arISODate();
    const clock = await loadDuesClock(admin);
    const dueOn = cycleDueOn(today, clock.dueDay);
    const stages = stagesForDay(today, clock.dueDay, clock.advanceDays, clock.moraDay);
    if (!stages.length) return json(200, { ok: true, sent: 0, already: 0, failed: 0, skipped: "fuera de fecha" });

    const from = Deno.env.get("RESEND_FROM") || DEFAULT_FROM;
    const counts = { sent: 0, already: 0, failed: 0, messaged: 0 };
    const pageSize = profileId ? 1 : 100;
    const maxPages = profileId ? 1 : 6;

    for (const stage of stages) {
      for (let page = 0; page < maxPages; page += 1) {
        const { data, error } = await admin.rpc("members_pending_due_notice", {
          due_on: dueOn,
          stage,
          lim: pageSize,
          profile_filter: profileId,
        });
        if (error) return json(500, { error: error.message });
        const members = (data || []) as MemberRow[];
        if (!members.length) break;

        const ready: Prepared[] = [];
        for (const member of members) {
          const result = await prepareNotice(admin, member, dueOn, stage);
          if (result.status === "already") counts.already += 1;
          else if (result.status === "ready") {
            if (result.messaged) counts.messaged += 1;
            if (result.prepared) ready.push(result.prepared);
          }
        }
        const batch = await sendEmailBatch(ready, apiKey, from, admin);
        counts.sent += batch.sent;
        counts.failed += batch.failed;
        if (members.length < pageSize) break;
      }
    }

    return json(200, { ok: true, dueOn, stages, ...counts });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error interno";
    return json(500, { error: message });
  }
});
