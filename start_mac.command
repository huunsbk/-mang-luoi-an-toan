#!/bin/bash
cd "$(dirname "$0")"
python3 -c "import qrcode" >/dev/null 2>&1 || python3 -m pip install -r requirements.txt
python3 server.py
