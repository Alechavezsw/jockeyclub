import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GUIDE = `Mapa entero del Jockey Club San Juan (Sede Rivadavia).
PANEL (rail): Inicio · IA/Jev (Consulta, Revisión, Predicciones, Manual) · Operación: Socios, Cuotas/Saldos, Reservas, Ingresos, Acceso QR (/acceso), Entrada pileta (/entrada-pileta), Pileta (/pileta) · Club: Disciplinas, Fiestas · Gestión: Caja (propia), Concesiones (/concesiones), Contabilidad, Personal, Reportes · Comunicación: Novedades/Revista, Encuestas, Alertas, Reclamos, Mensajería · Administración: Profesores, Usuarios y altas · Sistema: Migración.
CAJA (módulo Gestión): saldos efectivo/bancos/cheques, movimientos por hoja (50 filas), cobranzas, pago a proveedores. Comprobante automático (mail+MD) en cobros acreditados a socio.
CONTABILIDAD: Diario, Mayor, Crear asiento, Balance, Resultados, Plan de cuentas, Operación (resto), Gastos, Proveedores, Retenciones, Otros ingresos, Intereses, Sin identificar, Galicia, Gastos fijos, Saldos, Órdenes de pago. Cajero y portería solo ven caja. Administrador no entra a Contabilidad.
PORTAL SOCIO: https://www.jockeyclubsj.com.ar/cuenta (Mi cuenta: Checkout Pro, débito mensual, transferencia). Reservas /reservas · Revista /revista · Perfil /perfil. Alta /registro.
PROFESOR: /asistencia. No entra al panel.
ROLES: socio, profesor, personal, RR.HH., empleado de administración, operador de portería, operario de pileta, cajero, contador, administrador (sin contabilidad), superadministrador. Liquidan cuotas: superadmin y contador.
CUOTA: vence el 10; desde el 11 mora; recargo 10% solo familiar e individual. Vitalicio/fundador/comisión no abonan cuota ni reciben avisos/cobros de cuota.
LILA/Societas: empalme 1 de octubre de 2026. Desde noviembre 2026 liquida esta app. Migración guarda cortes. No reimportar lo que ya está.`;

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function todayAR() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/San_Juan" });
}

function monthKeyOf(iso: string) {
  return String(iso || "").slice(0, 7);
}

