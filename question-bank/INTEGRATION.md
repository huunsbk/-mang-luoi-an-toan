# Ngân hàng câu hỏi dùng chung MotionClass

**Trang quản trị:** https://giaovien-psi.vercel.app/question-bank/

**Dùng trong Đua bi:** https://giaovien-psi.vercel.app/marble-race/

## Thiết kế và tương thích
- Sử dụng chính bảng `public.pose_quiz_question_bank` của MotionClass (AI Pose Quiz). Câu hỏi theo dạng `question: {id,text,image,audio,answers:[{pose,text,image,isCorrect}]}`, với các tư thế `RAISE_LEFT,RAISE_RIGHT,BOTH_UP,CROSS_ARMS`.
- API dùng chung `shared-question-api` có xác thực Supabase JWT và kiểm tra quyền sở hữu. Không sử dụng service-role key trong trình duyệt; không thay đổi `pose-quiz-api`.
- Phân loại `subject_name`, `lesson_name`, `visibility` (private/public; giữ được group khi sửa câu đã thuộc nhóm).
- Ảnh minh họa mới được lưu trong cùng private bucket `pose-quiz-media` tại tiền tố `<owner>/shared-bank-images/<question-id>/...`. Điều này bảo đảm AI Pose Quiz hiện tại có thể ký URL. Không xóa những ảnh cũ vốn do AI Pose Quiz quản lý.
- Kho âm thanh riêng `shared_question_audio` + private Storage `shared-question-voices`. Mỗi giọng, phần đọc và nội dung văn bản có SHA-256 riêng để xác định cần tạo lại khi câu hỏi thay đổi.

## Các lệnh API (POST /functions/v1/shared-question-api)

Tất cả đều có hai header `Authorization: Bearer <Supabase access token>` và `apikey: <publishable key>`.

- `bank.list` (JSON): `{action:'bank.list',subject:'ALL',lesson:'ALL',search:''}`. Kết quả `items[]` có `id,subject,lesson,visibility,owned,text,options[4],correct,spoken,imageUrl,updatedAt`.
- `bank.save` (JSON): `{action:'bank.save',item:{text,options:[A,B,C,D],correct:'B',subject,lesson,visibility:'private',id?:uuid,expected_updated_at?:timestamp}}`. Chỉ chủ sở hữu được sửa; nếu không có `id` sẽ tạo mới.
- `bank.save_many` (JSON): `{action:'bank.save_many',items:[...1–100 items]}`, có thể trả kết quả một phần nếu một câu bị lỗi và chỉ rõ `failedIndex`.
- `bank.delete` (JSON): `{action:'bank.delete',id}` – chủ sở hữu, xóa cả metadata giọng tương ứng.
- `audio.overview` (JSON): `{action:'audio.overview',ids:[...max 120 UUID]}`. Trả `items:[{id,voiceId,part,current,sizeBytes,updatedAt}]` cho **mọi giọng**, không chứa URL/tệp. `current=true` chỉ khi SHA-256 của văn bản đọc theo câu hỏi hiện tại bằng hash của tệp đã lưu. Có kiểm tra JWT và quyền xem câu hỏi.
- `audio.list` (JSON): `{action:'audio.list',ids:[...],voice_id:'nghi:deepman3909'}`, trả `part,textHash,url`; kiểm tra SHA-256 trước khi phát. Dùng `audio.list` khi mở chi tiết và cần signed URL nghe hoặc tải WAV.
- `audio.put` (multipart/form-data): `action=audio.put, id,voice_id,part,audio=<WAV File>`. Chỉ chủ sở hữu.
- `audio.delete` (JSON): `{action:'audio.delete',id,voice_id,part}`.
- `image.put` (multipart/form-data): `action=image.put,id,image=<JPEG/PNG/WebP File>`; `image.delete` (JSON): `{action:'image.delete',id}`.

`spoken` gồm `full,question,option_a,option_b,option_c,option_d,answer`. Mỗi trò chơi có thể chọn `full` để đọc cả câu, hoặc chia thành từng thành phần. NGHI-TTS chạy trong Web Worker `/marble-race/voice/piper-worker.js`, sau đó gửi WAV lên kho riêng tư; không cần quota tạo giọng Gemini.

