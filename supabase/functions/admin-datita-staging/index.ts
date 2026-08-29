import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import postgres from "npm:postgres@3.4.5";

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

const DDL = `
create table if not exists public.socios (
  nro_socio integer primary key,
  autorizacion text,
  nombre text,
  apellido text,
  documento_tipo text,
  documento_numero text,
  direccion text,
  sexo text,
  fecha_nacimiento date,
  anio_nacimiento integer,
  email text,
  telefono_personal text,
  vencimiento_autorizacion date,
  fecha_alta date,
  fecha_baja date,
  motivo_baja text,
  tarjeta_prisma text,
  tipo_debito_prisma text,
  nro_socio_principal_grupo_familiar integer,
  nombre_grupo_familiar text,
  contacto_emergencia text,
  numero_emergencia text,
  grupo_sanguineo text,
  socio_activo text,
  obra_social text,
  clinica_emergencia text,
  created_at timestamptz not null default now(),
  imported_at timestamptz not null default now()
);
create table if not exists public.socio_cuotas (
  id bigint generated always as identity primary key,
  nro_socio integer not null references public.socios (nro_socio) on delete cascade,
  categoria_cuota text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_socio_cuotas_nro_socio on public.socio_cuotas (nro_socio);
create unique index if not exists socio_cuotas_unique_cat on public.socio_cuotas (nro_socio, categoria_cuota);
alter table public.socios enable row level security;
alter table public.socio_cuotas enable row level security;
drop policy if exists socios_select_staff on public.socios;
create policy socios_select_staff on public.socios for select using (public.has_staff_access());
drop policy if exists socios_write_admin on public.socios;
create policy socios_write_admin on public.socios for all using (public.has_admin_access()) with check (public.has_admin_access());
drop policy if exists socio_cuotas_select_staff on public.socio_cuotas;
create policy socio_cuotas_select_staff on public.socio_cuotas for select using (public.has_staff_access());
drop policy if exists socio_cuotas_write_admin on public.socio_cuotas;
create policy socio_cuotas_write_admin on public.socio_cuotas for all using (public.has_admin_access()) with check (public.has_admin_access());
`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const dbUrl = Deno.env.get("SUPABASE_DB_URL") || Deno.env.get("POSTGRES_URL") || Deno.env.get("DATABASE_URL");

  const authHeader = req.headers.get("Authorization") || "";
  const userClient = createClient(supabaseUrl, anon, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user) return json(401, { error: "Unauthorized" });

  const admin = createClient(supabaseUrl, service);
  const { data: profile } = await admin.from("profiles").select("role").eq("id", userData.user.id).maybeSingle();
  if (!profile || !["admin", "superadmin"].includes(String(profile.role))) {
    return json(403, { error: "Forbidden" });
  }

  if (!dbUrl) {
    return json(500, { error: "Missing SUPABASE_DB_URL / DATABASE_URL secret" });
  }

  const sql = postgres(dbUrl, { max: 1, idle_timeout: 5 });
  try {
    await sql.unsafe(DDL);
    return json(200, { ok: true, message: "staging tables ready" });
  } catch (e) {
    return json(500, { error: String((e as Error)?.message || e) });
  } finally {
    await sql.end({ timeout: 5 });
  }
});
