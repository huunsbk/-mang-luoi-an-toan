-- MotionClass · Kịch bản lời dẫn và kho WAV câu dẫn của giáo viên.
-- Bổ sung thuần (additive): không sửa/xóa bảng, dữ liệu hay chính sách hiện có.
--
-- teacher_voice_scripts : kịch bản của từng giáo viên (các mẫu câu có {tên}, {số}, {đáp án}...)
-- teacher_phrase_audio  : WAV đã duyệt của từng ĐOẠN câu dẫn, khóa theo (giáo viên, giọng, SHA-256 nội dung).
--                         Cùng một đoạn ("Mời em", "Chúc mừng em", số "3"...) dùng chung cho mọi kịch bản,
--                         nên không bao giờ phải gọi Google hai lần cho cùng một nội dung.
-- Mọi điều kiện RLS đều ghi rõ tên bảng để tránh lỗi tự so sánh cột (s.col = col).

create table if not exists public.teacher_voice_scripts (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 title text not null check (char_length(btrim(title)) between 1 and 80),
 theme text not null default 'custom' check (char_length(theme) between 1 and 40),
 slots jsonb not null check (jsonb_typeof(slots) = 'object' and octet_length(slots::text) <= 24000),
 is_active boolean not null default true,
 sort_order integer not null default 0,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists teacher_voice_scripts_owner_idx
 on public.teacher_voice_scripts(owner_id, sort_order, created_at);
alter table public.teacher_voice_scripts enable row level security;

create policy "voice_scripts_owner_select" on public.teacher_voice_scripts
 for select to authenticated using (teacher_voice_scripts.owner_id = (select auth.uid()));
create policy "voice_scripts_owner_insert" on public.teacher_voice_scripts
 for insert to authenticated with check (teacher_voice_scripts.owner_id = (select auth.uid()));
create policy "voice_scripts_owner_update" on public.teacher_voice_scripts
 for update to authenticated using (teacher_voice_scripts.owner_id = (select auth.uid()))
 with check (teacher_voice_scripts.owner_id = (select auth.uid()));
create policy "voice_scripts_owner_delete" on public.teacher_voice_scripts
 for delete to authenticated using (teacher_voice_scripts.owner_id = (select auth.uid()));

create table if not exists public.teacher_phrase_audio (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 voice_id text not null check (voice_id ~ '^(studio:[0-9a-f]{16}|nghi:[a-z0-9]{2,45})$'),
 text_hash text not null check (text_hash ~ '^[0-9a-f]{64}$'),
 phrase text not null check (char_length(phrase) between 1 and 220),
 storage_path text not null,
 mime_type text not null default 'audio/wav' check (mime_type = 'audio/wav'),
 size_bytes integer not null check (size_bytes between 45 and 3145728),
 updated_at timestamptz not null default now(),
 unique (owner_id, voice_id, text_hash)
);
create index if not exists teacher_phrase_audio_owner_voice_idx
 on public.teacher_phrase_audio(owner_id, voice_id);
alter table public.teacher_phrase_audio enable row level security;

create policy "phrase_audio_owner_select" on public.teacher_phrase_audio
 for select to authenticated using (teacher_phrase_audio.owner_id = (select auth.uid()));
create policy "phrase_audio_owner_insert" on public.teacher_phrase_audio
 for insert to authenticated with check (
  teacher_phrase_audio.owner_id = (select auth.uid())
  and split_part(teacher_phrase_audio.storage_path, '/', 1) = (select auth.uid())::text
 );
create policy "phrase_audio_owner_update" on public.teacher_phrase_audio
 for update to authenticated using (teacher_phrase_audio.owner_id = (select auth.uid()))
 with check (
  teacher_phrase_audio.owner_id = (select auth.uid())
  and split_part(teacher_phrase_audio.storage_path, '/', 1) = (select auth.uid())::text
 );
create policy "phrase_audio_owner_delete" on public.teacher_phrase_audio
 for delete to authenticated using (teacher_phrase_audio.owner_id = (select auth.uid()));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('teacher-phrase-voices', 'teacher-phrase-voices', false, 3145728, array['audio/wav']::text[])
on conflict (id) do nothing;

create policy "teacher_phrase_voice_read" on storage.objects
 for select to authenticated using (
  bucket_id = 'teacher-phrase-voices' and (storage.foldername(name))[1] = (select auth.uid())::text
 );
create policy "teacher_phrase_voice_insert" on storage.objects
 for insert to authenticated with check (
  bucket_id = 'teacher-phrase-voices' and (storage.foldername(name))[1] = (select auth.uid())::text
 );
create policy "teacher_phrase_voice_update" on storage.objects
 for update to authenticated using (
  bucket_id = 'teacher-phrase-voices' and (storage.foldername(name))[1] = (select auth.uid())::text
 ) with check (
  bucket_id = 'teacher-phrase-voices' and (storage.foldername(name))[1] = (select auth.uid())::text
 );
create policy "teacher_phrase_voice_delete" on storage.objects
 for delete to authenticated using (
  bucket_id = 'teacher-phrase-voices' and (storage.foldername(name))[1] = (select auth.uid())::text
 );

grant select, insert, update, delete on public.teacher_voice_scripts to authenticated;
grant select, insert, update, delete on public.teacher_phrase_audio to authenticated;
