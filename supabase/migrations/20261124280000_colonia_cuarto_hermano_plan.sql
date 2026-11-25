-- Cuarto hermano: mismo plan que la promo de 3. La inscripción no se carga aparte.
-- Socio $ 410.000. No socio $ 500.000.

update public.colonia_tariffs
set amount = 410000
where plan_key = 'hermano_4'
  and member_kind = 'socio'
  and amount in (0, 360000);

update public.colonia_tariffs
set amount = 500000
where plan_key = 'hermano_4'
  and member_kind = 'no_socio'
  and amount in (0, 450000);
