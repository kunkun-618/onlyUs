-- 在 Supabase SQL Editor 中以 postgres 管理员运行。
-- 本脚本管理下列五张业务表的全部 RLS 策略；重复运行会重建策略，不清空数据。
-- 两人上限由管理员维护：仅在部署时写入两个 app_members，客户端无写权限。
begin;

create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;
grant usage on schema app_private to authenticated;

create table if not exists public.app_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 80)
);

-- SECURITY DEFINER 以建函数的管理员身份查成员表，避免成员表 RLS 自递归。
-- 不接受调用者传入的 uid，始终判断当前 JWT 用户。
create or replace function app_private.is_app_member()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.app_members where user_id = (select auth.uid())
  );
$$;
revoke all on function app_private.is_app_member() from public, anon, authenticated;
grant execute on function app_private.is_app_member() to authenticated;

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null default auth.uid() references auth.users(id),
  content text not null check (char_length(btrim(content)) between 1 and 10000),
  created_at timestamptz not null default now()
);

create table if not exists public.miss_you_logs (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id),
  title text not null default '' check (char_length(title) <= 200),
  content text not null default '' check (char_length(content) <= 100000),
  visibility text not null default 'private' check (visibility in ('private', 'shared')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.photos (
  id uuid primary key default gen_random_uuid(),
  uploader_id uuid not null default auth.uid() references auth.users(id),
  storage_path text not null unique,
  file_name text not null check (char_length(file_name) between 1 and 255),
  media_type text not null default 'image' check (media_type in ('image', 'video')),
  mime_type text,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  created_at timestamptz not null default now(),
  constraint photos_owner_path check (
    split_part(storage_path, '/', 1) = uploader_id::text
    and char_length(storage_path) > 37
    and storage_path !~ '(^|/)\.\.(/|$)'
  )
);

-- 兼容已存在的 photos 表；默认值会将既有行标记为 image，不重建或清空数据。
alter table public.photos add column if not exists media_type text not null default 'image';
alter table public.photos add column if not exists mime_type text;
alter table public.photos add column if not exists size_bytes bigint;
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.photos'::regclass and conname = 'photos_media_type_check'
  ) then
    alter table public.photos add constraint photos_media_type_check
      check (media_type in ('image', 'video'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.photos'::regclass and conname = 'photos_size_bytes_check'
  ) then
    alter table public.photos add constraint photos_size_bytes_check
      check (size_bytes is null or size_bytes >= 0);
  end if;
end;
$$;

create index if not exists messages_created_at_id_idx on public.messages (created_at desc, id desc);
create index if not exists miss_you_logs_created_at_id_idx on public.miss_you_logs (created_at desc, id desc);
create index if not exists notes_owner_updated_idx on public.notes (owner_id, updated_at desc);
create index if not exists notes_shared_updated_idx on public.notes (updated_at desc) where visibility = 'shared';
create index if not exists photos_created_at_id_idx on public.photos (created_at desc, id desc);

create or replace function app_private.touch_note_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;
revoke all on function app_private.touch_note_updated_at() from public, anon, authenticated;
drop trigger if exists notes_touch_updated_at on public.notes;
create trigger notes_touch_updated_at before update on public.notes
for each row execute function app_private.touch_note_updated_at();

alter table public.app_members enable row level security;
alter table public.messages enable row level security;
alter table public.miss_you_logs enable row level security;
alter table public.notes enable row level security;
alter table public.photos enable row level security;

-- 清除本脚本管理的业务表旧策略，避免旧的宽松策略与新策略按 OR 合并。
do $$
declare p record;
begin
  for p in
    select tablename, policyname from pg_policies
    where schemaname = 'public'
      and tablename in ('app_members', 'messages', 'miss_you_logs', 'notes', 'photos')
  loop
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
  end loop;
end;
$$;

-- 同时清除可能存在的列级授权。RLS 和 SQL 权限必须同时通过。
revoke all on table public.app_members, public.messages, public.miss_you_logs,
  public.notes, public.photos from public, anon, authenticated;
do $$
declare t text; cols text;
begin
  foreach t in array array['app_members', 'messages', 'miss_you_logs', 'notes', 'photos']
  loop
    select string_agg(quote_ident(column_name), ', ') into cols
    from information_schema.columns where table_schema = 'public' and table_name = t;
    execute format('revoke all privileges (%s) on table public.%I from public, anon, authenticated', cols, t);
  end loop;
end;
$$;
grant usage on schema public to authenticated;
grant select on public.app_members, public.messages, public.miss_you_logs,
  public.notes, public.photos to authenticated;
grant insert (sender_id, content) on public.messages to authenticated;
grant insert (sender_id) on public.miss_you_logs to authenticated;
grant insert (owner_id, title, content, visibility) on public.notes to authenticated;
grant update (title, content, visibility) on public.notes to authenticated;
grant delete on public.notes to authenticated;
grant insert (uploader_id, storage_path, file_name, media_type, mime_type, size_bytes) on public.photos to authenticated;
grant delete on public.photos to authenticated;

create policy app_members_read on public.app_members for select to authenticated
using ((select app_private.is_app_member()));

create policy messages_read on public.messages for select to authenticated
using ((select app_private.is_app_member()));
create policy messages_insert on public.messages for insert to authenticated
with check ((select app_private.is_app_member()) and sender_id = (select auth.uid()));

create policy miss_you_logs_read on public.miss_you_logs for select to authenticated
using ((select app_private.is_app_member()));
create policy miss_you_logs_insert on public.miss_you_logs for insert to authenticated
with check ((select app_private.is_app_member()) and sender_id = (select auth.uid()));

create policy notes_read on public.notes for select to authenticated
using ((select app_private.is_app_member()) and (owner_id = (select auth.uid()) or visibility = 'shared'));
create policy notes_insert on public.notes for insert to authenticated
with check ((select app_private.is_app_member()) and owner_id = (select auth.uid()));
create policy notes_update on public.notes for update to authenticated
using ((select app_private.is_app_member()) and owner_id = (select auth.uid()))
with check ((select app_private.is_app_member()) and owner_id = (select auth.uid()));
create policy notes_delete on public.notes for delete to authenticated
using ((select app_private.is_app_member()) and owner_id = (select auth.uid()));

create policy photos_read on public.photos for select to authenticated
using ((select app_private.is_app_member()));
create policy photos_insert on public.photos for insert to authenticated
with check ((select app_private.is_app_member()) and uploader_id = (select auth.uid()));
create policy photos_delete on public.photos for delete to authenticated
using ((select app_private.is_app_member()) and uploader_id = (select auth.uid()));

-- 只通过 Storage API 操作文件；不要直接 INSERT/DELETE storage.objects。
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'photos', 'photos', false, 52428800,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4']
)
on conflict (id) do update set
  public = false,
  file_size_limit = 52428800,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4'];

-- 不改动其他 bucket 的策略；已有项目必须审计其他 storage.objects 策略，见 README。
drop policy if exists app_photos_read on storage.objects;
drop policy if exists app_photos_insert on storage.objects;
drop policy if exists app_photos_delete on storage.objects;
create policy app_photos_read on storage.objects for select to authenticated
using (bucket_id = 'photos' and (select app_private.is_app_member()));
create policy app_photos_insert on storage.objects for insert to authenticated
with check (
  bucket_id = 'photos' and (select app_private.is_app_member())
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
create policy app_photos_delete on storage.objects for delete to authenticated
using (
  bucket_id = 'photos' and (select app_private.is_app_member())
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
-- 不授予 UPDATE 策略，不支持覆盖上传；每次上传生成新路径。

-- Postgres Changes 只需默认主键 replica identity，避免 FULL 暴露私密笔记旧正文。
alter table public.messages replica identity default;
alter table public.miss_you_logs replica identity default;
alter table public.notes replica identity default;
alter table public.photos replica identity default;
do $$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    execute 'create publication supabase_realtime';
  end if;
  foreach t in array array['messages', 'miss_you_logs', 'notes', 'photos']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;

commit;
