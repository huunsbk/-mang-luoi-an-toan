import io
import json
import os
import re
import urllib.parse
import urllib.request
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
        headers={"Content-Type":"application/json","apikey":API_KEY,"User-Agent":"mang-luoi-an-toan/3.0"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read().decode("utf-8")
        return json.loads(raw) if raw else None

class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def _json(self, obj, status=200):
        body=json.dumps(obj,ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type","application/json; charset=utf-8")
        self.send_header("Content-Length",str(len(body)))
        self.send_header("Cache-Control","no-store")
        self.send_header("X-Content-Type-Options","nosniff")
        self.send_header("Referrer-Policy","strict-origin-when-cross-origin")
        self.end_headers()
        self.wfile.write(body)

    def _body_json(self):
        try:
            size=int(self.headers.get("Content-Length","0"))
            if size<1 or size>20000:return {}
            return json.loads(self.rfile.read(size).decode("utf-8"))
        except Exception:return {}

    def _get_json_url(self,url,timeout=8):
        req=urllib.request.Request(url,headers={"User-Agent":"mang-luoi-an-toan-health/3.0"})
        with urllib.request.urlopen(req,timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8") or "{}")

    def _post_json_url(self,url,payload,timeout=8):
        req=urllib.request.Request(url,data=json.dumps(payload,ensure_ascii=False).encode("utf-8"),method="POST",headers={"Content-Type":"application/json","User-Agent":"mang-luoi-an-toan-health/3.0"})
        with urllib.request.urlopen(req,timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8") or "{}")

    def do_GET(self):
        parsed=urllib.parse.urlparse(self.path)
        path=parsed.path
        query=urllib.parse.parse_qs(parsed.query)

        if path in ("/","/index.html"):
            try:
                with open(os.path.join(BASE_DIR,"index.html"),"rb") as f: body=f.read()
                self.send_response(200);self.send_header("Content-Type","text/html; charset=utf-8");self.send_header("Content-Length",str(len(body)));self.send_header("Cache-Control","no-store");self.end_headers();self.wfile.write(body)
            except Exception as e:self._json({"error":"Không tải được giao diện","detail":str(e)[:160]},500)
            return

        if path=="/api/room":
            room=(query.get("room") or [""])[0]
            if not UUID_RE.match(room):return self._json({"error":"Mã phòng không hợp lệ"},400)
            try:
                rows=rpc("safety_get_room",{"p_room_id":room}) or []
                if not rows:return self._json({"error":"Phòng không tồn tại hoặc đã hết hạn"},404)
                row=rows[0]
                return self._json({"ok":True,"room":{"room_id":row.get("room_id"),"question":row.get("question"),"created_at":row.get("created_at"),"updated_at":row.get("updated_at")}})
            except Exception as e:return self._json({"error":"Không đọc được thông tin phòng","detail":str(e)[:180]},502)

        if path=="/api/answers":
            room=(query.get("room") or [""])[0]
            if not UUID_RE.match(room):return self._json({"error":"Mã phòng không hợp lệ"},400)
            try:return self._json({"ok":True,"answers":rpc("safety_get_answers",{"p_room_id":room}) or []})
            except Exception as e:return self._json({"error":"Không đọc được dữ liệu lớp học","detail":str(e)[:180]},502)

        if path=="/api/health":
            room="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
            token="cccccccc-cccc-4ccc-8ccc-cccccccccccc"
            person="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
            question="Theo thầy cô, điều gì giúp trẻ em an toàn hơn?"
            answer="Lắng nghe và tôn trọng trẻ em"
            base="https://mang-luoi-an-toan.vercel.app"
            try:
                set_room=self._post_json_url(base+"/api/room",{"room":room,"host_token":token,"question":question})
                room_data=self._get_json_url(base+"/api/room?room="+room)
                submit=self._post_json_url(base+"/api/submit",{"room":room,"participant":person,"name":"Health Check","answer":answer})
                answers=self._get_json_url(base+"/api/answers?room="+room)
                qr_req=urllib.request.Request(base+"/api/qr?text="+urllib.parse.quote(base+"/?room="+room,safe=""),headers={"User-Agent":"mang-luoi-an-toan-health/3.0"})
                with urllib.request.urlopen(qr_req,timeout=8) as r:qr_body=r.read(250).decode("utf-8",errors="ignore")
                room_ok=bool(set_room.get("ok")) and room_data.get("room",{}).get("question")==question
                submit_ok=bool(submit.get("ok"))
                read_ok=any(str(x.get("participant_id"))==person and x.get("answer")==answer for x in (answers.get("answers") or []))
                qr_ok="<svg" in qr_body or "<?xml" in qr_body
                ok=room_ok and submit_ok and read_ok and qr_ok
                return self._json({"ok":ok,"app":"mang-luoi-an-toan","version":"3.0.0","room_question":"ok" if room_ok else "fail","submit":"ok" if submit_ok else "fail","read":"ok" if read_ok else "fail","qr":"ok" if qr_ok else "fail"},200 if ok else 503)
            except Exception as e:return self._json({"ok":False,"app":"mang-luoi-an-toan","version":"3.0.0","error":str(e)[:220]},503)

        if path=="/api/qr":
            text=(query.get("text") or [""])[0][:1200]
            if not text:return self._json({"error":"Thiếu nội dung QR"},400)
            try:
                import qrcode, qrcode.image.svg
                img=qrcode.make(text,image_factory=qrcode.image.svg.SvgPathImage,error_correction=qrcode.constants.ERROR_CORRECT_M,border=2)
                buff=io.BytesIO();img.save(buff);body=buff.getvalue()
                self.send_response(200);self.send_header("Content-Type","image/svg+xml");self.send_header("Content-Length",str(len(body)));self.send_header("Cache-Control","no-store");self.end_headers();self.wfile.write(body)
            except Exception as e:self._json({"error":"Không tạo được QR","detail":str(e)[:160]},500)
            return

        if path=="/favicon.ico":
            self.send_response(204);self.end_headers();return
        self._json({"error":"Not found"},404)

    def do_POST(self):
        parsed=urllib.parse.urlparse(self.path)
        body=self._body_json()

        if parsed.path=="/api/room":
            room=str(body.get("room",""));token=str(body.get("host_token",""));question=str(body.get("question","")).strip()
            if not UUID_RE.match(room) or not UUID_RE.match(token):return self._json({"error":"Mã phòng hoặc mã điều hành không hợp lệ"},400)
            if not (5<=len(question)<=300):return self._json({"error":"Câu hỏi phải có từ 5 đến 300 ký tự"},400)
            try:
                rpc("safety_set_room",{"p_room_id":room,"p_host_token":token,"p_question":question})
                return self._json({"ok":True})
            except Exception as e:return self._json({"error":"Không lưu được câu hỏi","detail":str(e)[:180]},502)

        if parsed.path=="/api/submit":
            room=str(body.get("room",""));participant=str(body.get("participant",""));name=str(body.get("name","")).strip();answer=str(body.get("answer","")).strip()
            if not UUID_RE.match(room) or not UUID_RE.match(participant):return self._json({"error":"Mã kết nối không hợp lệ"},400)
            if not (1<=len(name)<=50):return self._json({"error":"Tên phải có từ 1 đến 50 ký tự"},400)
            if not (2<=len(answer)<=180):return self._json({"error":"Câu trả lời phải có từ 2 đến 180 ký tự"},400)
            try:
                rpc("safety_submit_answer",{"p_room_id":room,"p_participant_id":participant,"p_name":name,"p_answer":answer})
                return self._json({"ok":True})
            except Exception as e:return self._json({"error":"Không gửi được câu trả lời","detail":str(e)[:180]},502)

        self._json({"error":"Not found"},404)
