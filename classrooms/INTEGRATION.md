# Quản lý lớp học tập trung (MotionClass)

**Địa chỉ quản lý:** https://giaovien-psi.vercel.app/classrooms/

**Địa chỉ Đua bi:** https://giaovien-psi.vercel.app/marble-race/

## Kiến trúc dữ liệu dùng chung

- Dự án Supabase **MotionClass**, tách biệt hoàn toàn **Giaipic**.
- Bảng `public.teacher_classrooms`: lớp (`id,owner_id,name,grade,school_year`).
- Bảng `public.teacher_classroom_students`: học sinh (`id,class_id,owner_id,full_name,student_code,avatar_index,orb_color,orb_style,photo_path,sort_order,is_active`).
- Storage bucket **`teacher-student-photos`** (private, upload tối đa 2 MB): ảnh 320 × 320 JPEG, chỉ chủ tài khoản được xem/upload/xóa. Đường dẫn ảnh có tiền tố UUID của giáo viên, lớp và học sinh.
- Hai bảng và storage đều có RLS riêng; giáo viên chỉ thao tác được trên lớp và học sinh của chính mình.

## Tích hợp trò chơi tiếp theo

Nạp scripts đã có trên cùng domain:

```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script src="/pose-quiz/supabase-config.js"></script>
<script src="/classrooms/classroom-store.js"></script>
```

Gọi:

```js
const store=window.TeacherClassroomStore;
const client=store.createClient();
const classes=await store.listClasses(client);
const students=await store.listStudents(client,classes[0].id);
for(const student of students) {
  console.log(student.id,student.name,student.photoUrl,student.avatar,student.color,student.style);
}
```

**Chú ý:** `listStudents` chỉ trả về học sinh nếu tài khoản hiện tại có quyền; `photoUrl` là signed URL tạm thời (1 giờ), không lưu vào database hoặc gửi công khai. Hãy nạp lại ảnh khi cần. Mã `student.id` là UUID ổn định để thống kê kết quả qua các trò chơi. Dữ liệu lớp được cập nhật tại trang Quản lý lớp học, không tạo bản sao danh sách riêng cho từng trò chơi.

### Đường đua bi
Chọn lớp → nhấn "Nạp lớp và viên bi" → các dữ liệu `id,name,avatar,color,style,photoUrl` được áp dụng vào cả hai chế độ "Chọn học sinh" và "Học tập". Sau khi tải lại trang, phần mềm đồng bộ lại lớp đã chọn nếu giáo viên vẫn đăng nhập. Không tự gửi ảnh học sinh lên Google AI. Chức năng nhập danh sách thủ công vẫn hoạt động nhưng là một chế độ riêng; thay ảnh hoặc màu bi của lớp đám mây ở trang Quản lý lớp học.

### Kiểm thử và giới hạn
- Kiểm thử Chromium/WebKit giả lập iPhone: tạo lớp, thêm học sinh, lưu màu và kiểu bi, chọn lớp trong Đua bi, giữ liên kết sau reload, không lỗi JS.
- Kiểm thử thực tế pipeline ảnh trên Chromium: cắt/nén JPEG 320 × 320, lưu path riêng theo người dùng/lớp/học sinh.
- Supabase: xác nhận ẩn bảng đối với role anon (401), chính sách RLS chủ sở hữu và kho ảnh riêng tư; dữ liệu Pose Quiz 19 câu hỏi không bị tác động.
- Chưa có phiên đăng nhập thật của giáo viên để kiểm thử trực tiếp ghi dữ liệu, upload ảnh và quyền sở hữu trên môi trường Production; cần xác nhận sau khi đăng nhập tài khoản giáo viên.
