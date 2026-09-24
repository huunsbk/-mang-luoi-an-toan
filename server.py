import io
import json
import os
import re
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler

SUPABASE_URL="https://ykckqcykxfhpfqptckxk.supabase.co"
API_KEY="sb_publishable_2pfQHPjlGmtgOgGO0qaHXA_zGrwUZwT"
UUID_RE=re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",re.I)
BASE_DIR=os.path.dirname(os.path.abspath(__file__))

def rpc(name,payload,timeout=8):
    data=json.dumps(payload,ensure_ascii=False).encode("utf-8")
    req=urllib.request.Request(f"{SUPABASE_URL}/rest/v1/rpc/{name}",data=data,method="POST",headers={"Content-Type":"application/json","apikey":API_KEY,"User-Agent":"mang-luoi-an-toan/4.0"})
    with urllib.request.urlopen(req,timeout=timeout) as r:
        raw=r.read().decode("utf-8")
        return json.loads(raw) if raw else None

def clean_keyword(value):
    value=unicodedata.normalize("NFC",str(value or "")).upper()
    out=[]
    for ch in value:
        cat=unicodedata.category(ch)
        if ch.isspace() or cat.startswith("P") or cat.startswith("S"):
            out.append(" ")
        else:
            out.append(ch)
    return " ".join("".join(out).split())

def count_words(value):
    cleaned=clean_keyword(value)
    return len(cleaned.split()) if cleaned else 0

