-- Arka plan hatırlatma işçisi için pg_cron zamanlaması.
--
-- Bu dosya `supabase/migrations/202610020003_create_calendar_tables.sql`
-- çalıştırıldıktan **sonra** SQL Editor'da çalıştırılır.
--
-- Ön koşul:
--   - reminder-dispatch Edge Function deploy edilmiş olmalı
--     (`supabase functions deploy reminder-dispatch`)
--   - Edge Function secrets tanımlı olmalı:
--       supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=...
--     (VAPID_PRIVATE_KEY istemciye ASLA aktarılmaz)
--
-- VAPID anahtar üretimi (Node):
--   npx web-push generate-vapid-keys
--
-- pg_cron, Supabase'de `pg_cron` uzantısı etkin olarak gelir. Aşağıdaki
-- blok idempotenttir: `unschedule` sonrası yeniden kaydedilir.

-- CronJob yalnızca veritabanı superuser'ı veya `postgres` rolüyle
-- oluşturulabilir; Supabase SQL Editor bu roldedir.

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    create extension if not exists pg_cron;
  end if;
end
$$;

-- Eski kayıt varsa temizle (yeniden çalıştırma güvenli olsun).
select cron.unschedule('reminder-dispatch') from cron.job where jobname = 'reminder-dispatch';

-- Her dakika tetikle. `net.http_post` Edge Function'ı çağırır.
select cron.schedule(
  'reminder-dispatch',
  '* * * * *',
  $$
  select
    net.http_post(
      url := current_setting('app.settings.jwt_secret', true) is null
            then current_setting('app.settings.api_url')
            else current_setting('app.settings.api_url') || '/functions/v1/reminder-dispatch'
      end,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
      ),
      body := '{}'::jsonb
    );
  $$
);

-- ---------------------------------------------------------------------------
-- Doğrulama
-- ---------------------------------------------------------------------------
-- select jobid, schedule, command from cron.job where jobname = 'reminder-dispatch';
--
-- Elle tetikleme (test):
--   curl -X POST \
--     -H "Authorization: Bearer <service_role_key>" \
--     -H "Content-Type: application/json" \
--     https://<project-ref>.supabase.co/functions/v1/reminder-dispatch
--
-- Beklenen yanıt:
--   {"ok":true,"created":0,"pushed":0,...}  (idempotent: iki çağrıda da 0)