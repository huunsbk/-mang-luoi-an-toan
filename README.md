# Mạng lưới an toàn

Mini app tương tác dành cho tập huấn **An toàn trên mạng và Bảo vệ trẻ em**.

## Mục đích

Học viên dùng điện thoại quét QR → nhập tên và chia sẻ **một người hoặc một hành động có thể giúp bảo vệ trẻ em** → câu trả lời xuất hiện ngay trên màn chiếu và tự tạo thành một mạng lưới kết nối.

## Điểm nổi bật

- Không cần cài ứng dụng trên điện thoại.
- Không cần Internet; chỉ cần laptop và điện thoại cùng một mạng Wi‑Fi/LAN.
- Không cần tài khoản.
- Dữ liệu chỉ lưu tạm trong bộ nhớ của laptop và mất khi tắt ứng dụng.
- Báo cáo viên có thể bật toàn màn hình, ẩn/hiện nội dung và làm mới trò chơi.
- QR tham gia được tạo ngay trên máy báo cáo viên.

## Chạy trên Windows

1. Tải mã nguồn hoặc bản ZIP về máy và giải nén.
2. Kết nối laptop và điện thoại học viên vào **cùng một Wi‑Fi**.
3. Máy tính cần có **Python 3.9+**.
4. Nhấp đúp `start.bat`.
5. Nếu Windows Firewall hỏi quyền, chọn **Allow access / Cho phép trên Private network**.
6. Trình duyệt sẽ mở màn hình dành cho báo cáo viên.
7. Chiếu màn hình laptop lên máy chiếu/màn hình tương tác.
8. Học viên quét QR để tham gia.

Màn hình báo cáo viên mặc định:

`http://127.0.0.1:8765/?mode=host`

## Khi điện thoại không mở được QR

- Kiểm tra điện thoại và laptop cùng Wi‑Fi.
- Đặt Windows Network Profile là **Private**.
- Cho phép Python qua Windows Defender Firewall ở mạng Private.
- Một số Wi‑Fi công cộng bật AP/Client Isolation. Khi đó nên dùng hotspot riêng hoặc router riêng cho lớp tập huấn.

## Khẩu lệnh gợi ý

**Báo cáo viên:** “AN TOÀN!”  
**Cả lớp:** “CHO TRẺ EM!”

## Lời dẫn gợi ý

> Mỗi thầy cô hãy quét QR. Khi nhận được màn hình, nhập tên mình và chia sẻ một người hoặc một hành động có thể giúp bảo vệ trẻ em. Khi nhấn Gửi, thầy cô sẽ trở thành một mắt xích của Mạng lưới an toàn trên màn hình của chúng ta.

## Yêu cầu

- Windows 10/11, macOS hoặc hệ điều hành có Python 3.9+
- Chrome, Edge, Safari hoặc trình duyệt hiện đại
- Không cần cài thêm thư viện Python: thư viện tạo QR tối thiểu đã được đóng gói trong thư mục `vendor`.

## Dừng ứng dụng

Đóng cửa sổ server hoặc nhấn `Ctrl+C`.

---

Thiết kế cho hoạt động **“Mạng lưới an toàn”** trong tập huấn bảo vệ trẻ em.
