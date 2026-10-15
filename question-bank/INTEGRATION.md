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