## Kiểm thử
- Cú pháp JavaScript, Python, route HTTP 200 và triển khai Vercel staging READY.
- Giao diện Đua bi: lưu mới/lưu lại không tạo bản trùng trong các bài kiểm thử giả lập Chromium và WebKit trên iPhone.
- API Supabase từ chối yêu cầu không xác thực HTTP 401.
- Cần kiểm thử đăng nhập/sửa/lưu giọng/ảnh thực tế bằng tài khoản chủ sở hữu vì không truy cập mật khẩu của giáo viên. Không thử bằng dữ liệu thật và không chỉnh sửa Giaipic.

## Giao diện đồng bộ Đua bi ↔ Ngân hàng câu hỏi
- Đua bi hiển thị huy hiệu **số giọng / WAV** cho từng câu khi lấy từ ngân hàng. Nút lưu câu hỏi kèm NGHI-TTS hoặc lưu giọng ở phần kho chung đều cập nhật cùng bảng `shared_question_audio`.
- Ngân hàng câu hỏi tải toàn bộ inventory có phân trang theo nhóm 100 UUID, lọc **Đã có giọng / Chưa có / Tệp cũ**; có thống kê và huy hiệu ngay trên mỗi câu. Khi mở câu hỏi, giọng có số tệp hợp lệ lớn nhất được chọn, các giọng khác hiện thành chip, 7 mục âm thanh hiện rõ có/chưa/cũ; cho phép **nghe / tải WAV / xóa** theo quyền sở hữu.
- Khi lưu ở bất kỳ trang nào, phát tín hiệu `localStorage('motionclass:shared-bank-sync')` để tab đang mở tự kiểm tra lại. Khi quay về tab bằng `focus` hay `visibilitychange`, Ngân hàng kiểm tra Supabase; không tin tưởng cache local cho trạng thái âm thanh.
- Không ghi lại vào hai bộ dữ liệu riêng; hai trang sử dụng `bank_question_id` và `voice_id` giống nhau. Ngân hàng hiện có 7 loại đoạn âm thanh, Đua bi thường lưu hai loại `full` và `answer`.
- Dịch vụ lưu giọng tách biệt với điều kiện đăng nhập MotionClass và quyền xem nội dung. WAV ký URL tạm thời; inventory không công khai liên kết tải.

