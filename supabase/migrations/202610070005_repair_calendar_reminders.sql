-- Mevcut calendar_items kayıtlarında reminder trigger'ını güvenceye alır.
-- 0003 daha önce uygulanmış olsa bile bu migration güvenle tekrar çalışır.

create or replace function public.dijivo_touch_calendar_row()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  if new.reminder_offset_minutes is null then
    new.remind_at := null;
  else
    new.remind_at := new.scheduled_at
      - make_interval(mins => new.reminder_offset_minutes::int);
  end if;
  return new;
end;
$$;

drop trigger if exists calendar_items_touch_row on public.calendar_items;
create trigger calendar_items_touch_row
  before insert or update on public.calendar_items
  for each row execute function public.dijivo_touch_calendar_row();

-- Geçmişte trigger devre dışı/eksik iken yazılmış satırları onarır.
update public.calendar_items
set remind_at = scheduled_at - make_interval(mins => reminder_offset_minutes::int)
where reminder_offset_minutes is not null
  and remind_at is distinct from scheduled_at - make_interval(mins => reminder_offset_minutes::int);

update public.calendar_items
set remind_at = null
where reminder_offset_minutes is null
  and remind_at is not null;