class Handler(BaseHTTPRequestHandler):
    def log_message(self,format,*args):pass

    def _json(self,obj,status=200):
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
        req=urllib.request.Request(url,headers={"User-Agent":"mang-luoi-an-toan-health/4.0"})
        with urllib.request.urlopen(req,timeout=timeout) as r:return json.loads(r.read().decode("utf-8") or "{}")

    def _post_json_url(self,url,payload,timeout=8):
        req=urllib.request.Request(url,data=json.dumps(payload,ensure_ascii=False).encode("utf-8"),method="POST",headers={"Content-Type":"application/json","User-Agent":"mang-luoi-an-toan-health/4.0"})
        with urllib.request.urlopen(req,timeout=timeout) as r:return json.loads(r.read().decode("utf-8") or "{}")

    def do_GET(self):
        parsed=urllib.parse.urlparse(self.path);path=parsed.path;query=urllib.parse.parse_qs(parsed.query)
        if path in ("/","/index.html"):
            try:
                with open(os.path.join(BASE_DIR,"index.html"),"rb") as f:body=f.read()
                self.send_response(200);self.send_header("Content-Type","text/html; charset=utf-8");self.send_header("Content-Length",str(len(body)));self.send_header("Cache-Control","no-store");self.end_headers();self.wfile.write(body)
            except Exception as e:self._json({"error":"Không tải được giao diện","detail":str(e)[:160]},500)
            return

        static_routes = {
            "/pose-quiz": ("pose-quiz/index.html", "text/html; charset=utf-8"),
            "/pose-quiz/": ("pose-quiz/index.html", "text/html; charset=utf-8"),
            "/pose-quiz/index.html": ("pose-quiz/index.html", "text/html; charset=utf-8"),
            "/pose-quiz/supabase-config.js": ("pose-quiz/supabase-config.js", "application/javascript; charset=utf-8"),
            "/pose-quiz/assets/default-bgm.mp3": ("pose-quiz/assets/default-bgm.mp3", "audio/mpeg"),
            "/pose-quiz/assets/default-correct.mp3": ("pose-quiz/assets/default-correct.mp3", "audio/mpeg"),
            "/pose-quiz/assets/default-wrong.mp3": ("pose-quiz/assets/default-wrong.mp3", "audio/mpeg"),
            "/supabase-config.js": ("pose-quiz/supabase-config.js", "application/javascript; charset=utf-8"),
            "/boc-tham": ("boc-tham/index.html", "text/html; charset=utf-8"),
            "/boc-tham/": ("boc-tham/index.html", "text/html; charset=utf-8"),
            "/boc-tham/index.html": ("boc-tham/index.html", "text/html; charset=utf-8"),
            "/mang-luoi-an-toan": ("mang-luoi-an-toan/index.html", "text/html; charset=utf-8"),
            "/mang-luoi-an-toan/": ("mang-luoi-an-toan/index.html", "text/html; charset=utf-8"),
            "/mang-luoi-an-toan/index.html": ("mang-luoi-an-toan/index.html", "text/html; charset=utf-8"),
        }
        if path in static_routes:
            rel, content_type = static_routes[path]
            try:
                full = os.path.join(BASE_DIR, rel)
                with open(full, "rb") as f:
                    body = f.read()
                self.send_response(200)
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Cache-Control", "no-store")
                self.send_header("X-Content-Type-Options", "nosniff")
                self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
                self.end_headers()
                self.wfile.write(body)
            except Exception as e:
                self._json({"error":"Không tải được mô-đun","detail":str(e)[:160]},500)
            return

        if path=="/api/room":
            room=(query.get("room") or [""])[0]
            if not UUID_RE.match(room):return self._json({"error":"Mã phòng không hợp lệ"},400)
            try:
                rows=rpc("safety_get_room",{"p_room_id":room}) or []
                if not rows:return self._json({"error":"Phòng không tồn tại hoặc đã hết hạn"},404)
                row=rows[0]
                return self._json({"ok":True,"room":{"room_id":row.get("room_id"),"question":row.get("question"),"word_limit":row.get("word_limit"),"created_at":row.get("created_at"),"updated_at":row.get("updated_at")}})
            except Exception as e:return self._json({"error":"Không đọc được thông tin phòng","detail":str(e)[:180]},502)

        if path=="/api/answers":
            room=(query.get("room") or [""])[0]
            if not UUID_RE.match(room):return self._json({"error":"Mã phòng không hợp lệ"},400)
            try:return self._json({"ok":True,"answers":rpc("safety_get_answers",{"p_room_id":room}) or []})
            except Exception as e:return self._json({"error":"Không đọc được dữ liệu lớp học","detail":str(e)[:180]},502)

        if path=="/api/results":
            library_token=(query.get("library_token") or [""])[0]
            if not UUID_RE.match(library_token):return self._json({"error":"Mã thư viện không hợp lệ"},400)
            try:
                rows=rpc("feedback_list_results",{"p_library_token":library_token}) or []
                return self._json({"ok":True,"results":rows})
            except Exception as e:return self._json({"error":"Không đọc được lịch sử kết quả","detail":str(e)[:180]},502)

        if path=="/api/results/item":
            library_token=(query.get("library_token") or [""])[0]
            result_id=(query.get("result_id") or [""])[0]
            if not UUID_RE.match(library_token) or not UUID_RE.match(result_id):return self._json({"error":"Mã kết quả không hợp lệ"},400)
            try:
                rows=rpc("feedback_get_result",{"p_library_token":library_token,"p_result_id":result_id}) or []
                if not rows:return self._json({"error":"Không tìm thấy kết quả đã lưu"},404)
                return self._json({"ok":True,"result":rows[0]})
            except Exception as e:return self._json({"error":"Không mở được kết quả đã lưu","detail":str(e)[:180]},502)

        if path=="/api/health":
            room="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";token="cccccccc-cccc-4ccc-8ccc-cccccccccccc";person="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
            question="Điều gì giúp một hoạt động tương tác hiệu quả hơn";limit=3;base="https://mang-luoi-an-toan.vercel.app"
            try:
                set_room=self._post_json_url(base+"/api/room",{"room":room,"host_token":token,"question":question,"word_limit":limit})
                room_data=self._get_json_url(base+"/api/room?room="+room)
                submit=self._post_json_url(base+"/api/submit",{"room":room,"participant":person,"name":"Health Check","answer":"lắng nghe trẻ!"})
                answers=self._get_json_url(base+"/api/answers?room="+room)
                try:
                    self._post_json_url(base+"/api/submit",{"room":room,"participant":"dddddddd-dddd-4ddd-8ddd-dddddddddddd","name":"Limit Test","answer":"MỘT HAI BA BỐN"})
                    limit_ok=False
                except urllib.error.HTTPError as e:
                    limit_ok=e.code==400
                qr_req=urllib.request.Request(base+"/api/qr?text="+urllib.parse.quote(base+"/?room="+room,safe=""),headers={"User-Agent":"mang-luoi-an-toan-health/4.0"})
                with urllib.request.urlopen(qr_req,timeout=8) as r:qr_body=r.read(250).decode("utf-8",errors="ignore")
                rd=room_data.get("room",{});room_ok=bool(set_room.get("ok")) and rd.get("question")==question and int(rd.get("word_limit") or 0)==limit
                submit_ok=bool(submit.get("ok"));read_row=next((x for x in (answers.get("answers") or []) if str(x.get("participant_id"))==person),None)
                read_ok=bool(read_row);normalize_ok=bool(read_row and read_row.get("answer")=="LẮNG NGHE TRẺ");qr_ok="<svg" in qr_body or "<?xml" in qr_body
                ok=room_ok and submit_ok and read_ok and normalize_ok and limit_ok and qr_ok
                return self._json({"ok":ok,"app":"mang-luoi-an-toan","version":"4.0.0","room_question":"ok" if room_ok else "fail","normalize":"ok" if normalize_ok else "fail","word_limit":"ok" if limit_ok else "fail","submit":"ok" if submit_ok else "fail","read":"ok" if read_ok else "fail","qr":"ok" if qr_ok else "fail"},200 if ok else 503)
            except Exception as e:return self._json({"ok":False,"app":"mang-luoi-an-toan","version":"4.0.0","error":str(e)[:220]},503)

        if path=="/api/qr":
            text=(query.get("text") or [""])[0][:1200]
            if not text:return self._json({"error":"Thiếu nội dung QR"},400)
            try:
                import qrcode,qrcode.image.svg
                img=qrcode.make(text,image_factory=qrcode.image.svg.SvgPathImage,error_correction=qrcode.constants.ERROR_CORRECT_M,border=2)
                buff=io.BytesIO();img.save(buff);body=buff.getvalue()
                self.send_response(200);self.send_header("Content-Type","image/svg+xml");self.send_header("Content-Length",str(len(body)));self.send_header("Cache-Control","no-store");self.end_headers();self.wfile.write(body)
            except Exception as e:self._json({"error":"Không tạo được QR","detail":str(e)[:160]},500)
            return

        if path=="/favicon.ico":self.send_response(204);self.end_headers();return
        self._json({"error":"Not found"},404)

    def do_POST(self):
        parsed=urllib.parse.urlparse(self.path);body=self._body_json()
        if parsed.path=="/api/room":
            room=str(body.get("room",""));token=str(body.get("host_token",""));question=str(body.get("question","")).strip()
            try:word_limit=int(body.get("word_limit",3))
            except Exception:word_limit=0
            if not UUID_RE.match(room) or not UUID_RE.match(token):return self._json({"error":"Mã phòng hoặc mã điều hành không hợp lệ"},400)
            if not (5<=len(question)<=300):return self._json({"error":"Câu hỏi phải có từ 5 đến 300 ký tự"},400)
            if not (1<=word_limit<=20):return self._json({"error":"Giới hạn số từ phải từ 1 đến 20"},400)
            try:
                rpc("safety_set_room",{"p_room_id":room,"p_host_token":token,"p_question":question,"p_word_limit":word_limit})
                return self._json({"ok":True})
            except Exception as e:return self._json({"error":"Không lưu được câu hỏi","detail":str(e)[:180]},502)

        if parsed.path=="/api/results/save":
            room=str(body.get("room",""));host_token=str(body.get("host_token",""));library_token=str(body.get("library_token",""));title=str(body.get("title","")).strip()
            display_settings=body.get("display_settings",{})
            if not UUID_RE.match(room) or not UUID_RE.match(host_token) or not UUID_RE.match(library_token):return self._json({"error":"Mã lưu kết quả không hợp lệ"},400)
            if not (1<=len(title)<=120):return self._json({"error":"Tên kết quả phải có từ 1 đến 120 ký tự"},400)
            if not isinstance(display_settings,dict):return self._json({"error":"Thiết lập hiển thị không hợp lệ"},400)
            try:
                saved=rpc("feedback_save_result",{
                    "p_room_id":room,
                    "p_host_token":host_token,
                    "p_library_token":library_token,
                    "p_title":title,
                    "p_display_settings":display_settings
                }) or {}
                return self._json(saved if isinstance(saved,dict) else {"ok":True,"result":saved})
            except Exception as e:return self._json({"error":"Không lưu được kết quả","detail":str(e)[:180]},502)

        if parsed.path=="/api/results/rename":
            library_token=str(body.get("library_token",""));result_id=str(body.get("result_id",""));title=str(body.get("title","")).strip()
            if not UUID_RE.match(library_token) or not UUID_RE.match(result_id):return self._json({"error":"Mã kết quả không hợp lệ"},400)
            if not (1<=len(title)<=120):return self._json({"error":"Tên kết quả phải có từ 1 đến 120 ký tự"},400)
            try:
                renamed=rpc("feedback_rename_result",{"p_library_token":library_token,"p_result_id":result_id,"p_title":title}) or {}
                return self._json(renamed if isinstance(renamed,dict) else {"ok":True})
            except Exception as e:return self._json({"error":"Không đổi được tên kết quả","detail":str(e)[:180]},502)

        if parsed.path=="/api/results/delete":
            library_token=str(body.get("library_token",""));result_id=str(body.get("result_id",""))
            if not UUID_RE.match(library_token) or not UUID_RE.match(result_id):return self._json({"error":"Mã kết quả không hợp lệ"},400)
            try:
                deleted=rpc("feedback_delete_result",{"p_library_token":library_token,"p_result_id":result_id}) or {}
                return self._json(deleted if isinstance(deleted,dict) else {"ok":True})
            except Exception as e:return self._json({"error":"Không xóa được kết quả","detail":str(e)[:180]},502)

        if parsed.path=="/api/submit":
            room=str(body.get("room",""));participant=str(body.get("participant",""));name=str(body.get("name","")).strip();answer=clean_keyword(body.get("answer",""))
            if not UUID_RE.match(room) or not UUID_RE.match(participant):return self._json({"error":"Mã kết nối không hợp lệ"},400)
            if not (1<=len(name)<=50):return self._json({"error":"Tên phải có từ 1 đến 50 ký tự"},400)
            if not answer:return self._json({"error":"Vui lòng nhập từ khóa"},400)
            try:
                room_rows=rpc("safety_get_room",{"p_room_id":room}) or []
                if not room_rows:return self._json({"error":"Phòng không tồn tại hoặc đã hết hạn"},404)
                limit=int(room_rows[0].get("word_limit") or 3)
                if count_words(answer)>limit:return self._json({"error":f"Từ khóa chỉ được tối đa {limit} từ"},400)
                rpc("safety_submit_answer",{"p_room_id":room,"p_participant_id":participant,"p_name":name,"p_answer":answer})
                return self._json({"ok":True,"normalized_answer":answer})
            except urllib.error.HTTPError as e:return self._json({"error":"Không gửi được từ khóa","detail":str(e)[:180]},502)
            except Exception as e:return self._json({"error":"Không gửi được từ khóa","detail":str(e)[:180]},502)

        self._json({"error":"Not found"},404)