function money(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

async function headCount(query: PromiseLike<{ count: number | null; error: { message?: string } | null }>) {
  const { count, error } = await query;
  return error ? 0 : (count || 0);
}

async function liveMember(userClient: ReturnType<typeof createClient>, lastUser: string) {
  const q = lastUser.slice(0, 80);
  const digits = q.replace(/\D/g, "");
  const looksLikePerson = /socio|ficha|saldo|debe|n[uú]mero/i.test(q) || digits.length >= 3;
  if (!looksLikePerson) return null;
  const { data: hits } = await userClient.rpc("search_members_lookup", {
    p_query: digits.length >= 3 ? digits : q,
    p_limit: 5,
  });
  const rows = Array.isArray(hits) ? hits : [];
  if (!rows.length) return null;
  if (rows.length === 1) {
    const { data } = await userClient
      .from("members")
      .select("member_number, full_name, status, outstanding_balance, next_due_date, tier")
      .eq("id", rows[0].id)
      .maybeSingle();
    return data;
  }
  return {
    matches: rows.map((row) => ({
      member_number: row.member_number,
      full_name: row.full_name,
      status: row.status,
    })),
  };
}

async function liveBrief(userClient: ReturnType<typeof createClient>, hint: Record<string, unknown>) {
  const today = todayAR();
  const month = monthKeyOf(today);
  const lastUser = String((hint.lastQuestion as string) || "");
  const [activos, deudores, reservas, puerta, pileta, reclamos, news, surveys, events, staff, mensajes, concesiones, altas, portal, proveedores, ordenes, member] = await Promise.all([
    headCount(userClient.from("members").select("id", { count: "exact", head: true }).neq("status", "inactive")),
    headCount(userClient.from("members").select("id", { count: "exact", head: true }).gt("outstanding_balance", 0).neq("status", "inactive")),
    headCount(userClient.from("reservations").select("id", { count: "exact", head: true }).eq("reservation_date", today).neq("status", "cancelled")),
    headCount(userClient.from("access_logs").select("id", { count: "exact", head: true }).eq("logged_on", today)),
    headCount(userClient.from("pool_accesses").select("id", { count: "exact", head: true }).eq("access_date", today)),
    headCount(userClient.from("claims").select("id", { count: "exact", head: true }).in("status", ["open", "pending"])),
    headCount(userClient.from("news_posts").select("id", { count: "exact", head: true })),
    headCount(userClient.from("surveys").select("id", { count: "exact", head: true })),
    headCount(userClient.from("club_events").select("id", { count: "exact", head: true })),
    headCount(userClient.from("employees").select("id", { count: "exact", head: true })),
    headCount(userClient.from("messages").select("id", { count: "exact", head: true })),
    headCount(userClient.from("concessions").select("id", { count: "exact", head: true })),
    headCount(userClient.from("membership_applications").select("id", { count: "exact", head: true })),
    headCount(userClient.from("portal_access_requests").select("id", { count: "exact", head: true })),
    headCount(userClient.from("suppliers").select("id", { count: "exact", head: true })),
    headCount(userClient.from("payment_orders").select("id", { count: "exact", head: true })),
    liveMember(userClient, lastUser),
  ]);

  return {
    today,
    month,
    activos: Number(hint.activos) || activos,
    deudores: Number(hint.deudores) || deudores,
    reservasHoy: Number(hint.reservasHoy) || reservas,
    porteriaHoy: Number(hint.porteriaHoy) || puerta,
    piletaHoy: Number(hint.piletaHoy) || pileta,
    reclamosAbiertos: Number(hint.reclamosAbiertos) || reclamos,
    novedades: Number(hint.novedades) || news,
    encuestas: Number(hint.encuestas) || surveys,
    fiestas: Number(hint.fiestas) || events,
    personal: Number(hint.personal) || staff,
    mensajes: Number(hint.mensajes) || mensajes,
    concesiones: Number(hint.concesiones) || concesiones,
    altasPendientes: Number(hint.altasPendientes) || altas,
    pedidosPortal: Number(hint.pedidosPortal) || portal,
    proveedores,
    ordenesPago: ordenes,
    collected: money(hint.collected),
    liquidated: money(hint.liquidated),
    bien: money(hint.bien),
    fichas: money(hint.fichas),
    titulares: money(hint.titulares),
    monthLabel: String(hint.monthLabel || month),
    member,
  };
}

function localAnswer(question: string, brief: Record<string, unknown>) {
  const q = question.toLowerCase();
  const bits: string[] = [];
  const monthLabel = String(brief.monthLabel || brief.month);
  if (/recaud|cobra/.test(q)) bits.push(`Recaudado de ${monthLabel}: $ ${Number(brief.collected || 0).toLocaleString("es-AR")}.`);
  if (/liquid/.test(q)) bits.push(`Liquidado de ${monthLabel}: $ ${Number(brief.liquidated || 0).toLocaleString("es-AR")}.`);
  if (/activo|padr[oó]n/.test(q)) bits.push(`Socios activos: ${brief.activos}. Con saldo: ${brief.deudores}.`);
  if (/puerta|porter|pileta|reserva/.test(q)) {
    bits.push(`Hoy ${brief.today}: ${brief.porteriaHoy} lecturas de portería, ${brief.reservasHoy} reservas, ${brief.piletaHoy} pileta.`);
  }
  if (/reclamo/.test(q)) bits.push(`Reclamos abiertos: ${brief.reclamosAbiertos}.`);
  if (/fiesta|evento/.test(q)) bits.push(`Fiestas cargadas: ${brief.fiestas}.`);
  if (/personal|empleado/.test(q)) bits.push(`Personal en legajo: ${brief.personal}.`);
  if (/novedad|revista/.test(q)) bits.push(`Notas en Revista: ${brief.novedades}.`);
  if (/proveedor/.test(q)) bits.push(`Proveedores: ${brief.proveedores}. Órdenes de pago: ${brief.ordenesPago}.`);
  if (/concesi/.test(q)) bits.push(`Concesiones: ${brief.concesiones}.`);
  if (brief.member && !Array.isArray((brief.member as { matches?: unknown }).matches)) {
    const m = brief.member as { member_number?: string; full_name?: string; outstanding_balance?: number; status?: string };
    bits.push(`Socio ${m.member_number} · ${m.full_name}: ${m.status}, saldo $ ${Number(m.outstanding_balance || 0).toLocaleString("es-AR")}.`);
  }
  if (/c[oó]mo|ense[nñ]/.test(q)) {
    bits.push("Inicio: recaudado y vencimiento. Socios: padrón. Cuotas: liquidar. Caja: Contabilidad. Portería: Ingresos.");
  }
  if (!bits.length) {
    bits.push(`Hoy ${brief.today}. Activos ${brief.activos}, deudores ${brief.deudores}, portería ${brief.porteriaHoy}. Preguntá por un número de socio, el mes o cómo se usa una sección.`);
  }
  return bits.join(" ");
}

/** Pro primero (más criterio); flash como respaldo rápido. */
const GEMINI_MODELS = [
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-2.0-flash",
];

function scrubSecret(text: string, key: string) {
  return text.replaceAll(key, "").replace(/\s+/g, " ").trim().slice(0, 160);
}

async function askGemini(
  messages: { role: string; content: string }[],
  brief: Record<string, unknown>,
  guide = GUIDE,
) {
  const key = (Deno.env.get("GEMINI_API_KEY") || Deno.env.get("GOOGLE_GENERATIVE_AI_API_KEY") || "").trim();
  const fallback = { text: localAnswer(messages.at(-1)?.content || "", brief), source: "libro" };
  if (!key) return fallback;

  const system = `Sos Jev, secretario del Jockey Club San Juan (Sede Rivadavia), potenciado con Gemini.
Hablás en español rioplatense, claro y con criterio. Tutéas.
Tu trabajo: CONTESTAR preguntas inteligentes sobre el club usando el LIBRO EN VIVO y el MANUAL.
Cruzá datos (mes, padrón, mora, puerta, caja, revisión) cuando ayuden. Priorizá 1–3 acciones concretas.
Si la pregunta es ambigua, hacé UNA pregunta corta en "next" en vez de adivinar.
"¿Cómo se hace…?": pasos numerados en "text" (máx. 6) y la sección en "tab".
No inventés montos, socios, pantallas ni plazos. Si no está en el LIBRO/MANUAL, decilo.
Comprobante automático: todo cobro acreditado a socio manda PDF por mail + MD.
Primero el veredicto, después el texto útil, después el siguiente paso.
No suenes a chatbot genérico. No repitas el mismo número dos veces.
Respondé SOLO un JSON:
{"verdict":"...","text":"...","next":"...","tab":"dashboard|jev|members|dues|bookings|disciplines|pool|pool_gate|access|qr_gate|accounting|caja|staff|teachers|events|alerts|claims|messaging|news|reports|surveys|system|migration|concessions|null","focus":"diary|mayor|create|balance|results|cash|expenses|suppliers|payment_orders|libre_deuda|null"}
LIBRO EN VIVO:
${JSON.stringify(brief)}
CÓMO SE USA LA APP:
${String(guide || GUIDE).slice(0, 12000)}`;

  const contents = messages.slice(-10).map((row) => ({
    role: row.role === "assistant" ? "model" : "user",
    parts: [{ text: String(row.content || "").slice(0, 5000) }],
  }));

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
            contents,
            generationConfig: {
              maxOutputTokens: 1200,
              temperature: 0.4,
              responseMimeType: "application/json",
            },
          }),
        },
      );
      if (!response.ok) {
        const err = scrubSecret(await response.text(), key);
        console.error("jev gemini", model, response.status, err);
        continue;
      }
      const payload = await response.json();
      const text = payload?.candidates?.[0]?.content?.parts
        ?.map((part: { text?: string }) => part.text)
        .join("") || "";
      if (!text.trim()) {
        console.error("jev gemini", model, "empty");
        continue;
      }
      return { text: text.trim(), source: "gemini" };
    } catch (error) {
      console.error("jev gemini", model, error instanceof Error ? error.message : "falló");
    }
  }

  return fallback;
}

