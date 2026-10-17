import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DEFAULT_FROM = "Jockey Club San Juan <socios@jockeyclubsj.com.ar>";
const LOGO_SRC = "https://jockeyclubsj.com.ar/logo-jockey-club.png";
const PAGE = 500;
const BATCH = 100;
const MAX_BATCHES = 6;

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

function noticeHtml(subject: string, body: string) {
  const paragraphs = escapeHtml(body)
    .split(/\n{2,}/)
    .map((block) => "<p style='margin:0 0 14px;'>" + block.replace(/\n/g, "<br>") + "</p>")
    .join("");
  const title = escapeHtml(subject);
  return [
    "<!DOCTYPE html><html lang='es'><head><meta charset='utf-8'><title>",
    title,
    "</title></head>",
    "<body style='margin:0;padding:0;background:#efe6d4;font-family:Georgia,serif;color:#1a1612;'>",
    "<table role='presentation' width='100%' cellpadding='0' cellspacing='0' style='background:#efe6d4;padding:28px 12px;'>",
    "<tr><td align='center'><table role='presentation' width='560' cellpadding='0' cellspacing='0' style='max-width:560px;width:100%;background:#fffdf8;border:1px solid #d8c7a4;'>",
    "<tr><td style='background:#096755;padding:28px 28px 22px;text-align:center;color:#fffdf8;'>",
    "<img src='",
    LOGO_SRC,
    "' width='72' height='72' alt='Jockey Club San Juan' style='display:block;margin:0 auto 12px;border:0;border-radius:50%;background:#ffffff;padding:4px;box-sizing:border-box;' />",
    "<p style='margin:0;font-size:11px;letter-spacing:0.22em;text-transform:uppercase;color:#d7c48a;'>Sede Rivadavia</p>",
    "<h1 style='margin:10px 0 0;font-size:26px;font-weight:normal;'>Jockey Club San Juan</h1>",
    "</td></tr><tr><td style='padding:28px;font-size:15px;line-height:1.6;color:#3f3830;'>",
    paragraphs,
    "</td></tr><tr><td style='padding:18px 28px 26px;border-top:1px solid #eadcc0;font-size:12px;color:#6a6156;'>",
    "Jockey Club San Juan · República del Líbano 1799 Oeste, Rivadavia",
    "</td></tr></table></td></tr></table></body></html>",
  ].join("");
}

type Admin = ReturnType<typeof createClient>;
type Target = { email: string; memberNumber: string };

async function alreadySent(admin: Admin, campaignId: string) {
  const done = new Set<string>();
  let from = 0;
  for (;;) {
    const { data, error } = await admin
      .from("club_mail_sends")
      .select("email, resend_id")
      .eq("campaign_id", campaignId)
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    const rows = data || [];
    for (const row of rows) {
      if (row.resend_id) done.add(String(row.email || "").toLowerCase());
    }
    if (rows.length < 1000) break;
    from += 1000;
  }
  return done;
}

async function sendBatch(
  prepared: Target[],
  apiKey: string,
  from: string,
  subject: string,
  text: string,
  html: string,
  batchKey: string,
) {
  if (!prepared.length) return { sent: 0, failed: 0, ids: [] as string[], error: "" };
  const res = await fetch("https://api.resend.com/emails/batch", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `batch-club-mail/${batchKey}`,
    },
    body: JSON.stringify(
      prepared.map((item) => ({
        from,
        to: [item.email],
        reply_to: ["socios@jockeyclubsj.com.ar"],
        subject,
        text,
        html,
      })),
    ),
  });
  const payload = await res.json().catch(() => ({})) as { data?: Array<{ id?: string }>; message?: string };
  const ids = Array.isArray(payload?.data) ? payload.data.map((item) => String(item?.id || "")) : [];
  if (!res.ok) {
    return { sent: 0, failed: prepared.length, ids, error: String(payload?.message || `Resend ${res.status}`) };
  }
  const sent = ids.filter(Boolean).length;
  return { sent, failed: prepared.length - sent, ids, error: "" };
}

