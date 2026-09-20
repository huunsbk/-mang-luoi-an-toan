# Mạng lưới an toàn

Mini app tương tác dành cho tập huấn **An toàn trên mạng và Bảo vệ trẻ em**.

## Bản online

Mở: https://mang-luoi-an-toan.vercel.app

Quy trình:
1. Báo cáo viên mở trang chủ trên máy tính/màn chiếu.
2. Hệ thống tự tạo một **mã phòng ngẫu nhiên** và QR.
3. Học viên quét QR bằng điện thoại.
4. Học viên nhập tên + một người/hành động giúp bảo vệ trẻ em.
5. Câu trả lời được gửi qua HTTPS tới API Vercel, lưu tạm trong Supabase và màn chiếu đồng bộ khoảng mỗi 0,8 giây.
6. Mỗi câu trả lời trở thành một mắt xích và sợi dây trong mạng lưới.
7. Nút **Tạo lượt chơi mới** tạo mã phòng mới; QR cũ không còn hiển thị vào lượt hiện tại.

## Kiến trúc v2.1

- Frontend tĩnh: Vercel.
- API cùng tên miền: Vercel Functions.
- Dữ liệu tạm: Supabase PostgreSQL thông qua 2 RPC giới hạn chức năng.
- Không dùng WebRTC/PeerJS, nên không phụ thuộc NAT, TURN hoặc việc các thiết bị có cùng Wi-Fi.
- QR được tạo bởi API của chính ứng dụng, không phụ thuộc CDN/QR bên ngoài.
- Dữ liệu lượt chơi được tự loại khỏi kết quả sau tối đa 24 giờ.
- Bảng dữ liệu không được cấp SELECT/INSERT trực tiếp cho anon; frontend chỉ gọi RPC giới hạn theo mã phòng UUID.

## Kiểm tra hệ thống

Endpoint kiểm tra toàn tuyến:
- `/api/health`

Kết quả đạt yêu cầu khi trả về:
`{"ok":true,...,"database":"ok"}`

## Bản LAN ngoại tuyến

Bản Python cũ được lưu trong thư mục `offline/` để dự phòng khi địa điểm không có Internet.

## Khẩu lệnh gợi ý

**Báo cáo viên:** “AN TOÀN!”  
**Cả lớp:** “CHO TRẺ EM!”

> Lưu ý bảo vệ trẻ em: trong hoạt động khởi động không yêu cầu người học kể trường hợp xâm hại có thật hoặc chia sẻ thông tin nhận diện của trẻ.
