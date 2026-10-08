-- Her teslimat kanalı kendi once-only kaydını tutar.
-- Önceki unique (item_id, remind_at) kısıtı browser_push satırının
-- uygulama içi teslimatı engellemesine neden oluyordu.

alter table public.reminder_deliveries
  drop constraint if exists reminder_deliveries_once;

alter table public.reminder_deliveries
  add constraint reminder_deliveries_once
  unique (item_id, remind_at, channel);