async function askGeminiCompose(input: {
  prompt: string;
  audience: string;
  channels: string;
  draft: string;
  memberName: string;
}) {
  const key = (Deno.env.get("GEMINI_API_KEY") || Deno.env.get("GOOGLE_GENERATIVE_AI_API_KEY") || "").trim();
  if (!key) return { error: "La IA no puede redactar ahora." };

  const who = input.audience === "one"
    ? `un socio${input.memberName ? ` (${input.memberName})` : ""}`
    : "todos los socios";
  const system = `Sos el secretario de redacción del Jockey Club San Juan, Sede Rivadavia.
Redactás comunicados: tono formal, cercano, rioplatense, sin marketing, sin emojis, sin anglicismos innecesarios.
No inventes fechas, montos, horarios ni beneficios que el pedido no dé.
Si falta un dato, dejá un hueco claro en el cuerpo (por ejemplo: [fecha]).
El destinatario es ${who}. Canal: ${input.channels || "mensaje interno y/o mail"}.
Respondé SOLO un JSON: {"subject":"...","body":"..."}.
El body es texto plano con saltos de línea, 2 a 6 párrafos, listo para enviar.
Cierre: Secretaría del Jockey Club San Juan.`;

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
              parts: [{
                text: [
                  input.prompt ? `Pedido:\n${input.prompt.slice(0, 4000)}` : "",
                  input.draft ? `Borrador actual:\n${input.draft.slice(0, 4000)}` : "",
                ].filter(Boolean).join("\n\n") || "Redactá un comunicado institucional breve.",
              }],
            }],
            generationConfig: { maxOutputTokens: 900, responseMimeType: "application/json" },
          }),
        },
      );
      if (!response.ok) {
        const err = scrubSecret(await response.text(), key);
        console.error("jev compose", model, response.status, err);
        continue;
      }
      const payload = await response.json();
      const text = payload?.candidates?.[0]?.content?.parts
        ?.map((part: { text?: string }) => part.text)
        .join("") || "";
      if (!text.trim()) continue;
      try {
        const parsed = JSON.parse(text);
        const subject = String(parsed.subject || "").trim();
        const body = String(parsed.body || parsed.text || "").trim();
        if (subject && body) return { subject, body, source: "gemini" };
      } catch {
        console.error("jev compose", model, "json");
      }
    } catch (error) {
      console.error("jev compose", model, error instanceof Error ? error.message : "falló");
    }
  }

  return { error: "La IA no pudo redactar el comunicado." };
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
    if (staffError || !staff) return json(403, { error: "Jev solo habla con personal del club." });

    const body = await req.json().catch(() => ({}));
    if (String(body.mode || "") === "compose") {
      const prompt = String(body.prompt || "").trim();
      const draft = String(body.draft || "").trim();
      if (!prompt && !draft) return json(400, { error: "Decile a la IA de qué se trata el comunicado." });
      const drafted = await askGeminiCompose({
        prompt,
        audience: String(body.audience || "all"),
        channels: String(body.channels || "dm y mail"),
        draft,
        memberName: String(body.memberName || ""),
      });
      if (drafted.error) return json(503, drafted);
      return json(200, drafted);
    }

    const messages = Array.isArray(body.messages) ? body.messages : [];
    const lastQuestion = String(messages.at(-1)?.content || "");
    if (!lastQuestion.trim()) return json(400, { error: "Escribí una pregunta." });

    const brief = await liveBrief(userClient, {
      ...((body.brief && typeof body.brief === "object") ? body.brief : {}),
      lastQuestion,
    });
    const reply = await askGemini(messages, brief, typeof body.guide === "string" ? body.guide : GUIDE);
    return json(200, { ...reply, brief: { today: brief.today, activos: brief.activos, deudores: brief.deudores } });
  } catch (error) {
    return json(500, { error: error instanceof Error ? error.message : "Jev no pudo leer el libro." });
  }
});
