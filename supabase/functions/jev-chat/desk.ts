import { createClient } from "npm:@supabase/supabase-js@2";
import { DESK_RULE_MARK, DESK_RULES, deskRule } from "./deskBrain.js";

type StaffClient = ReturnType<typeof createClient>;

const MODELS = ["gemini-3.8-flash", "gemini-3.5-flash", "gemini-2.5-flash"];

const TOOLS = [{
  functionDeclarations: [
    {
      name: "reglas",
      description: "Regla oficial del club. Usala antes de explicar cuota, mora, adelanto, exentos, reserva, grupo, comprobante, colonia, pileta o roles. No inventes una regla que no esté acá.",
      parameters: {
        type: "object",
        properties: {
          tema: {
            type: "string",
            enum: ["cuota", "mora", "adelanto", "exentos", "reserva", "grupo", "comprobante", "colonia", "pileta", "roles"],
          },
        },
        required: ["tema"],
      },
    },
    {
      name: "buscar_socio",
      description: "Busca en el padrón por número o por nombre. Devuelve hasta 5 fichas, sin saldos. Si hay una sola, seguí con ficha.",
      parameters: {
        type: "object",
        properties: { consulta: { type: "string" } },
        required: ["consulta"],
      },
    },
    {
      name: "ficha",
      description: "Lee una ficha real: categoría, saldo, próximo vencimiento, últimos cobros y cuotas abiertas. El número es el del padrón.",
      parameters: {
        type: "object",
        properties: { numero: { type: "string" } },
        required: ["numero"],
      },
    },
    {
      name: "grupo",
      description: "Titular e integrantes del grupo familiar de ese número.",
      parameters: {
        type: "object",
        properties: { numero: { type: "string" } },
        required: ["numero"],
      },
    },
    {
      name: "comprobante",
      description: "Busca un cobro por el número de recibo, por ejemplo RC-111591-20261127.",
      parameters: {
        type: "object",
        properties: { recibo: { type: "string" } },
        required: ["recibo"],
      },
    },
    {
      name: "reservas",
      description: "Reservas de un día (YYYY-MM-DD). Si no pasás fecha, es hoy en San Juan.",
      parameters: {
        type: "object",
        properties: { fecha: { type: "string" } },
      },
    },
  ],
}];

function todayAR() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/San_Juan" });
}

function clip(value: unknown, max = 80) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function digits(value: unknown) {
  return clip(value, 16).replace(/\D/g, "").slice(0, 12);
}

