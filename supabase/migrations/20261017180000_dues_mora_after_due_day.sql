-- Después del vencimiento (día 10) la cuota está en mora. El aviso pasa del 15 al 11.

update public.app_settings
set
  value = coalesce(value, '{}'::jsonb) || jsonb_build_object(
    'noticeMoraDay', 11
  ),
  updated_at = now()
where key = 'dues';
