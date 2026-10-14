-- Müşteri onay / revize geri bildirimleri (Faz 3).
--
-- Append-only olay günlüğü: aynı içerik için yeni geri bildirim yeni satır
-- olarak eklenir; eski satır güncellenmez/silinmez (audit trail). "Son
-- durum" uygulamada her hedefin en yeni satırıdır.
--
-- Yazma yalnız sunucudan (service role, POST /api/shares/[token]/feedback)
-- yapılır: public istemci için insert/update/delete policy'si YOKTUR.
-- Ajans (marka sahibi) kendi geri bildirimlerini RLS ile okuyabilir.
--
-- created_at veritabanında now() ile üretilir; istemci saati kullanılmaz.
-- İdempotent: tekrar çalıştırılabilir.

create table if not exists public.share_feedback (
  id uuid primary key default gen_random_uuid(),
  share_token uuid not null references public.share_snapshots (token) on delete cascade,
  user_id uuid references auth.users (id) on delete cascade,
  brand_id text,
  project_id text,
  target_type text not null,
  target_id text,
  action text not null,
  message text,
  client_name text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint share_feedback_target_type_check
    check (target_type in ('post', 'reel', 'story', 'grid')),
  constraint share_feedback_action_check
    check (action in ('approved', 'revision_requested')),
  constraint share_feedback_target_id_check
    check ((target_type = 'grid' and target_id is null) or (target_type <> 'grid' and target_id is not null)),
  constraint share_feedback_message_length_check
    check (message is null or char_length(message) <= 2000),
  constraint share_feedback_revision_message_check
    check (action <> 'revision_requested' or (message is not null and char_length(btrim(message)) > 0)),
  constraint share_feedback_client_name_check
    check (char_length(btrim(client_name)) between 1 and 80)
);

create index if not exists share_feedback_token_created_idx
  on public.share_feedback (share_token, created_at);
create index if not exists share_feedback_user_created_idx
  on public.share_feedback (user_id, created_at desc);
create index if not exists share_feedback_project_idx
  on public.share_feedback (brand_id, project_id);

alter table public.share_feedback enable row level security;

drop policy if exists share_feedback_owner_read on public.share_feedback;
create policy share_feedback_owner_read on public.share_feedback
  for select to authenticated
  using (user_id = auth.uid());