## Giao diện thư viện học liệu (tháng 10/2026)
- **Màn hình chính /question-bank/**: dạng bảng như thư viện học liệu, có tab Tất cả, Riêng tư, Công khai, Theo nhóm; lọc theo từ khóa, môn học, khối lớp, bài/chủ đề và trạng thái WAV; gom nhóm theo bài, khối, môn hoặc không gom. Hàng câu hỏi hiển thị huy hiệu giọng, quyền chia sẻ và các nút Xem/Sửa/WAV.
- **Màn hình con** trên cùng đường dẫn với hash: `#preview/<question-id>`, `#edit/<question-id>`, `#audio/<question-id>`, `#new`, `#import`. Giữ URL dễ chia sẻ tới cùng hệ thống đăng nhập; phần chi tiết kiểm tra quyền từ backend khi lấy dữ liệu. Màn hình nhập và màn hình biên tập tách biệt, không hiện tất cả các khối chức năng cùng lúc.
- Khối lớp **được suy ra có điều kiện từ trường môn học hoặc bài/chủ đề** (như “Tin học 5”, “Lớp 3”, “Khối 6”), chưa có cột khối lớp độc lập trong Supabase. Các câu không xác định hiển thị “Chưa phân lớp”; không tự sửa dữ liệu gốc.
- Bản thiết kế này chỉ thay đổi `question-bank/index.html` và `question-bank/manager.js`, không thay đổi bảng, dữ liệu, RLS, giọng NGHI-TTS hoặc trò chơi Giaipic. Khi sửa câu hỏi làm thay đổi lời đọc, các tệp WAV được kiểm tra hash như trước và đánh dấu cần tạo lại.
- Kiểm thử trên trình duyệt Chromium và WebKit giả lập iPhone với MotionClass API giả lập: bảng, các tab quyền chia sẻ, bộ lọc, gom nhóm, màn hình xem/sửa/WAV, lưu mới, nhập hàng loạt, responsive và lỗi JavaScript.

## Mục Lớp 1–12 (15/10/2026)
- Bảng `public.pose_quiz_question_bank` đã bổ sung cột nullable `grade smallint`, với constraint `grade IS NULL OR (grade BETWEEN 1 AND 12)`. Tất cả dữ liệu cũ mặc định NULL để **không ghi đè hoặc gán sai lớp**. Không thay đổi cấu trúc `question` JSON Pose Quiz, âm thanh hoặc RLS.
- `shared-question-api` `bank.list` trả `grade: number|null`; `bank.save`/`bank.save_many` nhận `grade` số nguyên 1–12. Khách API cũ không gửi `grade` vẫn hoạt động: khi cập nhật, máy chủ bảo tồn giá trị grade trước đó; khi tạo mới từ khách cũ, grade=null.
- Trong Ngân hàng câu hỏi, `editGrade` bắt buộc chọn lớp khi tạo hoặc sửa; `bulkGrade` là lớp chung cho bộ nhập nhanh, còn bộ lọc `filterGrade` có đủ 12 lớp và có `Chưa phân lớp` nếu cần. `gradeOf` ưu tiên cột `grade`, chỉ suy đoán từ tên môn/bài với dữ liệu cũ (grade null).
- Trong Đua bi, `quickBankGrade` bắt buộc chọn lớp khi lưu vào ngân hàng; bộ câu hỏi giống nhau nhưng khác lớp được coi là hai bộ học liệu riêng.
- CSV xuất có cột **Lớp**, JSON giữ `grade` cùng câu hỏi. Các tệp giọng đọc không bị thay đổi khi cập nhật riêng lớp.
- Kiểm thử giả lập API trên Chromium và WebKit/iPhone: 13 lựa chọn gồm placeholder và lớp 1–12; bắt buộc chọn; lưu lớp 12, đổi sang lớp 1; câu legacy suy đoán từ môn; lọc đúng lớp riêng; nhập hàng loạt lớp 2; lưu từ Đua bi lớp 12; không lỗi JavaScript.

## Google AI Studio (Gemini TTS) trong Ngân hàng câu hỏi
- Giáo viên có thể chọn **NGHI-TTS** hoặc **Google AI Studio** ở trang phụ quản lý giọng đọc của câu hỏi. Google AI Studio sử dụng nguyên bộ máy chủ `/api/marble-tts` (Vercel), header `X-Marble-Teacher-Code`, biến môi trường `GEMINI_API_KEY`, `MARBLE_TTS_PIN`, `GEMINI_VOICE_ID` đã thiết lập cho Đua bi. Không yêu cầu nhập Google API key vào trình duyệt; mã PIN chỉ giữ trong trường mật khẩu của trang, không lưu lại.
- `GET /api/marble-tts` cho biết `configured` và `voiceVersion` (SHA-256 rút gọn 16 hex của giọng máy chủ). Tệp của Gemini được lưu với `voice_id=studio:<voiceVersion>`, khác hoàn toàn NGHI (`voice_id=nghi:<model>`). Nếu đổi `GEMINI_VOICE_ID`, các giọng Gemini cũ vẫn nghe được; những tệp tạo mới ghi vào ID giọng mới.
- Supabase `shared-question-api` v10 hỗ trợ đồng thời `nghi:[a-z0-9]{2,45}` và `studio:[0-9a-f]{16}` trong `audio.list`, `audio.put`, `audio.delete`. Giữ nguyên kiểm tra người sở hữu câu hỏi, JWT, giới hạn 5 MiB và xác thực chữ ký RIFF/WAVE. Tệp dùng folder khác nhau để tránh ghi đè: `<uid>/<qid>/<nghi-id>/...` và `<uid>/<qid>/studio-<version>/...`.
- Cùng một câu hỏi có thể lưu **7 đoạn âm thanh** mỗi giọng: toàn câu, câu hỏi, các lựa chọn A/B/C/D, công bố đáp án. Trang quản lý hiển thị những giọng đã có và tệp WAV còn hợp lệ/đã cũ, có nút Nghe, Tải WAV, Xóa theo quyền. Cùng dữ liệu Supabase dùng lại được trong Đua bi.
- Đua bi: chế độ AI Studio cũng dùng `voice_id=studio:<voiceVersion>` để **nạp WAV đã lưu**, **lưu WAV mới** hoặc **xuất ZIP**; chế độ NGHI-TTS giữ nguyên. Với Gemini, cần mã giáo viên và hạn mức Google để tạo mới, còn phát WAV đã lưu không gọi API Gemini TTS.
- Google AI Studio có thể giới hạn lượt hoặc trả 429; không hứa tạo giọng nếu API key/PIN/quota chưa hợp lệ. Cần kiểm thử bằng tài khoản thật và mã giáo viên khi triển khai. Các bài kiểm thử trình duyệt dùng API AI Studio/Supabase mô phỏng, không tốn quota Google.
