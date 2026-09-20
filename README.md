# Mạng lưới an toàn

Bản production: https://mang-luoi-an-toan.vercel.app

## Phiên bản 4.0

Người điều hành:
1. Nhập câu hỏi.
2. Chọn **giới hạn số từ** cho câu trả lời (1–20 từ).
3. Bấm **Bắt đầu câu hỏi** để tạo phòng và QR.

Người tham gia:
- Không nhận đáp án gợi ý.
- Nhập tên và một từ khóa/cụm từ ngắn.
- Từ khóa tự chuyển sang CHỮ HOA.
- Dấu câu/ký hiệu được bỏ; khoảng trắng thừa được chuẩn hóa.
- Hệ thống chặn câu trả lời vượt quá giới hạn số từ do người điều hành đặt.

## Cách nhóm từ khóa

Hai câu trả lời được coi là cùng từ khóa khi, sau chuẩn hóa:
- cùng chữ HOA;
- bỏ dấu câu/ký hiệu;
- bỏ khoảng trắng để tạo khóa so sánh.

Ví dụ:
- `lắng nghe trẻ`
- `LẮNG  NGHE TRẺ!`
- `lắng-nghe-trẻ`

đều được nhóm thành **LẮNG NGHE TRẺ**.

## Hiển thị mạng lưới

- Mỗi **từ khóa** là một nút lớn, chữ HOA.
- Mỗi từ khóa có một màu riêng.
- Tên những người chọn từ khóa đó dùng cùng màu và có đường nối ngắn đến từ khóa.
- Từ khóa càng có nhiều người chọn thì cỡ chữ càng lớn.
- Có thể ẩn/hiện tên người để tập trung vào xu hướng từ khóa.

## Kiểm tra production

Endpoint:
`/api/health`

Bài kiểm tra toàn tuyến xác minh:
- tạo phòng và lưu câu hỏi;
- lưu/đọc giới hạn số từ;
- chuẩn hóa từ khóa;
- từ chối câu vượt giới hạn từ;
- gửi và đọc câu trả lời;
- sinh QR.

Đạt khi tất cả trường đều trả về `ok`.


## Chế độ hồi hộp

Người điều hành có thêm hai nút:
- **Ẩn tất cả**: ẩn toàn bộ từ khóa, tên người và các đường nối; chỉ giữ câu hỏi và biểu tượng trung tâm.
- Khi đang ẩn, **mỗi lần nhấp vào vùng mạng lưới sẽ mở một cụm từ khóa cùng toàn bộ người đã chọn từ khóa đó**.
- Các cụm được mở tuần tự; hệ thống ưu tiên để các từ khóa có nhiều người chọn xuất hiện về sau, tạo cảm giác hồi hộp.
- **Hiển thị tất cả**: bỏ chế độ mở từng bước và hiện ngay toàn bộ kết quả.
