"""Giọng Microsoft NamMinh (vi-VN) cho MotionClass — tạo trước, lưu WAV, KHÔNG dùng lượt Google.

- Chỉ giáo viên có MARBLE_TTS_PIN mới gọi được (cùng mã với AI Studio), kiểm tra Origin như marble-tts.
- Mỗi đoạn được tạo riêng (không cần cắt WAV dài). Trình duyệt đổi MP3 → WAV, bỏ khoảng lặng, rồi lưu.
- Mã giọng cố định "edge:namminh-b1" = NamMinh + bộ ngữ điệu dưới đây. Đổi bộ ngữ điệu → tăng phiên bản.
- Dịch vụ đọc của Microsoft Edge là dịch vụ không chính thức; phần mềm chỉ dùng khi tạo trước,
  giờ học chỉ phát WAV đã lưu.
"""
import asyncio
import base64
import hmac
import json
import os
import time
from collections import defaultdict
from http.server import BaseHTTPRequestHandler

VOICE_ID = "edge:namminh-b1"
EDGE_VOICE = "vi-VN-NamMinhNeural"
# Giọng B (trẻ, tự tin) làm nền; phần nhận xét lên xuống có cảm xúc hơn.
STYLES = {
    "neutral":   ("+6%", "+3Hz", "+0%"),    # tên, câu hỏi, đáp án, câu gọi
    "cheer":     ("+14%", "+14Hz", "+12%"), # "Chính xác!", "Tuyệt vời!"
    "praise":    ("+10%", "+11Hz", "+12%"), # lời khen
    "congrats":  ("+8%", "+9Hz", "+8%"),    # "Chúc mừng em"
    "soft":      ("-2%", "-2Hz", "+0%"),    # "Chưa chính xác rồi."
    "encourage": ("+0%", "+5Hz", "+6%"),    # lời động viên
    "lively":    ("+8%", "+7Hz", "+8%"),    # mở đầu, chuỗi đúng, tổng kết
    "alert":     ("+10%", "+6Hz", "+10%"),  # còn 5 giây, hết giờ
}
MAX_ITEMS = 12
MAX_TEXT = 1200
MAX_TOTAL = 4000
REQUEST_LIMIT = 400
_WINDOW = 3600
_hits = defaultdict(list)


def _json(handler, status, payload):
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("X-Content-Type-Options", "nosniff")
    handler.end_headers()
    handler.wfile.write(body)


def _configured():
    return len(os.environ.get("MARBLE_TTS_PIN", "")) >= 12


async def _speak(text, style):
    import edge_tts  # nạp khi cần để không làm chậm các API khác
    rate, pitch, volume = STYLES.get(style, STYLES["neutral"])
    proxy = os.environ.get("EDGE_TTS_PROXY") or None  # chỉ dùng khi kiểm thử sau proxy; Vercel không đặt
    ca = os.environ.get("EDGE_TTS_CA_BUNDLE")
    if ca and os.path.exists(ca):
        import ssl
        import edge_tts.communicate as _c
        _c._SSL_CTX = ssl.create_default_context(cafile=ca)
    communicate = edge_tts.Communicate(text, EDGE_VOICE, rate=rate, pitch=pitch, volume=volume, proxy=proxy)
    chunks = []
    async for part in communicate.stream():
        if part.get("type") == "audio" and part.get("data"):
            chunks.append(part["data"])
    audio = b"".join(chunks)
    if len(audio) < 200:
        raise RuntimeError("Microsoft chưa trả về âm thanh.")
    return audio


async def _speak_all(items):
    sem = asyncio.Semaphore(4)

    async def one(item):
        async with sem:
            for attempt in range(2):
                try:
                    return await asyncio.wait_for(_speak(item["text"], item["style"]), timeout=20)
                except Exception:
                    if attempt:
                        raise
                    await asyncio.sleep(0.6)
    return await asyncio.gather(*(one(i) for i in items), return_exceptions=True)