function money(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

async function buscarSocio(db: StaffClient, consulta: string) {
  const q = clip(consulta, 80);
  if (q.length < 2) return { error: "Decime un número o un apellido." };
  const { data, error } = await db.rpc("search_members_lookup", { p_query: q, p_limit: 5 });
  if (error) return { error: "No pude buscar en el padrón." };
  const rows = Array.isArray(data) ? data : [];
  return {
    cantidad: rows.length,
    socios: rows.map((row) => ({
      numero: row.member_number,
      nombre: row.full_name,
      estado: row.status,
    })),
  };
}

async function memberByNumber(db: StaffClient, numero: string) {
  const n = digits(numero);
  if (!n) return { error: "Falta el número de socio." };
  const { data, error } = await db
    .from("members")
    .select("id, member_number, full_name, status, tier, outstanding_balance, next_due_date, email, phone")
    .eq("member_number", n)
    .maybeSingle();
  if (error) return { error: "No pude abrir esa ficha." };
  if (!data) return { error: `No hay un socio con el número ${n}.` };
  return { member: data };
}

async function ficha(db: StaffClient, numero: string) {
  const found = await memberByNumber(db, numero);
  if (found.error || !found.member) return found;
  const member = found.member;
  const [payments, openRows, prepaid] = await Promise.all([
    db.from("member_payments")
      .select("amount, paid_at, concept, receipt_number")
      .eq("member_id", member.id)
      .order("paid_at", { ascending: false })
      .limit(8),
    db.from("member_dues_periods")
      .select("due_on, capital, capital_open")
      .eq("member_id", member.id)
      .gt("capital_open", 0)
      .order("due_on", { ascending: true })
      .limit(8),
    db.from("members")
      .select("prepaid:meta->prepaidSocialDueOns")
      .eq("id", member.id)
      .maybeSingle(),
  ]);
  return {
    numero: member.member_number,
    nombre: member.full_name,
    estado: member.status,
    categoria: member.tier,
    saldo: money(member.outstanding_balance),
    proximoVencimiento: member.next_due_date,
    mail: member.email || null,
    telefono: member.phone || null,
    adelantado: prepaid.data?.prepaid || [],
    cuotasAbiertas: (openRows.data || []).map((row) => ({
      vence: row.due_on,
      capital: money(row.capital),
      abierto: money(row.capital_open),
    })),
    ultimosCobros: (payments.data || []).map((row) => ({
      fecha: row.paid_at,
      importe: money(row.amount),
      concepto: row.concept,
      recibo: row.receipt_number,
    })),
  };
}

async function grupo(db: StaffClient, numero: string) {
  const n = digits(numero);
  if (!n) return { error: "Falta el número del titular." };
  const { data, error } = await db.rpc("list_household_members", { p_principal: n });
  if (error) return { error: "No pude leer el grupo familiar." };
  const rows = Array.isArray(data) ? data : [];
  return {
    titular: n,
    integrantes: rows.slice(0, 12).map((row) => ({
      numero: row.member_number,
      nombre: row.full_name || row.name,
      categoria: row.tier || row.category || null,
      vinculo: row.relationship || row.parentesco || row.role || null,
    })),
  };
}

async function comprobante(db: StaffClient, recibo: string) {
  const code = clip(recibo, 40);
  if (code.length < 4) return { error: "Pasame el número de recibo." };
  const { data, error } = await db
    .from("member_payments")
    .select("amount, paid_at, concept, receipt_number, member_id")
    .ilike("receipt_number", code)
    .limit(5);
  if (error) return { error: "No pude buscar ese comprobante." };
  const rows = data || [];
  const memberIds = [...new Set(rows.map((row) => row.member_id).filter(Boolean))];
  const names = new Map<string, { numero?: string; nombre?: string }>();
  if (memberIds.length) {
    const { data: people } = await db
      .from("members")
      .select("id, member_number, full_name")
      .in("id", memberIds);
    for (const person of people || []) {
      names.set(person.id, { numero: person.member_number, nombre: person.full_name });
    }
  }
  return {
    cantidad: rows.length,
    cobros: rows.map((row) => ({
      recibo: row.receipt_number,
      fecha: row.paid_at,
      importe: money(row.amount),
      concepto: row.concept,
      socio: names.get(row.member_id)?.numero || null,
      nombre: names.get(row.member_id)?.nombre || null,
    })),
  };
}

async function reservas(db: StaffClient, fecha?: string) {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(fecha || "")) ? String(fecha) : todayAR();
  const { data, error } = await db
    .from("reservations")
    .select("reservation_date, time_slot, status, member_number, member_name, guests, facilities(name)")
    .eq("reservation_date", day)
    .neq("status", "cancelled")
    .order("time_slot", { ascending: true })
    .limit(20);
  if (error) return { error: "No pude leer las reservas de ese día." };
  return {
    fecha: day,
    cantidad: (data || []).length,
    reservas: (data || []).map((row) => ({
      hora: row.time_slot,
      estado: row.status,
      espacio: (Array.isArray(row.facilities) ? row.facilities[0]?.name : (row.facilities as { name?: string } | null)?.name) || null,
      socio: row.member_number,
      nombre: row.member_name,
      invitados: row.guests,
    })),
  };
}

async function runTool(db: StaffClient, name: string, args: Record<string, unknown>) {
  if (name === "reglas") {
    const text = deskRule(args.tema) || DESK_RULES.cuota;
    return { tema: args.tema || "cuota", regla: text };
  }
  if (name === "buscar_socio") return buscarSocio(db, String(args.consulta || ""));
  if (name === "ficha") return ficha(db, String(args.numero || ""));
  if (name === "grupo") return grupo(db, String(args.numero || ""));
  if (name === "comprobante") return comprobante(db, String(args.recibo || ""));
  if (name === "reservas") return reservas(db, args.fecha ? String(args.fecha) : undefined);
  return { error: "Esa consulta no existe." };
}

function lookupOf(name: string, args: Record<string, unknown>, result: Record<string, unknown>) {
  if (name === "reglas") return { label: `Regla · ${clip(args.tema, 24) || "cuota"}`, detail: "libro del club" };
  if (name === "buscar_socio") {
    return { label: "Padrón", detail: `${Number(result.cantidad) || 0} coincidencias` };
  }
  if (name === "ficha") {
    const numero = result.numero || digits(args.numero);
    const nombre = result.nombre ? clip(result.nombre, 42) : "sin ficha";
    return { label: `Ficha ${numero || ""}`.trim(), detail: String(nombre) };
  }
  if (name === "grupo") return { label: `Grupo ${digits(args.numero)}`, detail: `${(result.integrantes as unknown[])?.length || 0} integrantes` };
  if (name === "comprobante") return { label: clip(args.recibo, 28) || "Recibo", detail: `${Number(result.cantidad) || 0} cobros` };
  if (name === "reservas") return { label: `Reservas ${result.fecha || ""}`.trim(), detail: `${Number(result.cantidad) || 0} turnos` };
  return { label: name, detail: "" };
}

