-- Cuarto hermano: promo de 3 menos la inscripción de 50.000.
-- Socio 410.000 - 50.000 = 360.000. No socio 500.000 - 50.000 = 450.000.

update public.colonia_tariffs
set amount = 360000
where plan_key = 'hermano_4'
  and member_kind = 'socio'
  and amount = 0;

update public.colonia_tariffs
set amount = 450000
where plan_key = 'hermano_4'
  and member_kind = 'no_socio'
  and amount = 0;
