# Kích hoạt Google AI Studio TTS cho Marble Race

Địa chỉ trò chơi: https://giaovien-psi.vercel.app/marble-race/

## Cấu hình (chỉ dành cho quản trị viên)

Vào Vercel → dự án **giaovien** → Settings → Environment Variables:

1. `GEMINI_API_KEY` (Required): khóa Gemini API tạo trong https://aistudio.google.com/api-keys. Đặt ở **Production** và **Preview** nếu thử nghiệm.
2. `MARBLE_TTS_PIN` (Required): tự đặt mật mã riêng mạnh **từ 12 ký tự**, khác với API key. Chỉ chia sẻ cho giáo viên cần sử dụng giọng AI.
3. `GEMINI_VOICE_ID` (Optional): mã giọng `voice_...` tạo từ Voice Design trong AI Studio, hoặc giọng dựng sẵn như `Charon`. Nếu chưa đặt, mặc định **Charon** kèm hướng dẫn phong cách giọng nam giáo viên Bắc Bộ trong yêu cầu tạo tiếng nói.
4. `GEMINI_TTS_MODEL` (Optional): `gemini-3.8-flash-tts` (mặc định) hoặc `gemini-3.8-flash-lite-tts`.

**Redeploy** bản Production sau khi thêm các biến môi trường; thay đổi biến môi trường không tự đưa vào các deployment đã được xây dựng.

## Tạo giọng riêng đúng mô tả

Trong Google AI Studio, chọn **Voice Design** rồi dùng mô tả:

> Vietnamese man aged about 30. Native standard Northern Vietnamese (Hanoi) accent. Warm resonant baritone, experienced primary and lower-secondary schoolteacher. Perfect Vietnamese consonants and six tones, clear classroom enunciation, natural conversational pacing around 130–150 Vietnamese words per minute. Empathetic, encouraging, not robotic or theatrical. Natural pauses between the question and multiple-choice answers. Preserve the actual spoken text exactly.

Nghe thử, chỉnh đến khi đạt yêu cầu. Copy mã `voice_...` rồi thiết lập `GEMINI_VOICE_ID` trên Vercel.

## Sử dụng

Vào **Học tập → Ngân hàng câu hỏi → Nguồn giọng đọc → Google AI Studio**. Nhập mã giáo viên, nhấn **Kiểm tra AI** và **Nghe thử giọng đọc**. Khi hoàn thành đua, học sinh lần lượt được gọi tên, nghe câu hỏi và A–D. Bấm **🔊 Nghe lại** để phát lại; sau khi giáo viên chấm, trò chơi mới đọc kết quả và đáp án đúng.

Nếu API key / mã giáo viên còn thiếu hoặc dịch vụ lỗi, giọng có sẵn trên thiết bị tự động được dùng; trò chơi không bị chặn. Có thể chọn hẳn **Giọng thiết bị** để không gửi tên/câu hỏi đến Google.

## Bảo mật và chi phí

Khóa Gemini chỉ nằm trên Vercel serverless function `api/marble-tts.py`, không đưa vào HTML/GitHub. Endpoint yêu cầu mật mã giáo viên và kiểm soát lưu lượng cơ bản; nhưng mật mã chia sẻ không thay thế tài khoản xác thực. Giới hạn ngân sách/quota API trong Google AI Studio và chỉ cấp mã cho giáo viên được phép. Âm thanh tạo thành công được lưu tạm trong bộ nhớ và Cache Storage ở trình duyệt để giảm chi phí; kiểm tra chính sách dữ liệu nhà trường trước khi dùng tên học sinh với dịch vụ AI bên ngoài. Dữ liệu ở phía Google chịu chính sách Gemini API của Google.

Tài liệu chính thức:
- https://ai.google.dev/gemini-api/docs/speech-generation
- https://ai.google.dev/gemini-api/docs/voice-design
- https://vercel.com/docs/functions/runtimes/python
