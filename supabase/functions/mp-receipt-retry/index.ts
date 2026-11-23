import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { settleMpReceipt } from "../_shared/mpReceiptJob.js";
import { deliverMpReceipt } from "../_shared/mpReceiptDelivery.ts";

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Método no permitido." });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
    if (!supabaseUrl || !serviceKey || !anonKey) return json(500, { error: "Falta la configuración de Supabase." });

    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: staff, error: staffError } = await userClient.rpc("has_staff_access");
    if (staffError || !staff) return json(403, { error: "Solo Administración puede reintentar comprobantes." });

    const body = await req.json().catch(() => ({}));
    const intentId = String(body?.intentId || "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(intentId)) return json(400, { error: "Falta el cobro." });

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: intent } = await admin
      .from("mp_intents")
      .select("id, status, applied_at")
      .eq("id", intentId)
      .maybeSingle();
    if (!intent?.applied_at || String(intent.status) !== "approved") {
      return json(409, { error: "Ese cobro todavía no está acreditado." });
    }

    const receipt = await settleMpReceipt({
      admin,
      intentId,
      deliver: (prior) => deliverMpReceipt(admin, intentId, prior),
    });
    return json(200, { ok: true, receipt });
  } catch (err) {
    const message = err instanceof Error ? err.message : "No se pudo reintentar el comprobante.";
    return json(500, { error: message });
  }
});
