-- Cho phép mã giọng Microsoft "edge:<giọng>-v<n>" (tạo trước, mỗi đoạn một tệp) bên cạnh studio:/nghi:.
-- Chỉ nới ràng buộc; dữ liệu và các giọng hiện có giữ nguyên.
alter table public.teacher_student_name_audio drop constraint if exists teacher_student_name_audio_voice_id_check;
alter table public.teacher_student_name_audio add constraint teacher_student_name_audio_voice_id_check
 check (voice_id ~ '^(studio:[0-9a-f]{16}|nghi:[a-z0-9]{2,45}|edge:[a-z0-9-]{2,45})$');
alter table public.shared_question_audio drop constraint if exists shared_question_audio_voice_id_check;
alter table public.shared_question_audio add constraint shared_question_audio_voice_id_check
 check (voice_id ~ '^(nghi:[a-z0-9]{2,45}|studio:[a-f0-9]{16}|edge:[a-z0-9-]{2,45})$');
alter table public.teacher_phrase_audio drop constraint if exists teacher_phrase_audio_voice_id_check;
alter table public.teacher_phrase_audio add constraint teacher_phrase_audio_voice_id_check
 check (voice_id ~ '^(studio:[0-9a-f]{16}|nghi:[a-z0-9]{2,45}|edge:[a-z0-9-]{2,45})$');
