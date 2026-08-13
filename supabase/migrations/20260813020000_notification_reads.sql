-- Lecturas de campanita por usuario (mensajes, reclamos, alertas, etc.)
create table if not exists public.notification_reads (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  notif_key text not null,
  read_at timestamptz not null default now(),
  unique (profile_id, notif_key)
);

create index if not exists notification_reads_profile_idx
  on public.notification_reads (profile_id, read_at desc);

alter table public.notification_reads enable row level security;

drop policy if exists notification_reads_own on public.notification_reads;
create policy notification_reads_own on public.notification_reads
  for all
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());
