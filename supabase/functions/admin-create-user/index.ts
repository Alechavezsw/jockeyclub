import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

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

function normalizeDisciplineIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const id = String(item || "").trim().toLowerCase();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization") || "";

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(supabaseUrl, serviceKey);

    const { data: authData, error: authErr } = await userClient.auth.getUser();
    if (authErr || !authData?.user) {
      return json(401, { error: "No autenticado" });
    }

    const { data: caller } = await admin
      .from("profiles")
      .select("role")
      .eq("id", authData.user.id)
      .maybeSingle();

    const callerRole = String(caller?.role || "");
    const isSuper = callerRole === "superadmin";
    const isAdmin = callerRole === "admin";
    if (!isSuper && !isAdmin) {
      return json(403, { error: "Solo administración puede crear o modificar perfiles" });
    }

    const body = await req.json();
    const action = String(body.action || "create");

    if (action === "reset_password") {
      const userId = String(body.userId || "").trim();
      const password = String(body.password || "");
      if (!userId) return json(400, { error: "userId es obligatorio" });
      if (password.length < 6) {
        return json(400, { error: "La contraseña debe tener al menos 6 caracteres" });
      }

      if (!isSuper) {
        const { data: target } = await admin
          .from("profiles")
          .select("role")
          .eq("id", userId)
          .maybeSingle();
        if (String(target?.role || "") !== "teacher") {
          return json(403, { error: "El administrador solo puede regenerar contraseñas de profesores" });
        }
      }

      const { error: updateErr } = await admin.auth.admin.updateUserById(userId, {
        password,
      });
      if (updateErr) {
        return json(400, { error: updateErr.message || "No se pudo actualizar la contraseña" });
      }

      await admin.from("profiles").update({
        updated_at: new Date().toISOString(),
      }).eq("id", userId);

      return json(200, { ok: true, userId });
    }

    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const username = String(body.username || email.split("@")[0] || "").trim().toLowerCase();
    const firstName = String(body.firstName || "").trim();
    const lastName = String(body.lastName || "").trim();
    const fullName = [firstName, lastName].filter(Boolean).join(" ") || String(body.fullName || "").trim();
    const role = String(body.role || "member");
    const contactEmail = body.contactEmail ? String(body.contactEmail).trim() : "";
    const disciplineIds = normalizeDisciplineIds(body.disciplineIds);

    if (!isSuper && role !== "teacher") {
      return json(403, { error: "El administrador solo puede dar de alta profesores" });
    }

    if (!email || !password) {
      return json(400, { error: "Email y contraseña son obligatorios" });
    }
    if (password.length < 6) {
      return json(400, { error: "La contraseña debe tener al menos 6 caracteres" });
    }
    if (!fullName) {
      return json(400, { error: "Nombre y apellido son obligatorios" });
    }

    const userMeta = {
      full_name: fullName,
      first_name: firstName,
      last_name: lastName,
      role,
      username,
      phone: body.phone || null,
      avatar_url: body.avatarUrl || null,
      document_type: body.documentType || null,
      document_number: body.documentNumber || null,
      gender: body.gender || null,
      birth_date: body.birthDate || null,
      blood_type: body.bloodType || null,
      health_insurance: body.healthInsurance || null,
      emergency_phone: body.emergencyPhone || null,
      emergency_clinic: body.emergencyClinic || null,
      address: body.address || null,
      prisma_id: body.prismaId || null,
      discipline_ids: disciplineIds,
    };

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: userMeta,
    });

    if (createErr || !created?.user) {
      return json(400, { error: createErr?.message || "No se pudo crear el usuario" });
    }

    const userId = created.user.id;

    const { data: existingProfile } = await admin
      .from("profiles")
      .select("meta")
      .eq("id", userId)
      .maybeSingle();

    const prevMeta = (existingProfile?.meta && typeof existingProfile.meta === "object")
      ? existingProfile.meta as Record<string, unknown>
      : {};

    const { error: profileErr } = await admin.from("profiles").update({
      email,
      full_name: fullName,
      first_name: firstName || null,
      last_name: lastName || null,
      role,
      phone: body.phone || null,
      avatar_url: body.avatarUrl || null,
      document_type: body.documentType || null,
      document_number: body.documentNumber || null,
      gender: body.gender || null,
      birth_date: body.birthDate || null,
      blood_type: body.bloodType || null,
      health_insurance: body.healthInsurance || null,
      emergency_phone: body.emergencyPhone || null,
      emergency_clinic: body.emergencyClinic || null,
      address: body.address || null,
      prisma_id: body.prismaId || null,
      discipline_ids: disciplineIds,
      is_active: body.isActive !== false,
      meta: {
        ...prevMeta,
        username,
        ...(contactEmail ? { contactEmail } : {}),
      },
      updated_at: new Date().toISOString(),
    }).eq("id", userId);

    if (profileErr) {
      return json(500, { error: profileErr.message || "Usuario creado pero falló el perfil" });
    }

    const authorizations = Array.isArray(body.authorizations) ? body.authorizations : [];
    if (authorizations.length) {
      const rows = authorizations
        .filter((a: { title?: string; kind?: string }) => a?.title || a?.kind)
        .map((a: Record<string, unknown>) => ({
          profile_id: userId,
          kind: String(a.kind || "custom"),
          title: String(a.title || a.kind || "Autorización"),
          role_label: a.roleLabel ? String(a.roleLabel) : null,
          expires_at: a.expiresAt ? String(a.expiresAt) : null,
          pin: a.pin ? String(a.pin) : null,
          meta: {},
        }));
      if (rows.length) {
        await admin.from("profile_authorizations").insert(rows);
      }
    }

    const identifiers = Array.isArray(body.identifiers) ? body.identifiers : [];
    if (identifiers.length) {
      const rows = identifiers
        .filter((i: { idType?: string; identifier?: string }) => i?.idType && i?.identifier)
        .map((i: Record<string, unknown>) => ({
          profile_id: userId,
          id_type: String(i.idType),
          identifier: String(i.identifier),
          meta: {},
        }));
      if (rows.length) {
        await admin.from("profile_identifiers").insert(rows);
      }
    }

    const { data: profile } = await admin
      .from("profiles")
      .select("*, profile_authorizations(*), profile_identifiers(*)")
      .eq("id", userId)
      .single();

    return json(200, { ok: true, profile, credentials: { username, email } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error interno";
    return json(500, { error: message });
  }
});
