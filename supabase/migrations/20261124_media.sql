-- 既有 Supabase 项目的增量媒体迁移；可重复执行，不删除或重建数据。
begin;

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

grant insert (uploader_id, storage_path, file_name, media_type, mime_type, size_bytes)
  on public.photos to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'photos', 'photos', false, 52428800,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4']
)
on conflict (id) do update set
  public = false,
  file_size_limit = 52428800,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4'];

commit;
