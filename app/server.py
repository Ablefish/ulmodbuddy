#!/usr/bin/env python3
"""Local server for the Cookbook app.

Serves the static app (same no-cache behavior as a plain dev server always
had) AND powers the in-app "point me at your install" build flow: the app
itself has no data.js on a fresh download, so it POSTs an install path here,
this calls into build.py in-process, and returns the result as JSON. This
is a required runtime component for every user now, not a dev-only shortcut.

Run: python3 server.py [port]  (defaults to 8420)
"""
import io
import os
import sys
import json
import traceback
import threading
import contextlib
from pathlib import Path
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

APP_DIR = Path(__file__).resolve().parent
BUILD_DIR = APP_DIR.parent / "build"

os.chdir(APP_DIR)
sys.path.insert(0, str(BUILD_DIR))
import build as build_module  # noqa: E402  (path must be set up first)

_build_lock = threading.Lock()


class CookbookRequestHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def _send_json(self, status, body):
        payload = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        if self.path == "/api/config":
            self._send_json(200, {"installRoot": build_module._read_local_config().get("installRoot")})
            return
        super().do_GET()

    def do_POST(self):
        if self.path == "/api/build":
            self._handle_build()
        else:
            self.send_error(404)

    def _handle_build(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length) or b"{}")
            install_root = (body.get("installRoot") or "").strip()
        except (ValueError, json.JSONDecodeError):
            self._send_json(400, {"ok": False, "error": "Malformed request.", "log": []})
            return
        if not install_root:
            self._send_json(400, {"ok": False, "error": "Enter a folder path first.", "log": []})
            return

        if not _build_lock.acquire(blocking=False):
            self._send_json(409, {"ok": False, "error": "A build is already running -- try again in a moment.", "log": []})
            return
        try:
            log_buffer = io.StringIO()
            try:
                with contextlib.redirect_stdout(log_buffer):
                    build_module.main(Path(install_root))
                build_module._write_local_config({"installRoot": str(Path(install_root).resolve())})
                self._send_json(200, {"ok": True, "log": log_buffer.getvalue().splitlines()})
            except build_module.InstallRootError as e:
                self._send_json(400, {"ok": False, "error": str(e), "log": log_buffer.getvalue().splitlines()})
            except Exception as e:
                traceback.print_exc()  # full trace to this terminal only, never to the browser
                self._send_json(500, {
                    "ok": False,
                    "error": f"Unexpected error during build: {e}. Check the terminal running server.py for the full traceback.",
                    "log": log_buffer.getvalue().splitlines(),
                })
        finally:
            _build_lock.release()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8420
    print(f"Cookbook server running at http://localhost:{port}")
    ThreadingHTTPServer(("", port), CookbookRequestHandler).serve_forever()
