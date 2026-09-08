# -*- coding: utf-8 -*-
"""Fig2C4D — receives vectors from the Figma plugin and builds splines in the scene.

This file holds nothing but the HTTP server (127.0.0.1:8787), which is why it
hardly ever changes: the socket is tied to the process, so editing here means
restarting C4D. All the logic lives in fig2c4d_core.py, reloaded on every send —
edit there and the next click in Figma already uses the new version.

The POST arrives on a worker thread, which must not touch the document: it queues
the payload and calls SpecialEventAdd, and the building happens on the main thread.
"""
import os
import sys
import queue
import importlib
import threading
import traceback
from http.server import BaseHTTPRequestHandler, HTTPServer

import c4d
from c4d import plugins

sys.path.insert(0, os.path.dirname(__file__))
import fig2c4d_core as core

PLUGIN_ID = 1000001  # development range
PORT = 8787
INBOX = queue.Queue()


class Handler(BaseHTTPRequestHandler):
    def _headers(self, ctype="text/plain"):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Content-Type", ctype)
        self.end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self._headers()

    def do_GET(self):  # the plugin pings this to see whether C4D is listening
        self.send_response(200)
        self._headers()
        self.wfile.write(b"fig2c4d")

    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        INBOX.put(body.decode("utf-8"))
        self.send_response(200)
        self._headers()
        self.wfile.write(b"ok")
        c4d.SpecialEventAdd(PLUGIN_ID)

    def log_message(self, *a):
        pass


class Receiver(plugins.MessageData):
    def CoreMessage(self, mid, msg):
        if mid != PLUGIN_ID:
            return True
        try:
            # picks up core edits without restarting C4D. invalidate_caches avoids
            # a stale .pyc when the edit lands in the same second as the import.
            importlib.invalidate_caches()
            importlib.reload(core)
        except Exception:
            print("Fig2C4D: core failed to load, keeping the previous version")
            traceback.print_exc()
        while not INBOX.empty():
            try:
                core.build(INBOX.get())
            except Exception:
                traceback.print_exc()
        return True


def serve():
    try:
        HTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
    except OSError as e:
        print("Fig2C4D: port %d is busy (%s)" % (PORT, e))


if __name__ == "__main__":
    plugins.RegisterMessagePlugin(PLUGIN_ID, "Fig2C4D Receiver", 0, Receiver())
    threading.Thread(target=serve, daemon=True).start()
    print("Fig2C4D: listening on http://localhost:%d" % PORT)
