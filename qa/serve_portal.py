"""Chạy cổng giáo viên cục bộ bằng chính server.Handler (kiểm tra cả danh sách đường dẫn được phép)."""
import os, sys
from http.server import ThreadingHTTPServer
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from server import Handler
port = int(sys.argv[1]) if len(sys.argv) > 1 else 4174
ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
