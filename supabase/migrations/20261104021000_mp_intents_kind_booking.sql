-- Seña de reserva: permitir kind booking/reservation en mp_intents.
alter table public.mp_intents drop constraint if exists mp_intents_kind_check;
alter table public.mp_intents
  add constraint mp_intents_kind_check
  check (kind = any (array[
    'dues'::text,
    'pool'::text,
    'subscription'::text,
    'booking'::text,
    'reservation'::text
  ]));
