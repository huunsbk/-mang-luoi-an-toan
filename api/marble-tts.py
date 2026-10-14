"""Server-side Google AI Studio TTS proxy for the Marble Race classroom game.

Required Vercel environment variables:
  GEMINI_API_KEY: Gemini API key; never exposed to client.
  MARBLE_TTS_PIN: A strong, private teacher access phrase (12+ characters).
Optional:
  GEMINI_VOICE_ID: A custom Voice Design id (voice_...) or preset name.
  GEMINI_TTS_MODEL: gemini-3.8-flash-tts or gemini-3.8-flash-lite-tts.
"""
import base64
import hmac
import hashlib
import json
import os
import time
from collections import defaultdict
from http.server import BaseHTTPRequestHandler
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions"
MODEL_ALLOWLIST = {"gemini-3.8-flash-tts", "gemini-3.8-flash-lite-tts"}
REQUEST_LIMIT = 200
_WINDOW = 3600
_hits = defaultdict(list)
STYLE = (
    "Read the provided Vietnamese transcript verbatim. Single male speaker, "
    "about 30 years old, standard Northern Vietnamese (Hanoi) accent, like "
    "an experienced Vietnamese schoolteacher: natural warm timbre, precise "
    "Vietnamese tones and consonants, clear academic diction, moderate "
    "teaching pace of 130 to 150 Vietnamese words per minute, warm but not "
    "theatrical. Pause naturally between the question and answers A, B, C, D. "
    "Do not add, omit, translate or rephrase any spoken words."
)

def _json(handler, status, payload, retry_after=None):
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Cache-Control", "no-store")
    if retry_after is not None:
        handler.send_header("Retry-After", str(retry_after))
    handler.send_header("X-Content-Type-Options", "nosniff")
    handler.send_header("Content-Length", str(len(data)))
    handler.end_headers()
    handler.wfile.write(data)

def _configured():
    pin = os.environ.get("MARBLE_TTS_PIN", "")
    return bool(os.environ.get("GEMINI_API_KEY")) and len(pin) >= 12

class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        voice = os.environ.get("GEMINI_VOICE_ID", "Charon")
        _json(self, 200, {
            "configured": _configured(),
            "voiceType": "custom" if voice.startswith("voice_") else "preset",
            "voiceVersion": hashlib.sha256(voice.encode("utf-8")).hexdigest()[:16],
            "needsTeacherCode": True
        })

    def do_POST(self):
        if not _configured():
            return _json(self, 503, {"error": "Gemini AI chưa được cấu hình trên Vercel. Đang sử dụng giọng thiết bị."})
        origin = self.headers.get("Origin", "")
        host = self.headers.get("X-Forwarded-Host") or self.headers.get("Host", "")
        if origin and origin not in ("https://" + host, "http://localhost:3000", "http://127.0.0.1:3000"):
            return _json(self, 403, {"error": "Nguồn yêu cầu không hợp lệ."})
        request_pin = self.headers.get("X-Marble-Teacher-Code", "")
        expected_pin = os.environ.get("MARBLE_TTS_PIN", "")
        if not hmac.compare_digest(request_pin.encode("utf-8"), expected_pin.encode("utf-8")):
            return _json(self, 403, {"error": "Mã truy cập giọng AI không đúng."})
        ip = (self.headers.get("X-Forwarded-For", "").split(",")[0].strip() or "unknown")[:90]
        now = time.monotonic()
        _hits[ip] = [t for t in _hits[ip] if now - t < _WINDOW]
        if len(_hits[ip]) >= REQUEST_LIMIT:
            return _json(self, 429, {"error": "Máy chủ đang giới hạn số lần tạo giọng AI. Hãy thử lại sau.", "code": "RATE_LIMIT"}, retry_after=3600)
        length = int(self.headers.get("Content-Length", "0") or 0)
        if length < 2 or length > 12000:
            return _json(self, 413, {"error": "Yêu cầu giọng đọc quá dài."})
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            text = payload.get("text", "")
            if not isinstance(text, str) or not 1 <= len(text.strip()) <= 1800:
                return _json(self, 422, {"error": "Nội dung đọc phải có từ 1 đến 1800 ký tự."})
        except (ValueError, UnicodeDecodeError, AttributeError):
            return _json(self, 400, {"error": "Dữ liệu không hợp lệ."})
        _hits[ip].append(now)
        model = os.environ.get("GEMINI_TTS_MODEL", "gemini-3.8-flash-tts")
        if model not in MODEL_ALLOWLIST:
            model = "gemini-3.8-flash-tts"
        voice = os.environ.get("GEMINI_VOICE_ID", "Charon").strip() or "Charon"
        body = {
            "model": model,
            "input": [{
                "type": "user_input",
                "content": [{
                    "type": "text", "text": text.strip(),
                    "annotations": [{"type": "speech_metadata", "style": STYLE}]
                }]
            }],
            "response_format": {"type": "audio"},
            "generation_config": {"speech_config": [{"voice": voice}]}
        }
        try:
            req = Request(
                ENDPOINT,
                data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
                headers={
                    "Content-Type": "application/json",
                    "x-goog-api-key": os.environ["GEMINI_API_KEY"]
                },
                method="POST"
            )
            with urlopen(req, timeout=24) as res:
                resp = json.loads(res.read(12000000).decode("utf-8"))
            audio_b64 = next(
                (part["data"] for step in reversed(resp.get("steps", []))
                 if step.get("type") == "model_output"
                 for part in reversed(step.get("content", []))
                 if part.get("type") == "audio" and part.get("data")),
                None
            )
            if not audio_b64:
                return _json(self, 502, {"error": "AI Studio chưa trả về âm thanh."})
            audio = base64.b64decode(audio_b64, validate=True)
            if not audio.startswith(b"RIFF") or len(audio) > 4 * 1024 * 1024:
                return _json(self, 502, {"error": "Định dạng hoặc kích thước âm thanh không được hỗ trợ."})
            self.send_response(200)
            self.send_header("Content-Type", "audio/wav")
            self.send_header("Content-Length", str(len(audio)))
            self.send_header("Cache-Control", "private, no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(audio)
        except (HTTPError, URLError, TimeoutError, OSError, ValueError, KeyError) as exc:
            if isinstance(exc, HTTPError) and exc.code == 429:
                # Google API quota and request/minute caps are different; do not
                # automatically flood the API again on receiving HTTP 429.
                raw_wait = exc.headers.get("Retry-After", "") if exc.headers else ""
                try:
                    delay = min(900, max(60, int(raw_wait)))
                except (ValueError, TypeError):
                    delay = 60
                return _json(self, 429, {
                    "code": "RATE_LIMIT",
                    "error": "Gemini đang giới hạn lượt tạo giọng AI (429). Có thể đã hết hạn mức hoặc gửi yêu cầu quá nhanh. Hãy kiểm tra hạn mức Google AI Studio."
                }, retry_after=delay)
            return _json(self, 502, {
                "code": "UPSTREAM_ERROR",
                "error": "Gemini chưa tạo được âm thanh. Phần mềm sẽ dùng giọng thiết bị."
            })