_probe = {"at": 0.0, "ok": None, "ms": None}


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        info = {"configured": _configured(), "voiceId": VOICE_ID, "voice": EDGE_VOICE,
                "styles": sorted(STYLES), "needsTeacherCode": True, "maxItems": MAX_ITEMS}
        if "probe=1" in (self.path or ""):
            # Tự kiểm tra máy chủ → Microsoft bằng một câu cố định; chỉ trả trạng thái, lưu đệm 10 phút.
            now = time.monotonic()
            if _probe["ok"] is None or now - _probe["at"] > 600:
                start = time.monotonic()
                try:
                    asyncio.run(asyncio.wait_for(_speak("Xin chào.", "neutral"), timeout=15))
                    _probe.update(ok=True)
                except Exception:
                    _probe.update(ok=False)
                _probe.update(at=now, ms=int((time.monotonic() - start) * 1000))
            info["upstream"] = {"ok": _probe["ok"], "ms": _probe["ms"]}
        _json(self, 200, info)

    def do_POST(self):
        if not _configured():
            return _json(self, 503, {"error": "Chưa cấu hình mã giáo viên (MARBLE_TTS_PIN) trên Vercel."})
        origin = self.headers.get("Origin", "")
        host = self.headers.get("X-Forwarded-Host") or self.headers.get("Host", "")
        allowed = {"https://" + host, "https://giaovien-psi.vercel.app", "http://localhost:3000", "http://127.0.0.1:3000"}
        if host.split(":")[0] in ("127.0.0.1", "localhost"):
            allowed.add("http://" + host)  # chỉ khi chạy thử ngay trên máy cục bộ
        if origin and origin not in allowed:
            return _json(self, 403, {"code": "INVALID_ORIGIN", "error": "Nguồn yêu cầu không hợp lệ. Hãy mở đúng trang giaovien-psi.vercel.app."})
        pin = self.headers.get("X-Marble-Teacher-Code", "")
        if not hmac.compare_digest(pin.encode("utf-8"), os.environ.get("MARBLE_TTS_PIN", "").encode("utf-8")):
            return _json(self, 403, {"code": "INVALID_TEACHER_CODE", "error": "Mã giáo viên không đúng (MARBLE_TTS_PIN, không phải khóa Gemini API)."})
        ip = (self.headers.get("X-Forwarded-For", "").split(",")[0].strip() or "unknown")[:90]
        now = time.monotonic()
        _hits[ip] = [t for t in _hits[ip] if now - t < _WINDOW]
        if len(_hits[ip]) >= REQUEST_LIMIT:
            return _json(self, 429, {"code": "RATE_LIMIT", "error": "Đã tạo quá nhiều trong một giờ. Hãy thử lại sau."})
        length = int(self.headers.get("Content-Length", "0") or 0)
        if length < 2 or length > 40000:
            return _json(self, 413, {"error": "Yêu cầu quá dài."})
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return _json(self, 400, {"error": "Dữ liệu không hợp lệ."})
        if payload.get("verifyOnly") is True:
            return _json(self, 200, {"ok": True, "verified": True, "voiceId": VOICE_ID})
        raw = payload.get("items")
        if not isinstance(raw, list) or not 1 <= len(raw) <= MAX_ITEMS:
            return _json(self, 422, {"error": "Mỗi lần tạo từ 1 đến %d đoạn." % MAX_ITEMS})
        items, total = [], 0
        for it in raw:
            text = " ".join(str((it or {}).get("text", "")).split())
            style = str((it or {}).get("style", "neutral"))
            if not 1 <= len(text) <= MAX_TEXT or style not in STYLES:
                return _json(self, 422, {"error": "Đoạn đọc phải từ 1 đến %d ký tự và có sắc thái hợp lệ." % MAX_TEXT})
            total += len(text)
            items.append({"text": text, "style": style})
        if total > MAX_TOTAL:
            return _json(self, 413, {"error": "Tổng nội dung một lần tối đa %d ký tự." % MAX_TOTAL})
        _hits[ip].append(now)
        try:
            results = asyncio.run(_speak_all(items))
        except Exception:
            return _json(self, 502, {"code": "UPSTREAM_ERROR", "error": "Dịch vụ giọng Microsoft tạm thời không phản hồi. Hãy thử lại sau ít phút."})
        out = []
        for r in results:
            if isinstance(r, Exception):
                out.append({"ok": False, "error": "Không tạo được đoạn này."})
            else:
                out.append({"ok": True, "mime": "audio/mpeg", "audio": base64.b64encode(r).decode("ascii")})
        if not any(o["ok"] for o in out):
            return _json(self, 502, {"code": "UPSTREAM_ERROR", "error": "Dịch vụ giọng Microsoft tạm thời không phản hồi. Hãy thử lại sau ít phút."})
        _json(self, 200, {"ok": True, "voiceId": VOICE_ID, "items": out})
