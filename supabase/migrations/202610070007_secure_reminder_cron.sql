-- Cron → Edge Function yetkilendirmesini service-role eşitliğinden ayırır.
-- Önce Dashboard SQL Editor'da dijivo_cron_secret Vault kaydı oluşturulmuş
-- ve aynı değer Edge Function CRON_SECRET olarak atanmış olmalıdır.

do $$
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'dijivo_project_url')
     or not exists (select 1 from vault.decrypted_secrets where name = 'dijivo_cron_secret') then
    raise exception 'Eksik Vault secret: dijivo_project_url ve dijivo_cron_secret zorunludur.';
  end if;
end
$$;

select cron.unschedule('reminder-dispatch')
from cron.job
where jobname = 'reminder-dispatch';

select cron.schedule(
  'reminder-dispatch',
  '* * * * *',
  $$
  select net.http_post(
    url := rtrim((select decrypted_secret from vault.decrypted_secrets where name = 'dijivo_project_url'), '/')
           || '/functions/v1/reminder-dispatch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'dijivo_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 15000
  ) as request_id;
  $$
);
