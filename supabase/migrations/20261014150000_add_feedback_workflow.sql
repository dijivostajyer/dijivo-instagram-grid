-- Geri Dönüşler merkezi (Faz 4): ekip içi iş akışı ve okundu bilgisi.
--
-- Müşteri eylemi (action/mesaj/hedef/ad/tarih) ile ekip içi iş akışı
-- birbirinden ayrıdır:
--   * share_feedback'teki müşteri alanları DEĞİŞTİRİLEMEZ (trigger).
--   * Ekip yalnız iç sütunları günceller: workflow_status,
--     workflow_updated_at, read_at.
--   * Her iç durum değişikliği share_feedback_workflow_events tablosuna
--     yeni satır olarak eklenir (iç audit trail; silinmez/güncellenmez).
--
-- read_at: ekip geri bildirimi detayda açtığında dolar; NULL = okunmamış
-- (Faz 5 bildirim rozeti bu alanı sayar).
--
-- 20261014140000 migration'ı değiştirilmez. İdempotent.

alter table public.share_feedback
  add column if not exists workflow_status text not null default 'new',
  add column if not exists workflow_updated_at timestamptz,
  add column if not exists read_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'share_feedback_workflow_status_check') then
    alter table public.share_feedback
      add constraint share_feedback_workflow_status_check
      check (workflow_status in ('new', 'in_review', 'revision_done', 'closed'));
  end if;
end
$$;

create index if not exists share_feedback_user_created_id_idx
  on public.share_feedback (user_id, created_at desc, id desc);
create index if not exists share_feedback_user_workflow_idx
  on public.share_feedback (user_id, workflow_status, created_at desc);
create index if not exists share_feedback_user_unread_idx
  on public.share_feedback (user_id) where read_at is null;
create index if not exists share_feedback_target_idx
  on public.share_feedback (user_id, target_type, target_id, created_at);

-- Müşteri olayının içeriği değişmez; yalnız iç sütunlar güncellenebilir.
create or replace function public.share_feedback_protect_customer_fields()
returns trigger
language plpgsql
as $$
begin
  if new.id is distinct from old.id
    or new.share_token is distinct from old.share_token
    or new.user_id is distinct from old.user_id
    or new.brand_id is distinct from old.brand_id
    or new.project_id is distinct from old.project_id
    or new.target_type is distinct from old.target_type
    or new.target_id is distinct from old.target_id
    or new.action is distinct from old.action
    or new.message is distinct from old.message
    or new.client_name is distinct from old.client_name
    or new.metadata is distinct from old.metadata
    or new.created_at is distinct from old.created_at then
    raise exception 'share_feedback müşteri alanları değiştirilemez' using errcode = '42501';
  end if;
  return new;
end
$$;

drop trigger if exists share_feedback_protect_customer_fields on public.share_feedback;
create trigger share_feedback_protect_customer_fields
  before update on public.share_feedback
  for each row execute function public.share_feedback_protect_customer_fields();

create table if not exists public.share_feedback_workflow_events (
  id uuid primary key default gen_random_uuid(),
  feedback_id uuid not null references public.share_feedback (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  status text not null,
  created_at timestamptz not null default now(),
  constraint share_feedback_workflow_events_status_check
    check (status in ('new', 'in_review', 'revision_done', 'closed'))
);

create index if not exists share_feedback_workflow_events_feedback_idx
  on public.share_feedback_workflow_events (feedback_id, created_at);

alter table public.share_feedback_workflow_events enable row level security;

drop policy if exists share_feedback_workflow_events_owner_read on public.share_feedback_workflow_events;
create policy share_feedback_workflow_events_owner_read on public.share_feedback_workflow_events
  for select to authenticated
  using (user_id = auth.uid());
