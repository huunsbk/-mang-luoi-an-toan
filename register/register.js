/* Teacher signup through the existing MotionClass Supabase Auth project.
 * Uses only its publishable key. No server role and no password storage. */
(function(){
'use strict';
const $=id=>document.getElementById(id);
const cfg=window.POSE_QUIZ_SUPABASE;
let client=null,submitting=false,registeredEmail='',lastResendAt=0;
const redirectUrl=window.location.origin+'/register/';
function message(value,type='info'){
 const el=$('authStatus');el.textContent=value;el.classList.toggle('error',type==='error');el.classList.toggle('success',type==='success');
}
function show(which){
 $('registerArea').hidden=which!=='register';
 $('registeredArea').hidden=which!=='confirm';
 $('activeArea').hidden=which!=='active';
}
function issue(error){
 const msg=String(error?.message||error||'Không xác thực được tài khoản.');
 if(/already registered|already exists|user already/i.test(msg))return 'Email này có thể đã được đăng ký. Hãy dùng trang đăng nhập hoặc khôi phục mật khẩu.';
 if(/rate limit|too many requests|over_email_send_rate_limit/i.test(msg))return 'Hệ thống giới hạn số lượt gửi thư. Vui lòng thử lại sau.';
 if(/password.*weak|password.*short|password.*at least/i.test(msg))return 'Mật khẩu chưa đáp ứng yêu cầu bảo mật. Hãy chọn mật khẩu mạnh hơn.';
 if(/email.*invalid|invalid.*email/i.test(msg))return 'Email không hợp lệ. Hãy kiểm tra lại địa chỉ email.';
 return msg.slice(0,320);
}
async function signup(event){
 event.preventDefault();
 if(submitting)return;
 const name=$('teacherName').value.trim().replace(/\s+/g,' ');
 const email=$('teacherEmail').value.trim().toLowerCase();
 const password=$('teacherPassword').value;
 const confirm=$('confirmPassword').value;
 if(name.length<2||name.length>100){message('Họ tên cần từ 2 đến 100 ký tự.','error');return}
 if(password.length<8||password.length>128||!/[a-zA-ZÀ-ỹ]/.test(password)||!/[0-9]/.test(password)){
  message('Mật khẩu phải có ít nhất 8 ký tự, gồm cả chữ và số.','error');return
 }
 if(password!==confirm){message('Hai lần nhập mật khẩu chưa trùng khớp.','error');return}
 submitting=true;
 const button=$('registerButton');button.disabled=true;
 message('⏳ Đang tạo tài khoản giáo viên trên MotionClass...');
 try{
  const {data,error}=await client.auth.signUp({email,password,options:{emailRedirectTo:redirectUrl,data:{full_name:name}}});
  if(error)throw error;
  registeredEmail=email;
  $('teacherPassword').value='';$('confirmPassword').value='';
  if(data?.session?.user){
   $('activeDetail').textContent='Tài khoản '+email+' đã được tạo và đăng nhập thành công.';
   show('active');message('✅ Đã đăng ký và đăng nhập. Bạn có thể vào trang quản trị ngay.','success');
  }else{
   // Supabase may deliberately hide whether this email already existed.
   show('confirm');$('successHeading').textContent='📩 Kiểm tra hộp thư email';
   $('successDetail').textContent='Nếu địa chỉ '+email+' có thể đăng ký, hệ thống sẽ gửi liên kết xác nhận. Nhấn liên kết trong email rồi quay lại trang này để đăng nhập.';
   message('Đã gửi yêu cầu đăng ký. Hãy kiểm tra email để hoàn tất xác thực nếu có thư xác nhận.','success');
  }
 }catch(error){message('⚠ '+issue(error),'error')}
 finally{submitting=false;button.disabled=false}
}
async function resend(){
 if(submitting)return;
 const email=registeredEmail||$('teacherEmail').value.trim().toLowerCase();
 if(!email){message('Hãy điền email rồi thực hiện đăng ký trước.','error');return}
 if(Date.now()-lastResendAt<60000){message('Để tránh gửi nhiều thư, vui lòng chờ ít nhất 60 giây giữa các lần gửi.','error');return}
 lastResendAt=Date.now();
 const btn=$('resendButton');btn.disabled=true;
 message('⏳ Đang yêu cầu gửi lại email xác nhận...');
 try{
  const {error}=await client.auth.resend({type:'signup',email,options:{emailRedirectTo:redirectUrl}});
  if(error)throw error;
  message('✅ Đã gửi yêu cầu gửi lại email. Kiểm tra hộp thư và thư rác.','success');
 }catch(error){message('⚠ '+issue(error),'error')}
 finally{setTimeout(()=>{btn.disabled=false},60000)}
}
function setupReveal(id,buttonId){
 const field=$(id),btn=$(buttonId);
 btn.onclick=()=>{
  const visible=field.type==='password';
  field.type=visible?'text':'password';
  btn.textContent=visible?'Ẩn':'Hiện';btn.setAttribute('aria-pressed',String(visible));
  btn.setAttribute('aria-label',visible?'Ẩn mật khẩu':'Hiện mật khẩu');
 };
}
async function bootstrap(){
 if(!cfg?.url||!cfg?.publishableKey||!window.supabase?.createClient){
  message('Không tải được kết nối tài khoản MotionClass. Kiểm tra Internet và tải lại trang.','error');$('registerButton').disabled=true;return
 }
 client=window.supabase.createClient(cfg.url,cfg.publishableKey,{
  auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
 });
 $('registerForm').onsubmit=signup;
 $('resendButton').onclick=resend;
 setupReveal('teacherPassword','showPassword');setupReveal('confirmPassword','showConfirm');
 client.auth.onAuthStateChange((event,session)=>{
  if(session?.user&&['SIGNED_IN','INITIAL_SESSION','TOKEN_REFRESHED','USER_UPDATED'].includes(event)){
   $('activeDetail').textContent='Đã đăng nhập MotionClass: '+(session.user.email||'tài khoản giáo viên')+'.';
   show('active');message('✅ Email đã được xác nhận hoặc tài khoản đã đăng nhập. Bạn có thể vào ngân hàng câu hỏi.','success');
  }
 });
 const {data,error}=await client.auth.getSession();
 if(error){message('Không đọc được phiên đăng nhập: '+issue(error),'error');return}
 if(data?.session?.user){
  $('activeDetail').textContent='Đã đăng nhập MotionClass: '+(data.session.user.email||'tài khoản giáo viên')+'.';
  show('active');message('✅ Tài khoản đã đăng nhập. Bạn có thể vào ngân hàng câu hỏi.','success');
 }
}
bootstrap().catch(error=>message('⚠ '+issue(error),'error'));
})();