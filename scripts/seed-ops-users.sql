-- Seed operativo JC: 4 usuarios (admin, contabilidad, caja, socio)
-- Password: la define quien aplica el seed; no va en el repo.
-- Aplicado en remoto vía MCP execute_sql.

create extension if not exists pgcrypto;

-- Ver historial en Supabase Auth / public.profiles / public.members
-- admin@jockey.sj          admin
-- contabilidad@jockey.sj   accountant
-- caja@jockey.sj           cashier
-- socio@jockey.sj          member + ficha 2026887744320988
