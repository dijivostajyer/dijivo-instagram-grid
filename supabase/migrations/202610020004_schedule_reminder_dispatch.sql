-- Arka plan hatırlatma işçisi için pg_cron zamanlaması (Vault + pg_net).
--
-- Bu dosya `202610020003_create_calendar_tables.sql` ÇALIŞTIRILDIKTAN
-- sonra Supabase SQL Editor'da çalıştırılır. Tamamen idempotenttir: eski
-- job unschedule edilir, yeniden kaydedilir; ikinci kez çalıştırmak güvenlidir.
--
-- Neden Vault? `current_setting('app.settings.api_url')` / `app.settings.
-- service_role_key` GUC'ları production Supabase projelerinde TANIMLI
-- DEĞİLDİR ve cron gövdesine service-role anahtarı düz metin gömülemez.
-- Supabase'in resmi yaklaşımı (docs: "Scheduling Edge Functions"):
-- proje URL'si ve anahtar Supabase Vault'ta saklanır, pg_cron → pg_net
-- `net.http_post` ile Edge Function'ı çağırır, header'lar
-- `vault.decrypted_secrets` üzerinden okunur.
--
-- ÖN KOŞULLAR (SQL Editor'da, BU DOSYADAN ÖNCE — bir kez):
--
--   -- 1) Vault secret'ları (değerleri bu dosyaya asla gömme):
--   select vault.create_secret('https://<project-ref>.supabase.co', 'dijivo_project_url');
--   select vault.create_secret('<service-role veya secret key>', 'dijivo_service_key');
--
--   -- 2) Edge Function deploy (verify_jwt KAPALI; auth handler-side):
--   --      supabase functions deploy reminder-dispatch --no-verify-jwt
--
--   Not: `dijivo_project_url` sonunda eğik çizgi OLMAMALI (script
--   `rtrim(..., '/')` ile yine de korur). Vault secret'ları yoksa bu
--   dosya aşikâr bir hata mesajıyla DURUR (sessizce kırık job kurmaz).
--
-- Doğrulama (dosyanın sonunda), elle tetikleme ve sorun giderme
-- ipuçları SUPABASE-KURULUM.md §2'dedir.

-- ---------------------------------------------------------------------------
-- 1. Uzantılar (idempotent)
-- ---------------------------------------------------------------------------
-- pg_cron ve pg_net çoğu Supabase projesinde hazırdır; yoksa açılır.
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    create extension if not exists pg_cron;
  end if;
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    create extension if not exists pg_net;
  end if;
  if not exists (select 1 from pg_extension where extname = 'vault') then
    create extension if not exists vault;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 2. Ön koşul denetimi — Vault secret'ları yoksa açık hata ver
-- ---------------------------------------------------------------------------
-- Sessizce eksik secret'lı (header'ları NULL → her dakika 401) bir job
-- kurmak yerine, neyin eksik olduğunu ve ne çalıştırılacağını söyleyerek
-- durur.
do $$
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'dijivo_project_url')
     or not exists (select 1 from vault.decrypted_secrets where name = 'dijivo_service_key') then
    raise exception E'Eksik Vault secret''ı. Önce SQL Editor''da çalıştırın:\n  select vault.create_secret(''https://<project-ref>.supabase.co'', ''dijivo_project_url'');\n  select vault.create_secret(''<service-role key>'', ''dijivo_service_key'');\nSonra bu dosyayı yeniden çalıştırın. (Ayrıntı: SUPABASE-KURULUM.md §2.2)';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 3. Eski job kaydını temizle (yeniden çalıştırma güvenli olsun)
-- ---------------------------------------------------------------------------
-- cron.unschedule(job_name) yalnızca job VARSA çağrılır; job yoksa SELECT
-- boş döner ve hata üretmez.
select cron.unschedule('reminder-dispatch')
from cron.job
where jobname = 'reminder-dispatch';

-- ---------------------------------------------------------------------------
-- 4. Her dakika: pg_net → reminder-dispatch Edge Function
-- ---------------------------------------------------------------------------
-- URL ve anahtar çalışma anında Vault'tan okunur; bu dosyada düz metin
-- secret YOKTUR. Function path sabittir:
--   supabase/functions/reminder-dispatch  →  /functions/v1/reminder-dispatch
-- (deploy komutu: `supabase functions deploy reminder-dispatch`).
--
-- Auth: service-to-service çağrılar `apikey` header'ıyla yapılır
-- (Supabase docs: "Securing Edge Functions" — cron/pg_net çağrıları JWT
-- değil, apikey taşır). Function `--no-verify-jwt` ile deploy edilir ve
-- anahtarı handler içinde doğrular.
select cron.schedule(
  'reminder-dispatch',
  '* * * * *',
  $$
  select
    net.http_post(
      url := rtrim((select decrypted_secret from vault.decrypted_secrets where name = 'dijivo_project_url'), '/')
             || '/functions/v1/reminder-dispatch',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'dijivo_service_key'),
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'dijivo_service_key')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 15000
    ) as request_id;
  $$
);

-- ---------------------------------------------------------------------------
-- 5. Doğrulama
-- ---------------------------------------------------------------------------
-- select jobid, schedule, command from cron.job where jobname = 'reminder-dispatch';
--
-- select name from vault.decrypted_secrets
--  where name in ('dijivo_project_url', 'dijivo_service_key');
-- -- 2 satır görünmeli
--
-- Elle tetikleme (test):
--   curl -X POST \
--     -H "apikey: <service-role key>" \
--     -H "Content-Type: application/json" \
--     https://<project-ref>.supabase.co/functions/v1/reminder-dispatch
--
-- Beklenen yanıt:
--   {"ok":true,"created":0,"pushed":0,...}  (idempotent: iki çağrıda da 0)
--
-- Sorun giderme:
--   - 401 → Vault'taki key ile deploy edilen key farklı ya da function
--     verify_jwt ile deploy edildi (--no-verify-jwt ile yeniden deploy edin).
--   - dispatch_rpc_failed / PGRST202 → 0003 migration'ındaki
--     dispatch_due_reminders() çalıştırılmamış.
--   - Job çalışmıyorsa: select * from cron.job_run_details
--     order by start_time desc limit 5;
