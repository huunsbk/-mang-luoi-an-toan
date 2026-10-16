"""Giọng Microsoft NamMinh (vi-VN) cho MotionClass — tạo trước, lưu WAV, KHÔNG dùng lượt Google.

- Chỉ giáo viên có MARBLE_TTS_PIN mới gọi được (cùng mã với AI Studio), kiểm tra Origin như marble-tts.
- Mỗi đoạn được tạo riêng (không cần cắt WAV dài). Trình duyệt đổi MP3 → WAV, bỏ khoảng lặng, rồi lưu.
- Nhiều hồ sơ giọng (người đọc × chất giọng), mã cố định "edge:<hồ sơ>"; mặc định "edge:namminh-b1". Đổi thông số → đặt mã mới.
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

# Hồ sơ giọng = người đọc Microsoft (2 giọng tiếng Việt: NamMinh nam, HoaiMy nữ) × chất giọng.
# Mã hồ sơ cố định (edge:<id>); đổi thông số của một hồ sơ → đặt mã mới để WAV cũ không bị lẫn.
DEFAULT_PROFILE = "namminh-b1"
PROFILES = {
    # id: (giọng Microsoft, tốc độ %, cao độ Hz, hệ số biểu cảm, nhãn)
    "namminh-b1": ("vi-VN-NamMinhNeural", 6, 3, 1.0, "Nam · trẻ, tự tin"),
    "namminh-t1": ("vi-VN-NamMinhNeural", -3, -3, 0.8, "Nam · trầm ấm, chậm rãi"),
    "namminh-s1": ("vi-VN-NamMinhNeural", 12, 7, 1.3, "Nam · sôi nổi, hào hứng"),
    "hoaimy-d1": ("vi-VN-HoaiMyNeural", 0, 0, 0.9, "Nữ · dịu dàng, ấm áp"),
    "hoaimy-v1": ("vi-VN-HoaiMyNeural", 8, 6, 1.2, "Nữ · vui tươi, rõ ràng"),
}
# Sắc thái từng đoạn = độ lệch so với giọng nền (tốc độ %, cao độ Hz, âm lượng %), nhân hệ số biểu cảm.
# Với namminh-b1 cho đúng các giá trị đã dùng từ trước (neutral +6%/+3Hz, cheer +14%/+14Hz/+12%...).
STYLE_DELTAS = {
    "neutral":   (0, 0, 0),     # tên, câu hỏi, đáp án, câu gọi
    "cheer":     (8, 11, 12),   # "Chính xác!", "Tuyệt vời!"
    "praise":    (4, 8, 12),    # lời khen
    "congrats":  (2, 6, 8),     # "Chúc mừng em"
    "soft":      (-8, -5, 0),   # "Chưa chính xác rồi."
    "encourage": (-6, 2, 6),    # lời động viên
    "lively":    (2, 4, 8),     # mở đầu, chuỗi đúng, tổng kết
    "alert":     (4, 3, 10),    # còn 5 giây, hết giờ
}
STYLES = STYLE_DELTAS  # tên sắc thái hợp lệ


def _prosody(profile, style):
    voice, rate, pitch, k, _ = PROFILES[profile]
    dr, dp, dv = STYLE_DELTAS.get(style, STYLE_DELTAS["neutral"])
    r, p, v = round(rate + dr * k), round(pitch + dp * k), round(dv * k)
    return voice, "%+d%%" % r, "%+dHz" % p, "%+d%%" % max(-50, min(50, v))


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


async def _speak(text, style, profile=DEFAULT_PROFILE):
    import edge_tts  # nạp khi cần để không làm chậm các API khác
    voice, rate, pitch, volume = _prosody(profile, style)
    proxy = os.environ.get("EDGE_TTS_PROXY") or None  # chỉ dùng khi kiểm thử sau proxy; Vercel không đặt
    ca = os.environ.get("EDGE_TTS_CA_BUNDLE")
    if ca and os.path.exists(ca):
        import ssl
        import edge_tts.communicate as _c
        _c._SSL_CTX = ssl.create_default_context(cafile=ca)
    communicate = edge_tts.Communicate(text, voice, rate=rate, pitch=pitch, volume=volume, proxy=proxy)
    chunks = []
    async for part in communicate.stream():
        if part.get("type") == "audio" and part.get("data"):
            chunks.append(part["data"])
    audio = b"".join(chunks)
    if len(audio) < 200:
        raise RuntimeError("Microsoft chưa trả về âm thanh.")
    return audio


async def _speak_all(items, profile=DEFAULT_PROFILE):
    sem = asyncio.Semaphore(4)

    async def one(item):
        async with sem:
            for attempt in range(2):
                try:
                    return await asyncio.wait_for(_speak(item["text"], item["style"], profile), timeout=20)
                except Exception:
                    if attempt:
                        raise
                    await asyncio.sleep(0.6)
    return await asyncio.gather(*(one(i) for i in items), return_exceptions=True)


_probe = {"at": 0.0, "ok": None, "ms": None}


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        info = {"configured": _configured(), "voiceId": "edge:" + DEFAULT_PROFILE, "voice": PROFILES[DEFAULT_PROFILE][0],
                "profiles": [{"id": "edge:" + k, "voice": v[0], "label": v[4], "reader": "HoaiMy" if "HoaiMy" in v[0] else "NamMinh"}
                             for k, v in PROFILES.items()],
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
        voice_id = str(payload.get("voiceId") or "edge:" + DEFAULT_PROFILE)
        profile = voice_id[5:] if voice_id.startswith("edge:") else ""
        if profile not in PROFILES:
            return _json(self, 422, {"error": "Giọng đọc không hợp lệ."})
        if payload.get("verifyOnly") is True:
            return _json(self, 200, {"ok": True, "verified": True, "voiceId": voice_id})
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
            results = asyncio.run(_speak_all(items, profile))
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
        _json(self, 200, {"ok": True, "voiceId": voice_id, "items": out})
