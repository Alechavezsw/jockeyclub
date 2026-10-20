import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ALLOWED_ORIGINS = new Set([
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
  "https://jockeyclubsj.com.ar",
  "https://www.jockeyclubsj.com.ar",
]);

const STORE_EXTERNAL_ID = "jcsj-sede";

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function money(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
}

function moneyText(value: number) {
  return value.toFixed(2);
}

const PORTAL_WWW = "https://www.jockeyclubsj.com.ar";
const PORTAL_APEX = "https://jockeyclubsj.com.ar";

function originOf(raw: unknown, fallback: string) {
  const next = String(raw || "").trim().replace(/\/+$/, "");
  if (/jockeyclubsj\.org/i.test(next)) return PORTAL_WWW;
  return ALLOWED_ORIGINS.has(next) ? next : fallback.replace(/\/+$/, "");
}

function accountOrigin(origin: string) {
  if (origin === PORTAL_APEX) return PORTAL_WWW;
  return origin;
}

function titleOf(kind: string) {
  if (kind === "pool") return "Canon pileta · Jockey Club San Juan";
  if (kind === "subscription") return "Suscripción cuota social · Jockey Club San Juan";
  return "Cuota social · Jockey Club San Juan";
}

function channelOf(kind: string, raw: unknown) {
  const next = String(raw || "").trim();
  if (kind === "subscription" || next === "subscription") return "subscription";
  if (next === "onsite") return "onsite";
  return "online";
}

function isDeliverableEmail(value: unknown) {
  const email = String(value || "").trim();
  if (!email.includes("@")) return false;
  const lower = email.toLowerCase();
  if (lower.includes("@lila-jockey")) return false;
  if (lower.endsWith("@jockeyclubsj.com")) return false;
  return true;
}

function firstDeliverableEmail(...candidates: unknown[]) {
  return String(candidates.find((value) => isDeliverableEmail(value)) || "").trim();
}

function dniOf(value: unknown) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 11 ? digits : "";
}

function memberSelect() {
  return "id, member_number, full_name, email, profile_id, outstanding_balance, document_number, tier, meta";
}

