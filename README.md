# Mạng lưới an toàn

Mini app tương tác cho tập huấn. Bản production: https://mang-luoi-an-toan.vercel.app

## Quy trình v3

1. Người điều hành mở trang chủ.
2. **Người điều hành tự nhập câu hỏi** phù hợp với hoạt động đang tổ chức.
3. Bấm **Bắt đầu câu hỏi**. Hệ thống tạo phòng và QR.
4. Học viên quét QR bằng điện thoại.
5. Điện thoại hiển thị đúng câu hỏi của người điều hành.
6. Học viên nhập tên và **tự viết câu trả lời**; ứng dụng không đưa đáp án/gợi ý.
7. Câu trả lời xuất hiện trên màn hình chung dưới dạng các mắt xích và sợi dây.
8. Muốn dùng ứng dụng cho nội dung khác, bấm **Câu hỏi mới**, nhập câu hỏi khác và tạo lượt mới.

## Nguyên tắc thiết kế

- Không cố định câu hỏi vào chủ đề duy nhất.
- Không hiển thị các đáp án gợi ý cho học viên để tránh định hướng câu trả lời.
- Mỗi lượt có mã phòng UUID riêng.
- QR chỉ được sinh sau khi câu hỏi đã được người điều hành lưu.
- Frontend và API chạy trên Vercel; dữ liệu tạm trên Supabase.
- Không dùng WebRTC/PeerJS.
- Học viên không cần cùng Wi‑Fi với máy chiếu.
- Bảng dữ liệu không cho anon đọc/ghi trực tiếp; chỉ các RPC giới hạn của ứng dụng được gọi.

## Tự kiểm tra production

Endpoint: `/api/health`

Bài kiểm tra thực hiện toàn tuyến:
- tạo/cập nhật phòng và câu hỏi;
- đọc lại câu hỏi;
- gửi một câu trả lời;
- đọc lại câu trả lời;
- sinh QR.

Đạt khi tất cả trường trả về `ok`.

> Với chủ đề bảo vệ trẻ em, không yêu cầu người học chia sẻ danh tính của trẻ hoặc kể chi tiết một vụ xâm hại có thật.
