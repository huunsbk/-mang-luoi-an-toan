-- MotionClass · Phần đọc "Giải thích" của câu hỏi (giáo viên điền, không bắt buộc).
-- Chỉ nới điều kiện part của shared_question_audio để nhận thêm 'explain'; không đổi dữ liệu hiện có.
-- Nội dung giải thích nằm trong pose_quiz_question_bank.question->>'explanation' (jsonb sẵn có), không thêm cột.
alter table public.shared_question_audio drop constraint if exists shared_question_audio_part_check;
alter table public.shared_question_audio add constraint shared_question_audio_part_check
 check (part = any (array['full','question','option_a','option_b','option_c','option_d','answer','explain']));
