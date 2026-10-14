# MotionClass – quên mật khẩu

**Trang khôi phục:** https://giaovien-psi.vercel.app/forgot-password/

## Quy trình
1. Từ trang đăng nhập Ngân hàng câu hỏi, Quản lý lớp học, Đua bi, AI Pose Quiz hoặc trang Đăng ký, nhấn **Quên mật khẩu?**
2. Nhập email tài khoản Supabase Auth của **MotionClass**.
3. Gửi qua `supabase.auth.resetPasswordForEmail(email, { redirectTo: 'https://giaovien-psi.vercel.app/forgot-password/' })`.
4. Mở liên kết email. Khi Supabase xác nhận phiên `PASSWORD_RECOVERY` (hoặc callback code/fragment hợp lệ), trang chuyển sang mẫu đặt mật khẩu mới. Đặt mật khẩu bằng `supabase.auth.updateUser({ password })`.
5. Xóa tham số/fragment mật trong URL, đăng xuất phiên khôi phục và đăng nhập lại bằng mật khẩu mới.

## Cấu hình bắt buộc trên Supabase
Dự án: **MotionClass** (không phải Giaipic).

Supabase Dashboard → Authentication → URL Configuration:
- **Site URL:** `https://giaovien-psi.vercel.app`
- **Redirect URLs:** phải chứa chính xác `https://giaovien-psi.vercel.app/forgot-password/` (ngoài các URL sẵn có, không xóa chúng).

Xem mẫu email khôi phục trong Authentication → Email Templates → Reset Password. Nếu đã thay template, bảo đảm link dùng `{{ .ConfirmationURL }}` hoặc thực hiện `verifyOtp(type:'recovery')` tương thích. Nếu không có URL cho phép, Supabase có thể đưa người dùng về Site URL thay vì trang đặt mật khẩu.

## Bảo mật và giới hạn
- Không gọi Auth Admin API. Không lộ khóa service role; dùng khóa công khai và Supabase-js.
- Không lưu mật khẩu mới trong Local Storage, database học sinh, hay analytics. Phiên reset phải hợp lệ mới hiển thị form; dấu token URL được xóa sau khi xử lý.
- Gửi lại email có giới hạn 60 giây ở giao diện. Supabase cũng tự áp dụng rate limit phía máy chủ.
- Không thay đổi bảng của Pose Quiz, Quản lý lớp hay Giaipic.

## Kiểm thử
- Python py_compile, JavaScript parse, URL routes 200.
- Chromium và WebKit giả lập iPhone: luồng gửi và gửi lại thư, bảo vệ cooldown, lỗi liên kết hết hạn, không cho tài khoản đăng nhập thường mở form reset, từ chối xác nhận mật khẩu không khớp, cập nhật mật khẩu bằng phiên recovery giả lập rồi đăng xuất. Các bài kiểm thử đã đạt.
- Cần thử email thật sau khi xác nhận URL trong Supabase Auth vì môi trường kiểm thử không dùng tài khoản giáo viên thật.
