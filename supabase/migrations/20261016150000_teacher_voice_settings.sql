-- MotionClass · Giọng hệ thống của từng giáo viên (một giọng Microsoft dùng cho tên, câu dẫn, câu hỏi).
-- Bổ sung thuần (additive): không sửa/xóa bảng, dữ liệu hay chính sách hiện có.
-- Đổi người đọc / chất giọng ở trang Giọng đọc → ghi voice_id mới vào đây; Đua bi và các trò chơi đọc giọng này.

create table if not exists public.teacher_voice_settings (
 owner_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
 voice_id text not null check (voice_id ~ '^edge:[a-z0-9-]{2,45}$'),
 updated_at timestamptz not null default now()
);
alter table public.teacher_voice_settings enable row level security;

create policy "voice_settings_owner_select" on public.teacher_voice_settings
 for select to authenticated using (teacher_voice_settings.owner_id = (select auth.uid()));
create policy "voice_settings_owner_insert" on public.teacher_voice_settings
 for insert to authenticated with check (teacher_voice_settings.owner_id = (select auth.uid()));
create policy "voice_settings_owner_update" on public.teacher_voice_settings
 for update to authenticated using (teacher_voice_settings.owner_id = (select auth.uid()))
 with check (teacher_voice_settings.owner_id = (select auth.uid()));

grant select, insert, update on public.teacher_voice_settings to authenticated;
