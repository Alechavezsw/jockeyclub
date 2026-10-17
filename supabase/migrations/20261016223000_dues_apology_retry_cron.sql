do $$
begin
  if to_regclass('cron.job') is null then
    return;
  end if;
  perform cron.unschedule(j.jobid)
  from cron.job j
  where j.jobname = 'dues-apology-retry';
  perform cron.schedule(
    'dues-apology-retry',
    '20 0 * * *',
    $job$
    select net.http_post(
      url := 'https://papdsxgcvyncdxdvbdaa.supabase.co/functions/v1/send-dues-apology',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select token from public.dues_cron_config where id = 1)
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 120000
    );
    $job$
  );
end $$;
