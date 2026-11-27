-- No socio: temporada completa $ 490.000 por cada uno de los tres primeros.
-- El cuarto hermano no tiene canon: solo paga la inscripción.

update public.colonia_tariffs
set amount = 490000
where plan_key in ('promo_2', 'promo_3')
  and member_kind = 'no_socio';

update public.colonia_tariffs
set amount = 0
where plan_key = 'hermano_4';
