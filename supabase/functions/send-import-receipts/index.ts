import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-import-secret",
};
const DEFAULT_FROM = "Jockey Club San Juan <socios@jockeyclubsj.com.ar>";
const PORTAL = "https://www.jockeyclubsj.com.ar/cuenta";
const LEGACY_IMPORT_SOURCE = "lila-sheet-nov2026";

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
  const email = String(value || "").trim().toLowerCase();
  if (!email.includes("@")) return "";
  if (email.includes("@lila-jockey")) return "";
  if (email.endsWith("@jockeyclubsj.com")) return "";
  return email;
}

function money(n: number) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 0,
  }).format(Number(n) || 0);
}

function dateLabel(iso: string) {
  const d = new Date(`${String(iso || "").slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso || "";
  return d.toLocaleDateString("es-AR", { day: "numeric", month: "long", year: "numeric" });
}

function periodLabel(period: string | null, paidAt: string) {
  const key = String(period || "").slice(0, 7);
  const m = key.match(/^(\d{4})-(\d{2})$/);
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, 1);
    const label = d.toLocaleDateString("es-AR", { month: "long", year: "numeric" });
    return label.charAt(0).toUpperCase() + label.slice(1);
  }
  return dateLabel(paidAt);
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
  const text = [
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
    PORTAL,
  ].filter((line, i, all) => line !== "" || all[i - 1] !== "").join("\n").replace(/\n{3,}/g, "\n\n").trim();

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
                <a href="${PORTAL}" style="display:inline-block;padding:12px 22px;color:#fffdf8;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:14px;">Ver Mi cuenta</a>
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

function isDone(meta: Record<string, unknown> | null | undefined) {
  if (!meta) return false;
  return Boolean(meta.receiptEmailId)
    || Boolean(meta.receiptMessageId)
    || meta.receiptSkip === "no-email"
    || meta.receiptSkip === "no-contact";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const apiKey = Deno.env.get("RESEND_API_KEY") || "";
    const expectedSecret = Deno.env.get("IMPORT_RECEIPTS_SECRET") || "lila-nov2026-receipts";
    if (!apiKey) return json(503, { error: "Falta RESEND_API_KEY" });
    if (!supabaseUrl || !serviceKey) return json(500, { error: "Falta config Supabase" });

    const authHeader = req.headers.get("authorization") || "";
    const secret = req.headers.get("x-import-secret") || "";
    const hasUserJwt = Boolean(authHeader && authHeader.toLowerCase().startsWith("bearer "));
    if (!hasUserJwt && secret !== expectedSecret) {
      return json(403, { error: "Secret o sesión inválidos" });
    }

    const body = await req.json().catch(() => ({}));
    const limit = Math.min(Math.max(Number(body?.limit) || 40, 1), 80);
    const dryRun = Boolean(body?.dryRun);
    const importSource = String(body?.importSource || LEGACY_IMPORT_SOURCE).trim() || LEGACY_IMPORT_SOURCE;

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: payments, error } = await admin
      .from("member_payments")
      .select("id, amount, paid_at, concept, period_label, receipt_number, method, meta, member_id, members!inner(id, email, full_name, member_number, meta)")
      .filter("meta->>importSource", "eq", importSource)
      .order("paid_at", { ascending: true })
      .limit(1000);

    if (error) return json(500, { error: error.message });

    const pending = (payments || []).filter((p) => !isDone((p.meta || {}) as Record<string, unknown>));

    let sent = 0;
    let skipped = 0;
    let failed = 0;
    const errors: string[] = [];
    const from = Deno.env.get("RESEND_FROM") || DEFAULT_FROM;

    for (const p of pending.slice(0, limit)) {
      const m = p.members as {
        id: string;
        email: string | null;
        full_name: string | null;
        member_number: number | string;
        meta: Record<string, unknown> | null;
      };
      const prevMeta = { ...((p.meta || {}) as Record<string, unknown>) };
      const to = deliverableEmail(m?.email) ||
        deliverableEmail(String(m?.meta?.contactEmail || ""));

      const bank = String(prevMeta.bank || "");
      const method = p.method === "transferencia"
        ? (bank ? `Transferencia bancaria · ${bank}` : "Transferencia bancaria")
        : (p.method || "Débito / transferencia");
      const copy = buildCopy({
        who: String(m.full_name || "socio").trim() || "socio",
        receipt: String(p.receipt_number || "—"),
        money: money(Number(p.amount) || 0),
        concept: String(p.concept || "Cuota social"),
        method,
        date: dateLabel(String(p.paid_at || "")),
        period: periodLabel(p.period_label, String(p.paid_at || "")),
        number: String(m.member_number || ""),
      });

      if (dryRun) {
        sent += 1;
        continue;
      }

      let receiptEmailId: string | null = null;
      if (to) {
        const idem = `import-receipt/${importSource}/${p.id}`.slice(0, 256);
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "Idempotency-Key": idem,
          },
          body: JSON.stringify({
            from,
            to: [to],
            subject: copy.subject,
            text: copy.text,
            html: copy.html,
          }),
        });
        const payload = await res.json().catch(() => ({})) as { id?: string; message?: string };
        if (!res.ok) {
          failed += 1;
          if (errors.length < 8) errors.push(`${m.member_number}: ${payload?.message || res.status}`);
          continue;
        }
        receiptEmailId = payload?.id || idem;
      }

      const recipient = String(m.member_number || "").replace(/[^a-zA-Z0-9._-]/g, "");
      let receiptMessageId: string | null = null;
      if (recipient) {
        const inserted = await admin.from("messages").insert({
          sender_name: "Administración",
          sender_key: "ops",
          recipient_key: recipient,
          subject: "Recibo de pago de cuota",
          body: [
            `Hola ${m.full_name || "socio"}, registramos tu pago de ${p.concept || "cuota social"}.`,
            `Total: ${money(Number(p.amount) || 0)}`,
            p.paid_at ? `Fecha: ${String(p.paid_at).slice(0, 10)}` : "",
            p.receipt_number ? `Comprobante: ${p.receipt_number}` : "",
          ].filter(Boolean).join("\n"),
          meta: { kind: "dues_receipt", importSource, paymentId: p.id },
          is_read: false,
        }).select("id").maybeSingle();
        receiptMessageId = inserted.data?.id || null;
      }

      if (!to && !receiptMessageId) {
        await admin.from("member_payments").update({
          meta: { ...prevMeta, receiptSkip: "no-contact", receiptSkipAt: new Date().toISOString() },
        }).eq("id", p.id);
        skipped += 1;
        continue;
      }

      await admin.from("member_payments").update({
        meta: {
          ...prevMeta,
          ...(receiptEmailId
            ? { receiptEmailId, receiptSentAt: new Date().toISOString(), receiptTo: to }
            : { receiptSkip: "no-email", receiptSkipAt: new Date().toISOString() }),
          ...(receiptMessageId ? { receiptMessageId } : {}),
        },
      }).eq("id", p.id);

      sent += 1;
    }

    return json(200, {
      ok: true,
      dryRun,
      importSource,
      pending: pending.length,
      processed: Math.min(limit, pending.length),
      sent,
      skipped,
      failed,
      errors,
    });
  } catch (err) {
    return json(500, { error: err instanceof Error ? err.message : "Error interno" });
  }
});
