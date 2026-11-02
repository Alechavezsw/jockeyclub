alter table public.debit_listings
  add column if not exists card_edits jsonb not null default '[]'::jsonb;

comment on column public.debit_listings.card_edits is
  'Historial de cambios de N° tarjeta: [{at, by, from, to}].';
