-- Staging padrón histórico (datita) + RLS lectura staff
-- Fuente: datita/schema.sql ampliado con políticas.

create table if not exists public.socios (
  nro_socio                            integer primary key,
  autorizacion                         text,
  nombre                               text,
  apellido                             text,
  documento_tipo                       text,
  documento_numero                     text,
  direccion                            text,
  sexo                                 text,
  fecha_nacimiento                     date,
  anio_nacimiento                      integer,
  email                                text,
  telefono_personal                    text,
  vencimiento_autorizacion             date,
  fecha_alta                           date,
  fecha_baja                           date,
  motivo_baja                          text,
  tarjeta_prisma                       text,
  tipo_debito_prisma                   text,
  nro_socio_principal_grupo_familiar   integer,
  nombre_grupo_familiar                text,
  contacto_emergencia                  text,
  numero_emergencia                    text,
  grupo_sanguineo                      text,
  socio_activo                         text,
  obra_social                          text,
  clinica_emergencia                   text,
  created_at                           timestamptz not null default now(),
  imported_at                          timestamptz not null default now()
);

create table if not exists public.socio_cuotas (
  id              bigint generated always as identity primary key,
  nro_socio       integer not null references public.socios (nro_socio) on delete cascade,
  categoria_cuota text not null,
  created_at      timestamptz not null default now()
);

create index if not exists idx_socio_cuotas_nro_socio
  on public.socio_cuotas (nro_socio);

create unique index if not exists socio_cuotas_unique_cat
  on public.socio_cuotas (nro_socio, categoria_cuota);

alter table public.socios enable row level security;
alter table public.socio_cuotas enable row level security;

drop policy if exists socios_select_staff on public.socios;
create policy socios_select_staff on public.socios
  for select using (public.has_staff_access());

drop policy if exists socios_write_admin on public.socios;
create policy socios_write_admin on public.socios
  for all using (public.has_admin_access())
  with check (public.has_admin_access());

drop policy if exists socio_cuotas_select_staff on public.socio_cuotas;
create policy socio_cuotas_select_staff on public.socio_cuotas
  for select using (public.has_staff_access());

drop policy if exists socio_cuotas_write_admin on public.socio_cuotas;
create policy socio_cuotas_write_admin on public.socio_cuotas
  for all using (public.has_admin_access())
  with check (public.has_admin_access());

comment on table public.socios is 'Staging del padrón histórico (datita). Transformar a public.members.';
comment on table public.socio_cuotas is 'Categorías de cuota del padrón histórico por nro_socio.';
