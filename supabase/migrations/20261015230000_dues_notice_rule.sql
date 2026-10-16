-- Regla del club: avisos de cuota el 5, el 10 y el 15 (mensaje + mail).

update public.app_settings
set
  value = coalesce(value, '{}'::jsonb) || jsonb_build_object(
    'noticeAdvanceDays', 5,
    'noticeMoraDay', 15,
    'noticeByMessage', true,
    'noticeByEmail', true,
    'moraConsequences', jsonb_build_array(
      'A partir del día 11, socio familiar y socio individual pagan un recargo del 10 %.',
      'En mora no se ingresa al club hasta regularizar la cuota.',
      'Tampoco se puede pagar pileta hasta estar al día.'
    )
  ),
  updated_at = now()
where key = 'dues';
