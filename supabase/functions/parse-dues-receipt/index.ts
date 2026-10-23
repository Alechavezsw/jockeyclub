import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GEMINI_MODELS = ["gemini-3.8-flash", "gemini-3.5-flash", "gemini-2.5-flash"];

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function scrubSecret(text: string, key: string) {
  return text.replaceAll(key, "").replace(/\s+/g, " ").trim().slice(0, 160);
}

function emptyParse() {
  return {
    amount: null,
    date: null,
    time: null,
    method: "desconocido",
    bankOrCard: null,
    reference: null,
    payerName: null,
    notes: null,
    confidence: 0,
    source: "none",
  };
}

function normalizeParse(raw: Record<string, unknown>, source: string) {
  const amount = Number(raw.amount);
  const confidence = Number(raw.confidence);
  return {
    amount: Number.isFinite(amount) ? Math.round(amount * 100) / 100 : null,
    date: raw.date ? String(raw.date).slice(0, 10) : null,
    time: raw.time ? String(raw.time).slice(0, 16) : null,
    method: ["transferencia", "tarjeta", "desconocido"].includes(String(raw.method || ""))
      ? String(raw.method)
      : "desconocido",
    bankOrCard: raw.bankOrCard ? String(raw.bankOrCard).slice(0, 120) : null,
    reference: raw.reference ? String(raw.reference).slice(0, 80) : null,
    payerName: raw.payerName ? String(raw.payerName).slice(0, 120) : null,
    notes: raw.notes ? String(raw.notes).slice(0, 240) : null,
    confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0,
    source,
  };
}

async function askGeminiReceipt(input: {
  mimeType: string;
  base64: string;
  fileName: string;
  expectedAmount: number | null;
  methodHint: string | null;
}) {
  const key = (Deno.env.get("GEMINI_API_KEY") || Deno.env.get("GOOGLE_GENERATIVE_AI_API_KEY") || "").trim();
  if (!key) return { ...emptyParse(), notes: "Sin clave Gemini." };

  const hint = input.methodHint ? `El cobro se carga como ${input.methodHint}.` : "";
  const expected = input.expectedAmount != null && Number.isFinite(input.expectedAmount)
    ? `El importe esperado del cobro es ${input.expectedAmount}.`
    : "";
  const system = `Sos el lector de comprobantes del Jockey Club San Juan.
Leés transferencias bancarias y tickets de tarjeta (POS / voucher).
No inventés datos: si no se ve, poné null.
Respondé SOLO un JSON:
{"amount":number|null,"date":"YYYY-MM-DD"|null,"time":"HH:MM"|null,"method":"transferencia"|"tarjeta"|"desconocido","bankOrCard":string|null,"reference":string|null,"payerName":string|null,"notes":string|null,"confidence":0..1}
${hint} ${expected}`.trim();

  const mime = String(input.mimeType || "application/octet-stream");
  const inlineData = {
    mimeType: mime.startsWith("image/") || mime === "application/pdf" ? mime : "application/pdf",
    data: String(input.base64 || "").replace(/\s+/g, ""),
  };

  for (const model of GEMINI_MODELS) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": key,
          },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents: [{
              role: "user",
              parts: [
                { text: `Desglosá el comprobante ${input.fileName || "archivo"}.` },
                { inlineData },
              ],
            }],
            generationConfig: { maxOutputTokens: 500, responseMimeType: "application/json" },
          }),
        },
      );
      if (!response.ok) {
        console.error("parse-dues-receipt", model, response.status, scrubSecret(await response.text(), key));
        continue;
      }
      const payload = await response.json();
      const text = payload?.candidates?.[0]?.content?.parts
        ?.map((part: { text?: string }) => part.text)
        .join("") || "";
      if (!text.trim()) continue;
      try {
        const parsed = JSON.parse(text);
        return normalizeParse(parsed && typeof parsed === "object" ? parsed : {}, "gemini");
      } catch {
        console.error("parse-dues-receipt", model, "json");
      }
    } catch (error) {
      console.error("parse-dues-receipt", model, error instanceof Error ? error.message : "falló");
    }
  }

  return emptyParse();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Método no permitido" });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("ANON_KEY") || "";
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: staff, error: staffError } = await userClient.rpc("has_staff_access");
    if (staffError || !staff) return json(403, { error: "Solo personal del club." });

    const body = await req.json().catch(() => ({}));
    const base64 = String(body.base64 || "").trim();
    if (!base64) return json(400, { error: "Falta el archivo." });
    if (base64.length > 8_000_000) return json(400, { error: "El archivo es demasiado grande." });

    const parsed = await askGeminiReceipt({
      mimeType: String(body.mimeType || "application/octet-stream"),
      base64,
      fileName: String(body.fileName || "comprobante"),
      expectedAmount: body.expectedAmount != null ? Number(body.expectedAmount) : null,
      methodHint: body.methodHint ? String(body.methodHint) : null,
    });
    return json(200, parsed);
  } catch (error) {
    return json(500, { error: error instanceof Error ? error.message : "No se pudo leer el comprobante." });
  }
});
