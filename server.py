#!/usr/bin/env python3
import json
import os
import socket
import sys
import threading
import time
import uuid
import webbrowser
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, 'static')
PORT = 8765
RESPONSES = []
LOCK = threading.Lock()
REVISION = 0
STARTED_AT = time.time()


def get_lan_ip():
    # Works even when the Internet is unavailable on most LANs because UDP connect
    # only asks the OS which interface would be used.
    candidates = []
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 80))
        candidates.append(s.getsockname()[0])
        s.close()
    except Exception:
        pass
    try:
        host = socket.gethostname()
        for ip in socket.gethostbyname_ex(host)[2]:
            if not ip.startswith('127.'):
                candidates.append(ip)
    except Exception:
        pass
    for ip in candidates:
        if ip and not ip.startswith('127.') and ':' not in ip:
            return ip
    return '127.0.0.1'


LAN_IP = get_lan_ip()
JOIN_URL = f'http://{LAN_IP}:{PORT}/?join=1'
HOST_URL = f'http://127.0.0.1:{PORT}/?mode=host'


def json_bytes(obj):
    return json.dumps(obj, ensure_ascii=False).encode('utf-8')


def make_qr_svg(text):
    try:
        import qrcode
        qr = qrcode.QRCode(version=None, box_size=8, border=3)
        qr.add_data(text)
        qr.make(fit=True)
        matrix = qr.get_matrix()
    except Exception:
        return '<svg xmlns="http://www.w3.org/2000/svg" width="360" height="360"><rect width="100%" height="100%" fill="white"/><text x="50%" y="50%" text-anchor="middle" font-size="20">QR unavailable</text></svg>'

    n = len(matrix)
    box = 8
    size = n * box
    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" shape-rendering="crispEdges">',
             f'<rect width="{size}" height="{size}" fill="#fff"/>']
    for y, row in enumerate(matrix):
        x = 0
        while x < n:
            if not row[x]:
                x += 1
                continue
            start = x
            while x < n and row[x]:
                x += 1
            w = x - start
            parts.append(f'<rect x="{start*box}" y="{y*box}" width="{w*box}" height="{box}" fill="#10284a"/>')
    parts.append('</svg>')
    return ''.join(parts)


class Handler(SimpleHTTPRequestHandler):
    server_version = 'MangLuoiAnToan/1.0'

    def log_message(self, format, *args):
        if '/api/state' not in str(args):
            super().log_message(format, *args)

    def _send_json(self, obj, status=200):
        body = json_bytes(obj)
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self):
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if length > 20_000:
                return None
            raw = self.rfile.read(length)
            return json.loads(raw.decode('utf-8'))
        except Exception:
            return None

    def _is_loopback(self):
        ip = self.client_address[0]
        return ip in ('127.0.0.1', '::1') or ip.startswith('127.')

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path == '/api/state':
            with LOCK:
                data = {'revision': REVISION, 'count': len(RESPONSES), 'responses': list(RESPONSES), 'started_at': STARTED_AT}
            return self._send_json(data)

        if path == '/api/config':
            return self._send_json({'join_url': JOIN_URL, 'host_url': HOST_URL, 'lan_ip': LAN_IP, 'port': PORT, 'is_localhost': self._is_loopback()})

        if path == '/qr.svg':
            svg = make_qr_svg(JOIN_URL).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'image/svg+xml; charset=utf-8')
            self.send_header('Content-Length', str(len(svg)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(svg)
            return

        if path == '/':
            path = '/index.html'
        file_path = os.path.normpath(os.path.join(STATIC_DIR, path.lstrip('/')))
        if not file_path.startswith(os.path.normpath(STATIC_DIR)):
            self.send_error(403)
            return
        if not os.path.exists(file_path):
            self.send_error(404)
            return
        try:
            with open(file_path, 'rb') as f:
                body = f.read()
            ctype = 'text/html; charset=utf-8'
            if file_path.endswith('.js'):
                ctype = 'application/javascript; charset=utf-8'
            elif file_path.endswith('.css'):
                ctype = 'text/css; charset=utf-8'
            self.send_response(200)
            self.send_header('Content-Type', ctype)
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(body)
        except OSError:
            self.send_error(500)

    def do_POST(self):
        global REVISION
        parsed = urlparse(self.path)
        path = parsed.path

        if path == '/api/answer':
            data = self._read_json()
            if not data:
                return self._send_json({'ok': False, 'error': 'Dữ liệu không hợp lệ.'}, 400)
            name = str(data.get('name', '')).strip()[:50]
            answer = str(data.get('answer', '')).strip()[:180]
            device_id = str(data.get('device_id', '')).strip()[:80] or str(uuid.uuid4())
            if len(name) < 1 or len(answer) < 2:
                return self._send_json({'ok': False, 'error': 'Vui lòng nhập tên và câu trả lời.'}, 400)
            now = time.time()
            with LOCK:
                existing = next((r for r in RESPONSES if r['device_id'] == device_id), None)
                if existing:
                    existing.update({'name': name, 'answer': answer, 'updated_at': now})
                    item_id = existing['id']
                else:
                    item_id = str(uuid.uuid4())[:8]
                    RESPONSES.append({'id': item_id, 'device_id': device_id, 'name': name, 'answer': answer, 'created_at': now, 'updated_at': now})
                REVISION += 1
                count = len(RESPONSES)
            return self._send_json({'ok': True, 'id': item_id, 'count': count})

        if path == '/api/reset':
            if not self._is_loopback():
                return self._send_json({'ok': False, 'error': 'Chỉ máy báo cáo viên mới có thể xóa dữ liệu.'}, 403)
            with LOCK:
                RESPONSES.clear()
                REVISION += 1
            return self._send_json({'ok': True})

        self.send_error(404)


def open_browser_later():
    time.sleep(1.0)
    try:
        webbrowser.open(HOST_URL)
    except Exception:
        pass


def main():
    print('=' * 70)
    print('  MẠNG LƯỚI AN TOÀN - Mini app tập huấn Bảo vệ trẻ em')
    print('=' * 70)
    print(f'  Màn hình báo cáo viên: {HOST_URL}')
    print(f'  Link học viên:          {JOIN_URL}')
    print('')
    print('  Yêu cầu: laptop và điện thoại cùng một mạng Wi-Fi.')
    print('  Nếu Windows hỏi Firewall, chọn Allow access / Cho phép trên Private network.')
    print('  Nhấn Ctrl+C để dừng ứng dụng.')
    print('=' * 70)
    threading.Thread(target=open_browser_later, daemon=True).start()
    httpd = ThreadingHTTPServer(('0.0.0.0', PORT), Handler)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print('\nĐã dừng ứng dụng.')
    finally:
        httpd.server_close()


if __name__ == '__main__':
    main()
