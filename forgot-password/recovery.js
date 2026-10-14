/* Password recovery for all apps sharing the MotionClass Supabase Auth project. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const cfg = window.POSE_QUIZ_SUPABASE;
  const returnURL = location.origin + '/forgot-password/';
  const params = new URLSearchParams(location.search);
  const fragment = new URLSearchParams(location.hash.replace(/^#/, ''));
  const hasRecoveryLink = fragment.get('type') === 'recovery' || params.get('type') === 'recovery' ||
    params.has('code') || fragment.has('access_token') && fragment.get('type') === 'recovery';
  const redirectError = params.get('error_description') || fragment.get('error_description') ||
    params.get('error') || fragment.get('error');
  let client = null, working = false, recovered = false, email = '', lastSent = 0;
  const MIN_GAP = 60 * 1000;

  function view(which) {
    for (const name of ['request', 'sent', 'reset', 'done', 'error'])
      $(name + 'Panel').hidden = name !== which;
  }
  function notice(value, level = '') {
    const el = $('recoveryStatus');
    el.textContent = value;
    el.classList.toggle('error', level === 'error');
    el.classList.toggle('success', level === 'success');
  }
  function formatError(error) {
    const raw = String(error?.message || error || 'Có lỗi xác thực.').slice(0,300);
    if (/rate limit|too many requests|email.*rate/i.test(raw))
      return 'Đã gửi quá nhiều yêu cầu. Vui lòng chờ rồi thử lại.';
    if (/expired|invalid.*token|token.*invalid|otp.*expired/i.test(raw))
      return 'Liên kết không còn hợp lệ hoặc đã hết hạn. Hãy yêu cầu một liên kết mới.';
    if (/weak password|password.*short|at least/i.test(raw))
      return 'Mật khẩu chưa đáp ứng yêu cầu bảo mật của MotionClass.';
    return raw;
  }
  function toggleVisibility(inputId, buttonId) {
    $(buttonId).onclick = () => {
      const input = $(inputId), exposed = input.type === 'password';
      input.type = exposed ? 'text' : 'password';
      $(buttonId).textContent = exposed ? 'Ẩn' : 'Hiện';
      $(buttonId).setAttribute('aria-label', exposed ? 'Ẩn mật khẩu' : 'Hiện mật khẩu');
    };
  }
  function scrubURL() {
    // Remove one-use tokens and authorization codes from address bar after Supabase processes the callback.
    if (location.search || location.hash) history.replaceState(null, document.title, '/forgot-password/');
  }
  function canReset(session) {
    if (!session?.user) return false;
    recovered = true;
    view('reset');
    notice('✅ Liên kết khôi phục hợp lệ. Hãy nhập mật khẩu mới.', 'success');
    scrubURL();
    return true;
  }
  async function sendMail(isResend = false) {
    if (working) return;
    const addr = (isResend ? email : $('recoverEmail').value).trim().toLowerCase();
    if (!addr) { notice('Hãy nhập email đăng ký MotionClass.', 'error'); return; }
    const now = Date.now();
    if (now - lastSent < MIN_GAP) {
      notice('Vui lòng chờ ít nhất 60 giây trước khi yêu cầu gửi lại.', 'error');
      return;
    }
    working = true;
    $('requestButton').disabled = true;
    $('resendButton').disabled = true;
    notice('⏳ Đang yêu cầu email đặt lại mật khẩu…');
    try {
      const { error } = await client.auth.resetPasswordForEmail(addr, { redirectTo: returnURL });
      if (error) throw error;
      lastSent = Date.now();
      email = addr;
      $('sentInfo').textContent = 'Nếu ' + addr + ' có tài khoản, hệ thống sẽ gửi liên kết đặt lại mật khẩu. Hãy kiểm tra cả thư rác (Spam).';
      view('sent');
      notice('✅ Yêu cầu đã được gửi. Hãy kiểm tra email để hoàn tất bước xác minh.', 'success');
    } catch (e) {
      notice('⚠ ' + formatError(e), 'error');
    } finally {
      working = false;
      $('requestButton').disabled = false;
      $('resendButton').disabled = false;
    }
  }
  function validatePassword(password, confirm) {
    if (password.length < 8 || password.length > 128 || !/[A-Za-zÀ-ỹ]/.test(password) || !/[0-9]/.test(password))
      return 'Mật khẩu mới phải có ít nhất 8 ký tự, gồm chữ và số.';
    if (password !== confirm) return 'Hai lần nhập mật khẩu mới chưa trùng khớp.';
    return '';
  }
  async function savePassword(e) {
    e.preventDefault();
    if (working) return;
    if (!recovered) {
      view('error');
      notice('Chưa xác minh liên kết khôi phục. Hãy yêu cầu email mới.', 'error');
      return;
    }
    const password = $('newPassword').value;
    const reason = validatePassword(password, $('confirmPassword').value);
    if (reason) { notice('⚠ ' + reason, 'error'); return; }
    working = true;
    $('resetButton').disabled = true;
    notice('⏳ Đang cập nhật mật khẩu MotionClass…');
    try {
      const { data: sessionData, error: sessionError } = await client.auth.getSession();
      if (sessionError || !sessionData.session?.user) throw Error('Phiên xác thực đã hết hạn. Hãy mở lại liên kết từ email.');
      const { error } = await client.auth.updateUser({ password });
      if (error) throw error;
      recovered = false;
      $('newPassword').value = '';
      $('confirmPassword').value = '';
      try { await client.auth.signOut(); } catch (_) { /* Password was already updated. */ }
      scrubURL();
      view('done');
      notice('✅ Mật khẩu đã đổi thành công. Hãy đăng nhập lại trên các ứng dụng.', 'success');
    } catch (error) {
      notice('⚠ ' + formatError(error), 'error');
    } finally {
      working = false;
      $('resetButton').disabled = false;
    }
  }
  async function start() {
    $('requestForm').onsubmit = e => { e.preventDefault(); void sendMail(false); };
    $('resendButton').onclick = () => { void sendMail(true); };
    $('changeEmail').onclick = () => { view('request'); notice('Nhập email khác để nhận liên kết khôi phục.'); };
    $('restartButton').onclick = () => { view('request'); notice('Nhập email đăng ký để yêu cầu một liên kết mới.'); };
    $('resetForm').onsubmit = savePassword;
    toggleVisibility('newPassword', 'showNewPassword');
    toggleVisibility('confirmPassword', 'showConfirmPassword');
    if (!cfg?.url || !cfg?.publishableKey || !window.supabase?.createClient) {
      notice('Không tải được cấu hình MotionClass. Vui lòng kiểm tra kết nối Internet.', 'error');
      $('requestButton').disabled = true;
      return;
    }
    if (redirectError) {
      view('error');
      notice('⚠ Liên kết khôi phục bị từ chối: ' + formatError(decodeURIComponent(redirectError.replace(/\+/g, ' '))), 'error');
      scrubURL();
      return;
    }
    client = window.supabase.createClient(cfg.url, cfg.publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    // Do not show reset UI just because a user is already logged in. Require the recovery link/event.
    client.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') canReset(session);
    });
    try {
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      if (hasRecoveryLink) {
        if (!canReset(data.session)) {
          view('error');
          notice('⚠ Liên kết không hợp lệ hoặc đã hết hạn. Vui lòng yêu cầu liên kết mới.', 'error');
          scrubURL();
        }
      }
    } catch (e) {
      if (hasRecoveryLink) {
        view('error'); scrubURL();
      }
      notice('⚠ ' + formatError(e), 'error');
    }
  }
  void start();
})();