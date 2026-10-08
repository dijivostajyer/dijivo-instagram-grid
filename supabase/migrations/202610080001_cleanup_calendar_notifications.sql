-- KALDIRILMIŞ: Takvim Bildirim ve Hatırlatma Altyapısı
--
-- Bu migration, calendarItems'tan bağımsız olarak çalışan
-- bildirim/hatırlatma sistemini tamamen kaldırır.
--
-- Kaldırılanlar:
--   - reminder_deliveries tablosu ve tüm indeksleri
--   - push_subscriptions tablosu ve tüm indeksleri
--   - dispatch_due_reminders() fonksiyonu
--   - dizin kart 디저트 tablosu
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ---------------------------------------------------------------------------
-- 0. Öncelikle gereksiz fonksiyonları kaldır
-- ---------------------------------------------------------------------------

drop function if exists public.dispatch_due_reminders(integer) cascade;
drop function if exists public.dijivo_touch_calendar_row() cascade;

-- ---------------------------------------------------------------------------
-- 1. remnant tabloları (push_subscriptions)
-- ---------------------------------------------------------------------------

drop table if exists public.push_subscriptions cascade;

-- ---------------------------------------------------------------------------
-- 2. remnant tabloları (reminder_deliveries)
-- ---------------------------------------------------------------------------

drop table if exists public.reminder_deliveries cascade;

-- ---------------------------------------------------------------------------
-- 3. Artık kullanılan calendar_items'taki remnant sütunları
-- ---------------------------------------------------------------------------

-- reminderOffsetMinutes ve reminderAt artık kullanılmıyor
alter table public.calendar_items
  drop column if exists reminder_offset_minutes,
  drop column if exists remind_at;

-- Ayrıca reminder_offset_minutes için oluşturulan check constraint'ini de temizle
alter table public.calendar_items
  drop constraint if exists calendar_items_reminder_offset_minutes_check;

-- ---------------------------------------------------------------------------
-- 4. Indeks temizliği
-- ---------------------------------------------------------------------------

drop index if exists public.calendar_items_remind_due_idx;

-- ---------------------------------------------------------------------------
-- 5. Trigger temizliği
-- ---------------------------------------------------------------------------

drop trigger if exists calendar_items_touch_row on public.calendar_items;

-- ---------------------------------------------------------------------------
-- 6. pg_cron job'ı (varsa) — PostgreSQL'de drop job if exists desteklenmez,
-- ---------------------------------------------------------------------------
-- pg_cron'un own syntax'ı kullanılır: select cron.unschedule(jobid) from cron.job where jobname = ...
-- Bu idempotent'dir: job yoksa 0 satır döner, hata vermez.

select cron.unschedule(jobid)
from cron.job
where jobname = 'reminder-dispatch';

-- ---------------------------------------------------------------------------
-- 7. Extension temizliği (opsiyonel, diğer uygulama uses ediyorsa bırakılabilir)
-- ---------------------------------------------------------------------------

-- pg_cron ve pg_net artık kullanılmıyorsa kaldırılabilir.
-- Ancak diğer future functionality için bırakılabilir.
-- Aşağıdaki komutlar kapalıdır; gerekiyse açılabilir:
-- drop extension if exists pg_cron cascade;
-- drop extension if exists pg_net cascade;

-- ---------------------------------------------------------------------------
-- 8. Son kontrol: artık hiçbir reminder/push yapısı kalmamalı
-- ---------------------------------------------------------------------------

-- not: Kontrol için (isteğe bağlı):
-- select table_name from information_schema.tables
--   where table_schema = 'public'
--   and table_name in ('push_subscriptions', 'reminder_deliveries');
-- outcomes should be empty