function systemPrompt(brief: Record<string, unknown>, guide: string) {
  return `Sos Jev, el secretario del escritorio del Jockey Club San Juan (Sede Rivadavia).
Hablás en español rioplatense, claro, de vos. Primero el veredicto, después el dato, después un solo paso.
Consultás la base con las herramientas antes de decir un saldo, un nombre, un recibo o una reserva. Una cifra que no vino de una herramienta no se dice.
Para una regla (cuota, mora, adelanto, seña, colonia, grupo, comprobante) llamá a reglas. ${DESK_RULE_MARK}
No cobrás, no liquidás, no modificás fichas y no prometés mandar un mail.
Si falta el número de socio, pedilo. Si la herramienta devuelve error, decilo sin inventar el dato.
No repitas el mismo importe dos veces. No suenes a chatbot.
Respondé al final SOLO un JSON:
{"verdict":"frase corta","text":"respuesta útil, con pasos 1. 2. 3. si preguntan cómo","next":"un solo paso o una sola pregunta","tab":"members|dues|bookings|accounting|caja|pool|access|claims|messaging|news|null","focus":null}
Cifras de la sesión, por si preguntan el panorama y no hace falta una ficha:
${JSON.stringify({
    hoy: brief.today,
    activos: brief.activos,
    conSaldo: brief.deudores,
    reservasHoy: brief.reservasHoy,
    porteriaHoy: brief.porteriaHoy,
    piletaHoy: brief.piletaHoy,
    reclamosAbiertos: brief.reclamosAbiertos,
    recaudado: brief.collected,
    liquidado: brief.liquidated,
  })}
Mapa corto de la app:
${String(guide || "").slice(0, 4000)}`;
}

function scrub(text: string, key: string) {
  return text.replaceAll(key, "").replace(/\s+/g, " ").trim().slice(0, 180);
}

async function generate(key: string, model: string, body: Record<string, unknown>) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) {
    const err = scrub(await response.text(), key);
    throw new Error(`${response.status} ${err}`);
  }
  return response.json();
}

function partsOf(payload: { candidates?: { content?: { parts?: Record<string, unknown>[] } }[] }) {
  return payload?.candidates?.[0]?.content?.parts || [];
}

export async function runDeskTurn(
  db: StaffClient,
  messages: { role: string; content: string }[],
  brief: Record<string, unknown>,
  guide: string,
) {
  const key = (Deno.env.get("GEMINI_API_KEY") || Deno.env.get("GOOGLE_GENERATIVE_AI_API_KEY") || "").trim();
  const last = String(messages.at(-1)?.content || "");
  if (!key) {
    return {
      text: JSON.stringify({
        verdict: "Sin la capa de Gemini",
        text: "Puedo leer el libro de esta sesión, pero ahora no está la clave para consultar la base.",
        next: "Reintentá en un momento.",
      }),
      source: "libro",
      lookups: [],
    };
  }

  const contents: { role: string; parts: Record<string, unknown>[] }[] = messages.slice(-8).map((row) => ({
    role: row.role === "assistant" ? "model" : "user",
    parts: [{ text: clip(row.content, 4000) }],
  }));
  const lookups: { label: string; detail: string }[] = [];
  const seen = new Set<string>();

  for (const model of MODELS) {
    const thread = contents.map((row) => ({ role: row.role, parts: row.parts }));
    try {
      for (let round = 0; round < 4; round += 1) {
        const forcing = round === 3;
        const payload = await generate(key, model, {
          systemInstruction: { parts: [{ text: systemPrompt(brief, guide) }] },
          contents: thread,
          tools: forcing ? undefined : TOOLS,
          toolConfig: forcing ? undefined : { functionCallingConfig: { mode: "AUTO" } },
          generationConfig: {
            maxOutputTokens: 1400,
            temperature: 0.2,
            ...(forcing ? { responseMimeType: "application/json" } : {}),
          },
        });
        const parts = partsOf(payload);
        const calls = parts.filter((part) => part.functionCall);
        const text = parts.map((part) => String(part.text || "")).join("").trim();
        if (!calls.length) {
          if (!text) break;
          return { text, source: "gemini", lookups };
        }
        thread.push({ role: "model", parts });
        const responses = [];
        for (const part of calls) {
          const call = part.functionCall as { name?: string; args?: Record<string, unknown> };
          const name = String(call?.name || "");
          const args = call?.args && typeof call.args === "object" ? call.args : {};
          const result = await runTool(db, name, args) as Record<string, unknown>;
          const mark = `${name}:${JSON.stringify(args)}`;
          if (!seen.has(mark)) {
            seen.add(mark);
            lookups.push(lookupOf(name, args, result));
          }
          responses.push({ functionResponse: { name, response: result } });
        }
        thread.push({ role: "user", parts: responses });
        if (forcing) break;
      }
    } catch (error) {
      console.error("jev desk", model, error instanceof Error ? error.message : "falló");
    }
  }

  return {
    text: JSON.stringify({
      verdict: "No pude cerrar la consulta",
      text: last
        ? "La base no me devolvió una respuesta clara. Preguntame de nuevo con el número de socio o la regla."
        : "Escribí la pregunta.",
      next: "Si es una ficha, pasame el número.",
    }),
    source: "libro",
    lookups,
  };
}
