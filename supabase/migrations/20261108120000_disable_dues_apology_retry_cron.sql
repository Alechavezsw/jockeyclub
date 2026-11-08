-- Incidente 16/10/2026 ya cerrado (239/239 enviados). Apaga el cron residual diario.
select cron.unschedule(jobid)
from cron.job
where jobname = 'dues-apology-retry';
