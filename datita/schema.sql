-- Migración Listado de Socios -> Supabase (Postgres)
-- Ejecutar en el SQL editor de Supabase ANTES de importar los CSV.

create table if not exists public.socios (
  nro_socio                            integer primary key,
  autorizacion                         text,
  nombre                                text,
  apellido                              text,
  documento_tipo                        text,
  documento_numero                      text,
  direccion                             text,
  sexo                                   text,
  fecha_nacimiento                      date,
  anio_nacimiento                       integer,
  email                                  text,
  telefono_personal                     text,
  vencimiento_autorizacion              date,
  fecha_alta                            date,
  fecha_baja                            date,
  motivo_baja                           text,
  tarjeta_prisma                        text,
  tipo_debito_prisma                    text,
  nro_socio_principal_grupo_familiar    integer,
  nombre_grupo_familiar                 text,
  contacto_emergencia                   text,
  numero_emergencia                     text,
  grupo_sanguineo                       text,
  socio_activo                          text,
  obra_social                           text,
  clinica_emergencia                    text,
  created_at                            timestamptz default now()
);

create table if not exists public.socio_cuotas (
  id              bigint generated always as identity primary key,
  nro_socio       integer references public.socios(nro_socio) on delete cascade,
  categoria_cuota text not null
);

create index if not exists idx_socio_cuotas_nro_socio on public.socio_cuotas(nro_socio);

-- Recomendado: habilitar RLS y políticas antes de exponer estas tablas a la app.
alter table public.socios enable row level security;
alter table public.socio_cuotas enable row level security;
