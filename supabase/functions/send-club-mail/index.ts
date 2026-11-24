import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  CLUB_MAIL_BATCH,
  CLUB_MAIL_FROM,
  CLUB_MAIL_MAX_BATCHES,
  CLUB_MAIL_PREVIEW_MS,
  bodyFingerprint,
  clubMailAuthDecision,
  clubMailRequestScope,
  CLUB_MAIL_RESERVED,
  CLUB_MAIL_UNCERTAIN_MARK,
  decidePreviewClaim,
  deliverableClubEmail,
  explainClubMailMember,
  publicMailCounts,
  resendBatchDisposition,
  scanClubMailAudience,
} from "../_shared/clubMailAudience.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DEFAULT_FROM = CLUB_MAIL_FROM;
const LOGO_SRC = "https://jockeyclubsj.com.ar/logo-jockey-club.png";
const BATCH = CLUB_MAIL_BATCH;
const MAX_BATCHES = CLUB_MAIL_MAX_BATCHES;

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
  return deliverableClubEmail(value);
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

async function claimedEmails(admin: Admin, campaignId: string) {
  const done = new Set<string>();
  let from = 0;
  for (;;) {
    const { data, error } = await admin
      .from("club_mail_sends")
      .select("email")
      .eq("campaign_id", campaignId)
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    const rows = data || [];
    for (const row of rows) done.add(String(row.email || "").toLowerCase());
    if (rows.length < 1000) break;
    from += 1000;
  }
  return done;
}

async function openClaim(admin: Admin, campaignId: string) {
  const { data, error } = await admin
    .from("club_mail_sends")
    .select("email")
    .eq("campaign_id", campaignId)
    .is("resend_id", null)
    .or(`email_error.eq.${CLUB_MAIL_RESERVED},email_error.eq.${CLUB_MAIL_UNCERTAIN_MARK},email_error.is.null`)
    .limit(1);
  if (error) throw new Error(error.message);
  return Boolean(data?.length);
}

