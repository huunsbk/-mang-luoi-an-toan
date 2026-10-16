import io
import json
import os
import re
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler

FEEDBACK_MAP_API_URL="https://exfnarddchxzfewlztwb.supabase.co/functions/v1/feedback-map-api"
UUID_RE=re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",re.I)
BASE_DIR=os.path.dirname(os.path.abspath(__file__))

# The teacher portal routes requests through this single Python handler.
# Delegate /api/marble-tts before JSON parsing (POST needs the raw body).
_marble_tts_module=None
def dispatch_marble_tts(request, method):
    global _marble_tts_module
    try:
        if _marble_tts_module is None:
            import importlib.util
            tts_path=os.path.join(BASE_DIR,"api","marble-tts.py")
            spec=importlib.util.spec_from_file_location("marble_tts_route",tts_path)
            if spec is None or spec.loader is None:
                raise RuntimeError("Cannot load Marble TTS module")
            module=importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            _marble_tts_module=module
        return getattr(_marble_tts_module.handler,"do_"+method)(request)
    except Exception:
        return request._json({"error":"Dịch vụ giọng đọc AI tạm thời không khả dụng."},503)

def rpc(name,payload,timeout=8):
    data=json.dumps({"rpc":name,"payload":payload},ensure_ascii=False).encode("utf-8")
    req=urllib.request.Request(
        FEEDBACK_MAP_API_URL,
        data=data,
        method="POST",
        headers={"Content-Type":"application/json","User-Agent":"giaovien-psi-feedback-map/1.0"}
    )
    with urllib.request.urlopen(req,timeout=timeout) as r:
        raw=r.read().decode("utf-8")
        result=json.loads(raw) if raw else {}
        if result.get("error"):
            raise RuntimeError(result.get("error"))
        return result.get("data")

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
        if path=="/api/marble-tts":return dispatch_marble_tts(self,"GET")
        if path in ("/","/index.html"):
            try:
                with open(os.path.join(BASE_DIR,"index.html"),"rb") as f:body=f.read()
                self.send_response(200);self.send_header("Content-Type","text/html; charset=utf-8");self.send_header("Content-Length",str(len(body)));self.send_header("Cache-Control","no-store");self.end_headers();self.wfile.write(body)
            except Exception as e:self._json({"error":"Không tải được giao diện","detail":str(e)[:160]},500)
            return

        # NGHI-TTS local voice model files. Fixed, allowlisted upstream only.
        # The 64 MB ONNX model is redirected to HuggingFace's CORS-enabled CDN,
        # not streamed through the Vercel function. Inference stays on the client.
        # Allowlist NGHI-TTS voices; only the selected model (~64 MB) is downloaded.
        voice_match=re.fullmatch(r"/marble-race/voice/([a-z0-9]+)\.onnx(\.json)?",path)
        available_voices={'adam1','banmai','calmwoman3688','chieuthanh','deepman3909','duyoryx3175','lacphi','maiphuong','manhdung','minhkhang','minhquang','minhthu','mytam2','mytam2794','ngochuyen','ngochuyennew','ngocngan3701','phuongtrang','taian2','taian4','thanhphuong2','thientam','tranthanh3870','vietthao3886','yannew'}
        if voice_match:
            voice=voice_match.group(1)
            if voice not in available_voices:
                return self._json({"error":"Giọng NGHI-TTS không được hỗ trợ"},404)
            if voice_match.group(2):
                try:
                    upstream="https://huggingface.co/doof-ferb/nghitts-copy/resolve/main/piper-tts/config.json"
                    req=urllib.request.Request(upstream,headers={"User-Agent":"marble-race-nghi-tts/1.0"})
                    with urllib.request.urlopen(req,timeout=12) as response:
                        body=response.read(10000)
                    settings=json.loads(body)
                    if settings.get("espeak",{}).get("voice")!="vi" or not settings.get("phoneme_id_map"):
                        return self._json({"error":"Cấu hình giọng không hợp lệ"},502)
                    self.send_response(200)
                    self.send_header("Content-Type","application/json; charset=utf-8")
                    self.send_header("Content-Length",str(len(body)))
                    self.send_header("Cache-Control","public, max-age=86400")
                    self.send_header("X-Content-Type-Options","nosniff")
                    self.end_headers()
                    self.wfile.write(body)
                except Exception:
                    self._json({"error":"Không tải được cấu hình giọng NGHI-TTS"},502)
                return
            try:
                class NoFollow(urllib.request.HTTPRedirectHandler):
                    def redirect_request(self,req,fp,code,msg,headers,url):
                        return None
                opener=urllib.request.build_opener(NoFollow)
                remote=f"https://huggingface.co/doof-ferb/nghitts-copy/resolve/main/piper-tts/{voice}.onnx"
                redirect=None
                for _ in range(5):
                    try:
                        with opener.open(urllib.request.Request(remote,headers={"User-Agent":"marble-race-nghi-tts/1.0"}),timeout=12):
                            raise ValueError("Missing model CDN redirect")
                    except urllib.error.HTTPError as err:
                        if err.code not in (301,302,303,307,308):
                            raise
                        redirect=urllib.parse.urljoin(remote,err.headers.get("Location",""))
                        host=urllib.parse.urlsplit(redirect).hostname or ""
                        if urllib.parse.urlsplit(redirect).scheme!="https":
                            raise ValueError("Invalid model location")
                        if host=="huggingface.co":
                            remote=redirect
                            continue
                        if not host.endswith(".cdn.hf.co"):
                            raise ValueError("Untrusted model host")
                        break
                else:
                    raise ValueError("No approved CDN location")
                if not redirect:
                    raise ValueError("Missing CDN URL")
                self.send_response(302)
                self.send_header("Location",redirect)
                self.send_header("Cache-Control","private, max-age=600")
                self.send_header("Content-Length","0")
                self.end_headers()
            except Exception:
                self._json({"error":"Không xác định được đường tải mô hình NGHI-TTS"},502)
            return

        static_routes = {
            "/forgot-password": ("forgot-password/index.html", "text/html; charset=utf-8"),
            "/forgot-password/": ("forgot-password/index.html", "text/html; charset=utf-8"),
            "/forgot-password/index.html": ("forgot-password/index.html", "text/html; charset=utf-8"),
            "/forgot-password/recovery.js": ("forgot-password/recovery.js", "application/javascript; charset=utf-8"),
            "/register": ("register/index.html", "text/html; charset=utf-8"),
            "/register/": ("register/index.html", "text/html; charset=utf-8"),
            "/register/index.html": ("register/index.html", "text/html; charset=utf-8"),
            "/register/register.js": ("register/register.js", "application/javascript; charset=utf-8"),
            "/question-bank": ("question-bank/index.html", "text/html; charset=utf-8"),
            "/question-bank/": ("question-bank/index.html", "text/html; charset=utf-8"),
            "/question-bank/index.html": ("question-bank/index.html", "text/html; charset=utf-8"),
            "/question-bank/manager.js": ("question-bank/manager.js", "application/javascript; charset=utf-8"),
            "/question-bank/batch-audio.js": ("question-bank/batch-audio.js", "application/javascript; charset=utf-8"),
            "/question-bank/classroom20.js": ("question-bank/classroom20.js", "application/javascript; charset=utf-8"),
            "/classrooms": ("classrooms/index.html", "text/html; charset=utf-8"),
            "/classrooms/": ("classrooms/index.html", "text/html; charset=utf-8"),
            "/classrooms/index.html": ("classrooms/index.html", "text/html; charset=utf-8"),
            "/classrooms/classroom-store.js": ("classrooms/classroom-store.js", "application/javascript; charset=utf-8"),
            "/classrooms/classroom-manager.js": ("classrooms/classroom-manager.js", "application/javascript; charset=utf-8"),
            "/classrooms/class-photo-batch.js": ("classrooms/class-photo-batch.js", "application/javascript; charset=utf-8"),
            "/classrooms/student-name-tts.js": ("classrooms/student-name-tts.js", "application/javascript; charset=utf-8"),
            "/marble-race/classroom-picker.js": ("marble-race/classroom-picker.js", "application/javascript; charset=utf-8"),
            "/pose-quiz": ("pose-quiz/index.html", "text/html; charset=utf-8"),
            "/pose-quiz/": ("pose-quiz/index.html", "text/html; charset=utf-8"),
            "/pose-quiz/index.html": ("pose-quiz/index.html", "text/html; charset=utf-8"),
            "/pose-quiz/supabase-config.js": ("pose-quiz/supabase-config.js", "application/javascript; charset=utf-8"),
            "/pose-quiz/assets/default-bgm.mp3": ("pose-quiz/assets/default-bgm.mp3", "audio/mpeg"),
            "/pose-quiz/assets/default-correct.mp3": ("pose-quiz/assets/default-correct.mp3", "audio/mpeg"),
            "/pose-quiz/assets/default-wrong.mp3": ("pose-quiz/assets/default-wrong.mp3", "audio/mpeg"),
            "/pose-quiz/assets/default-pose-none.webp": ("pose-quiz/assets/default-pose-none.webp", "image/webp"),
            "/pose-quiz/assets/default-pose-raise-left.webp": ("pose-quiz/assets/default-pose-raise-left.webp", "image/webp"),
            "/pose-quiz/assets/default-pose-raise-right.webp": ("pose-quiz/assets/default-pose-raise-right.webp", "image/webp"),
            "/pose-quiz/assets/default-pose-both-up.webp": ("pose-quiz/assets/default-pose-both-up.webp", "image/webp"),
            "/pose-quiz/assets/default-pose-cross-arms.webp": ("pose-quiz/assets/default-pose-cross-arms.webp", "image/webp"),
            "/supabase-config.js": ("pose-quiz/supabase-config.js", "application/javascript; charset=utf-8"),
            "/marble-race": ("marble-race/index.html", "text/html; charset=utf-8"),
            "/marble-race/": ("marble-race/index.html", "text/html; charset=utf-8"),
            "/marble-race/index.html": ("marble-race/index.html", "text/html; charset=utf-8"),
            "/marble-race/voice/piper-worker.js": ("marble-race/voice/piper-worker.js", "application/javascript; charset=utf-8"),
            "/marble-race/shared-bank.js": ("marble-race/shared-bank.js", "application/javascript; charset=utf-8"),
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
            question="Điều gì giúp một hoạt động tương tác hiệu quả hơn";limit=3;base="https://giaovien-psi.vercel.app"
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
        parsed=urllib.parse.urlparse(self.path)
        if parsed.path=="/api/marble-tts":return dispatch_marble_tts(self,"POST")
        body=self._body_json()
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
