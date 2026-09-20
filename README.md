# Mạng lưới an toàn

Mini app tương tác dành cho tập huấn **An toàn trên mạng và Bảo vệ trẻ em**.

## Bản web online

Repository đã có bản **Vercel-ready** ở `index.html`. Báo cáo viên mở trang web trên máy chiếu; hệ thống tự tạo một phòng và QR. Học viên quét QR, nhập tên và một người/hành động có thể giúp bảo vệ trẻ em. Câu trả lời được gửi trực tiếp từ trình duyệt học viên tới trình duyệt báo cáo viên bằng WebRTC/PeerJS và xuất hiện thành các nút của **mạng lưới an toàn**.

### Đặc điểm

- Không cần học viên cài ứng dụng hay đăng nhập.
- Không cần cơ sở dữ liệu.
- Không lưu câu trả lời lên máy chủ của ứng dụng.
- Mỗi lần mở trang báo cáo viên sẽ tạo một phòng mới.
- Dữ liệu của lượt chơi nằm trong bộ nhớ trình duyệt báo cáo viên và mất khi tải lại trang.
- Cần Internet để tải trang và dùng dịch vụ tín hiệu WebRTC PeerJS Cloud.

## Triển khai Vercel

Import repository này vào Vercel và deploy ở thư mục gốc. Không cần Build Command, không cần Environment Variables.

Vercel sẽ phục vụ trực tiếp `index.html` và `vercel.json`.

## Bản dùng nội bộ không cần Internet

Repository vẫn giữ bản chạy LAN bằng Python:

1. Laptop và điện thoại cùng Wi-Fi.
2. Máy tính có Python 3.9+.
3. Chạy `start.bat` trên Windows.
4. Nếu Windows Firewall hỏi, chọn **Allow access / Private network**.
5. Học viên quét QR trên màn hình báo cáo viên.

## Khẩu lệnh gợi ý

**Báo cáo viên:** “AN TOÀN!”  
**Cả lớp:** “CHO TRẺ EM!”

## Lời dẫn gợi ý

> Mỗi thầy cô hãy quét QR. Khi nhận được màn hình, nhập tên mình và chia sẻ một người hoặc một hành động có thể giúp bảo vệ trẻ em. Khi nhấn Gửi, thầy cô sẽ trở thành một mắt xích của Mạng lưới an toàn trên màn hình của chúng ta.

---

Thiết kế cho hoạt động **“Mạng lưới an toàn”** trong tập huấn bảo vệ trẻ em.