async function mpJson(path: string, token: string, init: { method?: string; body?: Record<string, unknown> } = {}) {
  const method = init.method || "GET";
  const res = await fetch(`https://api.mercadopago.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(method !== "GET" ? { "X-Idempotency-Key": crypto.randomUUID() } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = String(data?.message || data?.error || data?.cause?.[0]?.description || `Mercado Pago ${res.status}`);
    throw new Error(msg);
  }
  return data as Record<string, unknown>;
}

function firstId(payload: unknown) {
  if (payload && typeof payload === "object" && "id" in payload && (payload as { id?: unknown }).id != null) {
    return String((payload as { id: unknown }).id);
  }
  const rows = Array.isArray((payload as { results?: unknown[] } | null)?.results)
    ? (payload as { results: unknown[] }).results
    : [];
  const first = rows[0];
  if (first && typeof first === "object" && first !== null && "id" in first) {
    return String((first as { id: unknown }).id);
  }
  return "";
}

async function ensureCashRegister(token: string, posId: string) {
  const listed = await mpJson(`/pos?external_id=${encodeURIComponent(posId)}`, token).catch(() => null);
  if (firstId(listed)) return posId;

  const me = await mpJson("/users/me", token);
  const userId = String(me.id || "");
  if (!userId) throw new Error("No se pudo leer la cuenta vendedora de Mercado Pago.");

  let storeId = "";
  const found = await mpJson(`/users/${userId}/stores/search?external_id=${encodeURIComponent(STORE_EXTERNAL_ID)}`, token).catch(() => null);
  storeId = firstId(found);

  if (!storeId) {
    try {
      const createdStore = await mpJson(`/users/${userId}/stores`, token, {
        method: "POST",
        body: {
          name: "Jockey Club San Juan",
          external_id: STORE_EXTERNAL_ID,
          location: {
            street_name: "República del Líbano",
            street_number: 1799,
            city_name: "Rivadavia",
            state_name: "San Juan",
            latitude: -31.5317,
            longitude: -68.5947,
            reference: "Sede Rivadavia",
          },
        },
      });
      storeId = firstId(createdStore);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (!/already|existe|duplicate|external_id/i.test(msg)) throw err;
      const again = await mpJson(`/users/${userId}/stores/search?external_id=${encodeURIComponent(STORE_EXTERNAL_ID)}`, token);
      storeId = firstId(again);
    }
  }
  if (!storeId) throw new Error("No se pudo abrir la sucursal de Mercado Pago.");

  await mpJson("/pos", token, {
    method: "POST",
    body: {
      name: "Caja sede",
      fixed_amount: true,
      store_id: storeId,
      external_store_id: STORE_EXTERNAL_ID,
      external_id: posId,
      category: 621102,
    },
  });
  return posId;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
    const token = Deno.env.get("MP_ACCESS_TOKEN") || "";
    const site = Deno.env.get("SITE_URL") || PORTAL_WWW;
    if (!supabaseUrl || !serviceKey || !anonKey) return json(500, { error: "Falta la configuración de Supabase." });
    if (!token) return json(503, { error: "Falta MP_ACCESS_TOKEN en las secretas de Supabase." });

    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: authData, error: authErr } = await userClient.auth.getUser();
    const user = authData?.user;
    if (authErr || !user) return json(401, { error: "No autenticado" });

    const body = await req.json().catch(() => ({}));
    const kind = String(body?.kind || "dues");
    if (!["dues", "pool", "subscription"].includes(kind)) {
      return json(400, { error: "Tipo de cobro inválido." });
    }
    const amount = money(body?.amount);
    if (amount <= 0) return json(400, { error: "Importe inválido." });
    const channel = channelOf(kind, body?.channel);

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: setting } = await admin.from("app_settings").select("value").eq("key", "mercadopago").maybeSingle();
    const mpSet = setting?.value && typeof setting.value === "object" ? setting.value as Record<string, unknown> : {};
    if (mpSet.enabled !== true) {
      return json(503, { error: "Mercado Pago todavía no está habilitado en Configuración." });
    }

    const { data: isStaff } = await userClient.rpc("has_staff_access");
    const wantedNumber = String(body?.memberNumber || "").trim();

    let member: Record<string, unknown> | null = null;
    if (wantedNumber && isStaff) {
      const { data } = await admin
        .from("members")
        .select(memberSelect())
        .eq("member_number", wantedNumber)
        .maybeSingle();
      member = data;
    }
    if (!member) {
      const { data } = await admin
        .from("members")
        .select(memberSelect())
        .eq("profile_id", user.id)
        .maybeSingle();
      member = data;
    }
    if (!member) {
      const { data: profile } = await admin.from("profiles").select("document_number, email").eq("id", user.id).maybeSingle();
      const dni = String(profile?.document_number || "").replace(/\D/g, "");
      if (dni) {
        const { data } = await admin
          .from("members")
          .select(memberSelect())
          .eq("document_number", dni)
          .maybeSingle();
        member = data;
      }
    }
    if (!member) return json(400, { error: "No encontramos la ficha del socio." });

    if (kind === "dues" || kind === "subscription") {
      const { data: exempt } = await admin.rpc("member_id_is_dues_exempt", { mid: member.id });
      if (exempt === true) {
        return json(400, { error: "Esta categoría no abona cuota social." });
      }
    }

    const origin = kind === "pool" ? originOf(body?.origin, site) : accountOrigin(originOf(body?.origin, site));
    const backPath = kind === "pool" ? "/entrada-pileta" : "/cuenta";
    const success = `${origin}${backPath}?mp=ok`;
    const failure = `${origin}${backPath}?mp=fail`;
    const pending = `${origin}${backPath}?mp=pending`;
    const notify = `${supabaseUrl}/functions/v1/mp-webhook`;
    const { data: profile } = await admin.from("profiles").select("document_number, email").eq("id", user.id).maybeSingle();
    const email = firstDeliverableEmail(member.email, profile?.email, user.email);
    const dni = dniOf(member.document_number) || dniOf(profile?.document_number);
    const concept = String(body?.concept || titleOf(kind)).slice(0, 240);
    const guestName = String(body?.guestName || "").trim().slice(0, 80);
    const posId = String(mpSet.posId || "jcsj-caja").trim().slice(0, 40) || "jcsj-caja";

    const { data: intent, error: intentErr } = await admin
      .from("mp_intents")
      .insert({
        kind,
        status: "pending",
        member_id: member.id,
        member_number: member.member_number,
        amount,
        concept,
        payer_email: email || null,
        back_url: success,
        created_by: user.id,
        external_reference: crypto.randomUUID(),
        meta: { guestName: guestName || undefined, channel },
      })
      .select("*")
      .single();
    if (intentErr || !intent) return json(500, { error: intentErr?.message || "No se pudo abrir el cobro." });

    if (channel === "subscription") {
      if (!email) {
        return json(400, { error: "Para el débito mensual hace falta un mail real del socio." });
      }
      const created = await mpJson("/preapproval", token, {
        method: "POST",
        body: {
          reason: concept,
          external_reference: intent.id,
          payer_email: email,
          auto_recurring: {
            frequency: 1,
            frequency_type: "months",
            transaction_amount: amount,
            currency_id: "ARS",
            billing_day: 10,
            billing_day_proportional: false,
          },
          back_url: `${accountOrigin(origin)}/cuenta?mp=sub`,
          status: "pending",
          notification_url: notify,
        },
      });
      const initPoint = String(created.init_point || created.sandbox_init_point || "");
      await admin.from("mp_intents").update({
        preapproval_id: created.id ? String(created.id) : null,
        init_point: initPoint || null,
        sandbox_init_point: created.sandbox_init_point ? String(created.sandbox_init_point) : null,
        updated_at: new Date().toISOString(),
      }).eq("id", intent.id);
      if (!initPoint) return json(502, { error: "Mercado Pago no devolvió el enlace de adhesión." });
      return json(200, { id: intent.id, kind, channel, status: "pending", initPoint, qrData: null, amount });
    }

    if (channel === "onsite") {
      await ensureCashRegister(token, posId);
      const created = await mpJson("/v1/orders", token, {
        method: "POST",
        body: {
          type: "qr",
          total_amount: moneyText(amount),
          description: concept,
          external_reference: intent.id,
          expiration_time: "PT20M",
          config: { qr: { external_pos_id: posId, mode: "dynamic" } },
          transactions: { payments: [{ amount: moneyText(amount) }] },
          items: [{
            title: concept,
            unit_price: moneyText(amount),
            quantity: 1,
            unit_measure: "unit",
          }],
        },
      });
      const typeResponse = created.type_response as { qr_data?: string } | undefined;
      const qrData = String(typeResponse?.qr_data || "");
      await admin.from("mp_intents").update({
        preference_id: created.id ? String(created.id) : null,
        updated_at: new Date().toISOString(),
        meta: { ...(intent.meta || {}), channel, qr_data: qrData || undefined, order_id: created.id },
      }).eq("id", intent.id);
      if (!qrData) return json(502, { error: "Mercado Pago no devolvió el QR de mostrador." });
      return json(200, { id: intent.id, kind, channel, status: "pending", initPoint: null, qrData, amount });
    }

    const created = await mpJson("/checkout/preferences", token, {
      method: "POST",
      body: {
        items: [{
          title: concept,
          quantity: 1,
          unit_price: amount,
          currency_id: "ARS",
        }],
        external_reference: intent.id,
        notification_url: notify,
        statement_descriptor: "JOCKEY CLUB SJ",
        binary_mode: true,
        metadata: { kind, member_number: member.member_number, channel },
        payment_methods: { installments: 1, default_installments: 1 },
        back_urls: { success, failure, pending },
        ...(email ? {
          payer: {
            email,
            ...(dni ? { identification: { type: "DNI", number: dni } } : {}),
          },
        } : {}),
        ...(origin.startsWith("https://") ? { auto_return: "approved" } : {}),
      },
    });
    const initPoint = String(created.init_point || created.sandbox_init_point || "");
    await admin.from("mp_intents").update({
      preference_id: created.id ? String(created.id) : null,
      init_point: initPoint || null,
      sandbox_init_point: created.sandbox_init_point ? String(created.sandbox_init_point) : null,
      updated_at: new Date().toISOString(),
    }).eq("id", intent.id);
    if (!initPoint) return json(502, { error: "Mercado Pago no devolvió el enlace de pago." });

    return json(200, { id: intent.id, kind, channel, status: "pending", initPoint, qrData: null, amount });
  } catch (err) {
    return json(500, { error: err instanceof Error ? err.message : "No se pudo abrir Mercado Pago." });
  }
});
