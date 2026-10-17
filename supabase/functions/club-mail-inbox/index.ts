import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const INBOX_ID = "fc8f4396-a7c0-46ef-a90e-f288d7b0907b";

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function asText(value: unknown) {
  const html = String(value || "");
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

async function resendGet(path: string, apiKey: string) {
  const res = await fetch(`https://api.resend.com${path}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "User-Agent": "jockey-club-inbox/1.0",
    },
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const raw = String((payload as { message?: string }).message || `Resend ${res.status}`);
    if (/restricted to only send/i.test(raw)) {
      throw new Error("La clave de Resend solo puede enviar. Hace falta una clave con acceso a la bandeja.");
    }
    throw new Error(raw);
  }
  return payload as Record<string, unknown>;
}

function mapThread(row: Record<string, unknown>) {
  return {
    id: String(row.id || ""),
    subject: String(row.subject || "Sin asunto"),
    from: String(row.from || ""),
    receivedAt: String(row.received_at || ""),
    unread: row.read === false,
    count: Number(row.email_count) || 1,
  };
}

function mapEmail(row: Record<string, unknown>) {
  return {
    id: String(row.id || ""),
    from: String(row.from || ""),
    subject: String(row.subject || ""),
    receivedAt: String(row.received_at || ""),
    inbound: row.direction !== "outbound",
    text: String(row.text || "").trim() || asText(row.html),
  };
}

async function inboxApiKey(supabaseUrl: string, serviceKey: string) {
  const envKey = Deno.env.get("RESEND_INBOX_API_KEY") || "";
  if (envKey) return envKey;
  if (supabaseUrl && serviceKey) {
    const admin = createClient(supabaseUrl, serviceKey);
    const { data } = await admin.rpc("read_resend_inbox_key");
    const vaultKey = String(data || "").trim();
    if (vaultKey) return vaultKey;
  }
  return Deno.env.get("RESEND_API_KEY") || "";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Método no permitido" });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("ANON_KEY") || "";
    const apiKey = await inboxApiKey(supabaseUrl, serviceKey);
    const inboxId = Deno.env.get("RESEND_INBOX_ID") || INBOX_ID;
    if (!apiKey) return json(503, { error: "Falta configurar la clave de la bandeja." });
    if (!supabaseUrl || !anonKey) return json(500, { error: "Falta la configuración de Supabase." });

    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: staff, error: staffError } = await userClient.rpc("has_staff_access");
    if (staffError || !staff) return json(403, { error: "Solo el personal del club puede leer el mail." });

    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "list");

    if (action === "read") {
      const threadId = String(body.threadId || "").trim();
      if (!threadId) return json(400, { error: "Falta el hilo." });
      const payload = await resendGet(
        `/inboxes/${inboxId}/threads/${threadId}/emails?limit=40`,
        apiKey,
      );
      const emails = Array.isArray(payload.data) ? payload.data.map((row) => mapEmail(row as Record<string, unknown>)) : [];
      return json(200, { ok: true, emails });
    }

    const payload = await resendGet(`/inboxes/${inboxId}/threads?folders=inbox&limit=50`, apiKey);
    const threads = Array.isArray(payload.data) ? payload.data.map((row) => mapThread(row as Record<string, unknown>)) : [];
    return json(200, { ok: true, threads });
  } catch (error) {
    return json(500, { error: error instanceof Error ? error.message : "No se pudo leer el mail recibido." });
  }
});
