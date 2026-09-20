import io
import json
import os
import re
import urllib.parse
import urllib.request
import uuid
from http.server import BaseHTTPRequestHandler

SUPABASE_URL = "https://ykckqcykxfhpfqptckxk.supabase.co"
API_KEY = "sb_publishable_2pfQHPjlGmtgOgGO0qaHXA_zGrwUZwT"
UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", re.I)
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

def rpc(name, payload, timeout=8):
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/rpc/{name}",
        data=data,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "apikey": API_KEY,
            "User-Agent": "mang-luoi-an-toan/2.2",
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read().decode("utf-8")
        return json.loads(raw) if raw else None

class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def _headers(self, content_type="application/json; charset=utf-8", status=200):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        self.end_headers()

    def _json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        self.end_headers()
        self.wfile.write(body)

    def _text(self, text, status=200, content_type="text/plain; charset=utf-8"):
        body = text.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        self.end_headers()
        self.wfile.write(body)

    def _body_json(self):
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if size < 1 or size > 20000:
                return {}
            return json.loads(self.rfile.read(size).decode("utf-8"))
        except Exception:
            return {}

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query = urllib.parse.parse_qs(parsed.query)

        if path in ("/", "/index.html"):
            try:
                with open(os.path.join(BASE_DIR, "index.html"), "rb") as f:
                    body = f.read()
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Cache-Control", "no-store")
                self.send_header("X-Content-Type-Options", "nosniff")
                self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
                self.end_headers()
                self.wfile.write(body)
            except Exception as e:
                self._json({"error": "Không tải được giao diện", "detail": str(e)[:160]}, 500)
            return

        if path == "/api/answers":
            room = (query.get("room") or [""])[0]
            if not UUID_RE.match(room):
                self._json({"error": "Mã phòng không hợp lệ"}, 400)
                return
            try:
                rows = rpc("safety_get_answers", {"p_room_id": room}) or []
                self._json({"ok": True, "answers": rows})
            except Exception as e:
                self._json({"error": "Không đọc được dữ liệu lớp học", "detail": str(e)[:180]}, 502)
            return

        if path == "/api/health":
            room = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
            person = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
            try:
                rpc("safety_submit_answer", {
                    "p_room_id": room,
                    "p_participant_id": person,
                    "p_name": "Health Check",
                    "p_answer": "Kết nối hệ thống hoạt động"
                })
                rows = rpc("safety_get_answers", {"p_room_id": room}) or []
                ok = any(
                    str(x.get("participant_id")) == person and
                    x.get("answer") == "Kết nối hệ thống hoạt động"
                    for x in rows
                )
                self._json({
                    "ok": ok,
                    "app": "mang-luoi-an-toan",
                    "version": "2.2.0",
                    "database": "ok" if ok else "mismatch"
                }, 200 if ok else 503)
            except Exception as e:
                self._json({
                    "ok": False,
                    "app": "mang-luoi-an-toan",
                    "version": "2.2.0",
                    "database": "error",
                    "error": str(e)[:200]
                }, 503)
            return

        if path == "/api/qr":
            text = (query.get("text") or [""])[0][:1200]
            if not text:
                self._text("Missing text", 400)
                return
            try:
                import qrcode
                import qrcode.image.svg
                factory = qrcode.image.svg.SvgPathImage
                img = qrcode.make(text, image_factory=factory, error_correction=qrcode.constants.ERROR_CORRECT_M, border=2)
                buff = io.BytesIO()
                img.save(buff)
                body = buff.getvalue()
                self.send_response(200)
                self.send_header("Content-Type", "image/svg+xml")
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(body)
            except Exception as e:
                self._json({"error": "Không tạo được QR", "detail": str(e)[:160]}, 500)
            return

        if path == "/favicon.ico":
            self.send_response(204)
            self.end_headers()
            return

        self._json({"error": "Not found"}, 404)

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path != "/api/submit":
            self._json({"error": "Not found"}, 404)
            return

        body = self._body_json()
        room = str(body.get("room", ""))
        participant = str(body.get("participant", ""))
        name = str(body.get("name", "")).strip()
        answer = str(body.get("answer", "")).strip()

        if not UUID_RE.match(room) or not UUID_RE.match(participant):
            self._json({"error": "Mã kết nối không hợp lệ"}, 400)
            return
        if not (1 <= len(name) <= 50):
            self._json({"error": "Tên phải có từ 1 đến 50 ký tự"}, 400)
            return
        if not (2 <= len(answer) <= 180):
            self._json({"error": "Câu trả lời phải có từ 2 đến 180 ký tự"}, 400)
            return

        try:
            rpc("safety_submit_answer", {
                "p_room_id": room,
                "p_participant_id": participant,
                "p_name": name,
                "p_answer": answer,
            })
            self._json({"ok": True})
        except Exception as e:
            self._json({"error": "Không gửi được câu trả lời", "detail": str(e)[:180]}, 502)
