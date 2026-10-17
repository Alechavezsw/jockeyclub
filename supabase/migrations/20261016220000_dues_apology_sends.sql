create table if not exists public.dues_apology_sends (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  resend_id text,
  email_error text,
  created_at timestamptz not null default now()
);

alter table public.dues_apology_sends enable row level security;
revoke all on table public.dues_apology_sends from public, anon, authenticated;
grant select, insert, update on table public.dues_apology_sends to service_role;

comment on table public.dues_apology_sends is
  'Disculpa por el aviso de cuota enviado por error el 15/10/2026.';