async function recordBatch(
  admin: Admin,
  campaignId: string,
  subject: string,
  senderId: string | null,
  prepared: Target[],
  ids: string[],
  error: string,
) {
  const rows = prepared.map((item, index) => ({
    campaign_id: campaignId,
    email: item.email,
    member_number: item.memberNumber || null,
    subject,
    resend_id: ids[index] || null,
    email_error: ids[index] ? null : (error || "Resend no devolvió id"),
    sender_id: senderId,
  }));
  const { error: upsertError } = await admin
    .from("club_mail_sends")
    .upsert(rows, { onConflict: "campaign_id,email" });
  if (upsertError) throw new Error(upsertError.message);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Método no permitido" });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("ANON_KEY") || "";
    const apiKey = Deno.env.get("RESEND_API_KEY") || "";
    if (!apiKey) return json(503, { error: "Falta configurar RESEND_API_KEY." });
    if (!supabaseUrl || !serviceKey || !anonKey) return json(500, { error: "Falta la configuración de Supabase." });

    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: staff, error: staffError } = await userClient.rpc("has_staff_access");
    if (staffError || !staff) return json(403, { error: "Solo el personal del club puede enviar comunicados." });
    const { data: authData } = await userClient.auth.getUser();
    const senderId = authData?.user?.id || null;

    const body = await req.json().catch(() => ({}));
    const subject = String(body.subject || "").trim();
    const text = String(body.text || body.body || "").trim();
    const audience = String(body.audience || "all").trim();
    const memberNumber = String(body.memberNumber || body.memberId || "").trim();
    const campaignId = String(body.campaignId || crypto.randomUUID()).trim();
    if (!subject || !text) return json(400, { error: "Completá asunto y mensaje." });
    if (!/^[0-9a-f-]{36}$/i.test(campaignId)) return json(400, { error: "Campaña inválida." });

    const admin = createClient(supabaseUrl, serviceKey);
    const from = Deno.env.get("RESEND_FROM") || DEFAULT_FROM;
    const html = noticeHtml(subject, text);
    const done = await alreadySent(admin, campaignId);
    const counts = { sent: 0, failed: 0, skipped: done.size, more: false };
    const ready: Target[] = [];

    const takeMember = (row: { email?: string | null; member_number?: string | null }) => {
      const email = deliverableEmail(row.email);
      if (!email || done.has(email)) return;
      done.add(email);
      ready.push({ email, memberNumber: String(row.member_number || "") });
    };

    if (audience === "one") {
      if (!memberNumber) return json(400, { error: "Elegí un socio." });
      const { data, error } = await admin
        .from("members")
        .select("member_number, email")
        .eq("member_number", memberNumber)
        .maybeSingle();
      if (error) return json(500, { error: error.message });
      if (!data) return json(404, { error: "No encontramos a ese socio." });
      takeMember(data);
      if (!ready.length) {
        return json(200, {
          ok: true,
          campaignId,
          sent: 0,
          failed: 0,
          skipped: 1,
          more: false,
          error: "Ese socio no tiene un mail real.",
        });
      }
    } else {
      const need = BATCH * MAX_BATCHES;
      let fromRow = 0;
      let scannedFull = false;
      while (ready.length < need) {
        const { data, error } = await admin
          .from("members")
          .select("member_number, email")
          .neq("status", "inactive")
          .not("email", "is", null)
          .order("member_number")
          .range(fromRow, fromRow + PAGE - 1);
        if (error) return json(500, { error: error.message });
        const rows = data || [];
        scannedFull = rows.length === PAGE;
        for (const row of rows) takeMember(row);
        if (rows.length < PAGE) break;
        fromRow += PAGE;
      }
      counts.more = ready.length > need || (scannedFull && ready.length >= need);
    }

    const outgoing = ready.slice(0, audience === "one" ? ready.length : BATCH * MAX_BATCHES);
    counts.more = counts.more || outgoing.length < ready.length;
    const htmlBody = html;
    for (let i = 0; i < outgoing.length; i += BATCH) {
      const chunk = outgoing.slice(i, i + BATCH);
      const batch = await sendBatch(
        chunk,
        apiKey,
        from,
        subject,
        text,
        htmlBody,
        `${campaignId}/${chunk[0].email}/${chunk.length}`,
      );
      await recordBatch(admin, campaignId, subject, senderId, chunk, batch.ids, batch.error);
      counts.sent += batch.sent;
      counts.failed += batch.failed;
    }

    return json(200, { ok: true, campaignId, ...counts });
  } catch (error) {
    return json(500, { error: error instanceof Error ? error.message : "No se pudo enviar el mail." });
  }
});
