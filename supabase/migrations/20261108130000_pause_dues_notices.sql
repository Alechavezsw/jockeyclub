-- Pausa avisos automáticos de cuota (día 5 / 10 / mora) hasta auditoría de la app.
-- No toca liquidación ni comprobantes de cobro.

update public.app_settings
set value = coalesce(value, '{}'::jsonb)
  || jsonb_build_object(
    'noticesPaused', true,
    'noticeByMessage', false,
    'noticeByEmail', false
  ),
  updated_at = now()
where key = 'dues';

select cron.unschedule(jobid)
from cron.job
where jobname = 'dues-due-notices';