async function holdingCampaign(admin: Admin) {
  const { data, error } = await admin
    .from("club_mail_campaigns")
    .select("id")
    .eq("status", "uncertain")
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.id ? String(data.id) : "";
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
  if (!prepared.length) return resendBatchDisposition(200, { data: [] }, 0);
  try {
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
    return resendBatchDisposition(res.status, payload, prepared.length);
  } catch {
    return resendBatchDisposition(null, null, prepared.length);
  }
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
    const unsigned = clubMailAuthDecision({ authorization: authHeader, staff: true });
    if (unsigned.status === 401) return json(401, { error: unsigned.error });
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: staff, error: staffError } = await userClient.rpc("has_staff_access");
    const allowed = clubMailAuthDecision({
      authorization: authHeader,
      staff,
      staffError: Boolean(staffError),
    });
    if (allowed.status !== 200) return json(allowed.status, { error: allowed.error });
    const { data: authData } = await userClient.auth.getUser();
    const senderId = authData?.user?.id || null;

    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "send").trim();
    const scope = clubMailRequestScope(body);
    const audience = scope.audience;
    const memberNumber = scope.memberNumber;
    const subject = String(body.subject || "").trim();
    const text = String(body.text || body.body || "").trim();
    const campaignId = String(body.campaignId || crypto.randomUUID()).trim();
    const previewId = String(body.previewId || "").trim();
    const admin = createClient(supabaseUrl, serviceKey);

    const pageMembers = async (from: number, to: number) => {
      const { data, error } = await admin
        .from("members")
        .select("member_number, full_name, email, status, meta")
        .order("member_number")
        .range(from, to);
      if (error) throw new Error(error.message);
      return data || [];
    };

    if (action === "lookup") {
      const query = String(body.query || "").replace(/[^0-9A-Za-zÁÉÍÓÚáéíóúÑñ ]/g, "").trim().slice(0, 40);
      if (query.length < 2) return json(400, { error: "Escribí un nombre o un número de socio." });
      const { data, error } = await admin
        .from("members")
        .select("member_number, full_name, email, status, meta")
        .or(`member_number.eq.${query},full_name.ilike."%${query}%"`)
        .order("member_number")
        .limit(8);
      if (error) return json(500, { error: error.message });
      const hits = [];
      for (const row of data || []) {
        const email = deliverableClubEmail(row.email);
        let siblings: string[] = [];
        if (email) {
          const { data: same } = await admin
            .from("members")
            .select("member_number")
            .ilike("email", email)
            .limit(8);
          siblings = (same || []).map((item) => String(item.member_number || ""));
        }
        hits.push(explainClubMailMember(row, siblings));
      }
      return json(200, { ok: true, hits });
    }

    if (action === "status") {
      if (!/^[0-9a-f-]{36}$/i.test(campaignId)) return json(400, { error: "Campaña inválida." });
      const { data, error } = await admin
        .from("club_mail_campaigns")
        .select("id, subject, confirmed_count, accepted_count, error_count, attempt_count, status, created_at, finished_at")
        .eq("id", campaignId)
        .maybeSingle();
      if (error) return json(500, { error: error.message });
      if (!data) return json(404, { error: "No está esa campaña." });
      return json(200, {
        ok: true,
        campaign: data,
        note: "Aceptado por Resend no significa que el correo ya llegó.",
      });
    }
    if (action === "acknowledge") {
      if (!/^[0-9a-f-]{36}$/i.test(campaignId)) return json(400, { error: "Campaña inválida." });
      const { data, error } = await admin
        .from("club_mail_campaigns")
        .update({ status: "failed", finished_at: new Date().toISOString() })
        .eq("id", campaignId)
        .eq("status", "uncertain")
        .select("id")
        .maybeSingle();
      if (error) return json(500, { error: error.message });
      if (!data) return json(404, { error: "No hay una campaña en duda con ese número." });
      return json(200, {
        ok: true,
        campaignId,
        note: "Quedó revisada. No se reenvió ningún correo.",
      });
    }
    if (action !== "preview" && action !== "send") return json(400, { error: "Acción desconocida." });
    if (!subject || !text) return json(400, { error: "Completá asunto y mensaje." });
    if (action === "send" && !/^[0-9a-f-]{36}$/i.test(campaignId)) return json(400, { error: "Campaña inválida." });

    const loadLive = async () => {
      if (audience === "one") {
        if (!memberNumber) throw new Error("Elegí un socio.");
        const { data, error } = await admin
          .from("members")
          .select("member_number, full_name, email, status, meta")
          .eq("member_number", memberNumber)
          .maybeSingle();
        if (error) throw new Error(error.message);
        if (!data) throw new Error("No encontramos a ese socio.");
        return scanClubMailAudience(async (from) => (from === 0 ? [data] : []));
      }
      return scanClubMailAudience(pageMembers);
    };

    if (action === "preview") {
      if (audience === "staff" || audience === "admin") {
        return json(400, { error: "La revisión del padrón es para socios." });
      }
      const live = await loadLive();
      const expiresAt = new Date(Date.now() + CLUB_MAIL_PREVIEW_MS).toISOString();
      const { data, error } = await admin
        .from("club_mail_previews")
        .insert({
          audience,
          member_number: memberNumber || null,
          subject,
          body_sha256: await bodyFingerprint(subject, text),
          audience_sha256: live.audienceSha256,
          counts: publicMailCounts(live),
          created_by: senderId,
          expires_at: expiresAt,
        })
        .select("id, expires_at")
        .single();
      if (error) return json(500, { error: error.message });
      const holdCampaignId = await holdingCampaign(admin);
      return json(200, {
        ok: true,
        previewId: data.id,
        expiresAt: data.expires_at,
        from: DEFAULT_FROM,
        counts: publicMailCounts(live),
        holdCampaignId: holdCampaignId || null,
      });
    }

    const from = Deno.env.get("RESEND_FROM") || DEFAULT_FROM;
    const html = noticeHtml(subject, text);
    const done = await claimedEmails(admin, campaignId);
    const counts = { sent: 0, failed: 0, skipped: done.size, more: false, confirmed: 0 };
    const ready: Target[] = [];

    if (audience === "one" || audience === "all") {
      if (!/^[0-9a-f-]{36}$/i.test(previewId)) {
        return json(409, { error: "Revisá los destinatarios antes de enviar." });
      }
      const { data: preview, error: previewError } = await admin
        .from("club_mail_previews")
        .select("*")
        .eq("id", previewId)
        .maybeSingle();
      if (previewError) return json(500, { error: previewError.message });
      const live = await loadLive();
      const decision = decidePreviewClaim(preview, {
        audienceSha256: live.audienceSha256,
        bodySha256: await bodyFingerprint(subject, text),
        campaignId,
      });
      if (!decision.ok) return json(decision.status, { error: decision.error });
      if (!decision.retry) {
        const hold = await holdingCampaign(admin);
        if (hold) {
          return json(409, {
            error: `Hay un envío en duda (${hold}). Revisalo antes de mandar otro.`,
            campaignId: hold,
            uncertain: true,
          });
        }
      }
      if (audience === "one" && live.recipients === 0) {
        return json(400, {
          error: live.excludedByBaja
            ? "Ese socio está inactivo y no entra en los avisos."
            : "Ese socio no tiene un mail real.",
        });
      }
      if (!decision.retry) {
        const { data: claimed, error: claimError } = await admin
          .from("club_mail_previews")
          .update({ consumed_at: new Date().toISOString(), campaign_id: campaignId })
          .eq("id", previewId)
          .is("consumed_at", null)
          .select("id")
          .maybeSingle();
        if (claimError) return json(500, { error: claimError.message });
        if (!claimed) {
          const { data: again } = await admin
            .from("club_mail_previews")
            .select("*")
            .eq("id", previewId)
            .maybeSingle();
          const second = decidePreviewClaim(again, {
            audienceSha256: live.audienceSha256,
            bodySha256: await bodyFingerprint(subject, text),
            campaignId,
          });
          if (!second.ok || !second.retry) {
            return json(409, { error: second.error || "Esa revisión ya se usó para un envío." });
          }
        } else {
        const { error: campaignError } = await admin.from("club_mail_campaigns").insert({
          id: campaignId,
          preview_id: previewId,
          subject,
          audience_sha256: live.audienceSha256,
          confirmed_count: live.recipients,
          sender_id: senderId,
          status: "sending",
        });
        if (campaignError) return json(500, { error: campaignError.message });
        }
      }
      if (await openClaim(admin, campaignId)) {
        await admin.from("club_mail_campaigns").update({
          status: "uncertain",
          finished_at: new Date().toISOString(),
        }).eq("id", campaignId);
        return json(409, {
          error: `El lote quedó en duda (${campaignId}). No lo reenvío hasta que se revise.`,
          campaignId,
          uncertain: true,
        });
      }
      counts.confirmed = live.recipients;
      const pending = live.targets.filter((target) => !done.has(target.email));
      ready.push(...pending.slice(0, BATCH * MAX_BATCHES));
      counts.more = pending.length > ready.length;
    } else if (audience === "staff" || audience === "admin") {
      const roles = audience === "admin"
        ? ["admin", "superadmin", "accountant"]
        : [
          "staff",
          "hr",
          "admin_employee",
          "gate_operator",
          "pool_operator",
          "cashier",
          "accountant",
          "admin",
          "superadmin",
        ];
      const { data, error } = await admin
        .from("profiles")
        .select("email, role")
        .in("role", roles)
        .not("email", "is", null);
      if (error) return json(500, { error: error.message });
      for (const row of data || []) {
        const email = deliverableEmail(row.email);
        if (!email || done.has(email)) continue;
        done.add(email);
        ready.push({ email, memberNumber: "" });
      }
      if (!ready.length) {
        return json(200, {
          ok: true,
          campaignId,
          sent: 0,
          failed: 0,
          skipped: 0,
          more: false,
          error: "No hay mails reales para esa audiencia de personal.",
        });
      }
    } else {
      return json(400, { error: "Destino desconocido." });
    }

    const outgoing = ready.slice(0, audience === "one" ? ready.length : BATCH * MAX_BATCHES);
    counts.more = counts.more || outgoing.length < ready.length;
    const htmlBody = html;
    for (let i = 0; i < outgoing.length; i += BATCH) {
      const chunk = outgoing.slice(i, i + BATCH);
      const { data: claimedRows, error: claimRowsError } = await admin.rpc("claim_club_mail_batch", {
        p_campaign_id: campaignId,
        p_subject: subject,
        p_sender: senderId,
        p_rows: chunk.map((item) => ({ email: item.email, memberNumber: item.memberNumber || "" })),
      });
      if (claimRowsError) return json(500, { error: claimRowsError.message });
      const ownedEmails = new Set((claimedRows || []).map((row: { email?: string }) => String(row.email || "").toLowerCase()));
      const owned = chunk.filter((item) => ownedEmails.has(item.email));
      if (!owned.length) continue;
      const batch = await sendBatch(
        owned,
        apiKey,
        from,
        subject,
        text,
        htmlBody,
        `${campaignId}/${owned[0].email}/${owned.length}`,
      );
      if (batch.disposition === "uncertain") {
        await admin.from("club_mail_sends").update({ email_error: CLUB_MAIL_UNCERTAIN_MARK })
          .eq("campaign_id", campaignId)
          .in("email", owned.map((item) => item.email))
          .is("resend_id", null);
        await admin.from("club_mail_campaigns").update({
          status: "uncertain",
          finished_at: new Date().toISOString(),
        }).eq("id", campaignId);
        return json(409, {
          error: `${batch.error} Campaña ${campaignId}.`,
          campaignId,
          uncertain: true,
        });
      }
      try {
        await recordBatch(admin, campaignId, subject, senderId, owned, batch.ids, batch.error);
      } catch {
        await admin.from("club_mail_sends").update({ email_error: CLUB_MAIL_UNCERTAIN_MARK })
          .eq("campaign_id", campaignId)
          .in("email", owned.map((item) => item.email))
          .is("resend_id", null);
        await admin.from("club_mail_campaigns").update({
          status: "uncertain",
          finished_at: new Date().toISOString(),
        }).eq("id", campaignId);
        return json(409, {
          error: `Resend aceptó el lote y no pude guardar los identificadores. No lo reenvío. Campaña ${campaignId}.`,
          campaignId,
          uncertain: true,
        });
      }
      if (batch.disposition === "accepted") counts.sent += batch.accepted;
      else counts.failed += owned.length;
    }

    if (audience === "all" || audience === "one") {
      const { error: progressError } = await admin.rpc("record_club_mail_progress", {
        p_campaign_id: campaignId,
        p_accepted: counts.sent,
        p_failed: counts.failed,
        p_more: counts.more,
      });
      if (progressError) return json(500, { error: progressError.message });
    }

    return json(200, {
      ok: true,
      campaignId,
      ...counts,
      note: "Aceptado por Resend no significa que el correo ya llegó.",
    });
  } catch (error) {
    return json(500, { error: error instanceof Error ? error.message : "No se pudo enviar el mail." });
  }
});
