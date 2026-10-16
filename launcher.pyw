#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Smart Todo - minimal silent launcher   (launcher.pyw)

Double click  ->  index.html opens in your browser. Nothing else.
No dialog, no buttons, no console window, no files written next to it.

What it does, in order:
  1. if the local server already answers, just open the browser and exit
  2. otherwise clean up leftovers: python processes that listen on the
     server port or run "http.server" (never touches other python programs)
  3. start   python -m http.server 8000   in this folder, hidden
     (cwd is used for the path, so Chinese characters and spaces are fine)
  4. wait until it really answers, then open the default browser
  5. exit - the server keeps running in the background

Why a local server and not the .html file directly: the Notification API only
works on a secure origin, and http://localhost counts as one while file://
does not. That is the whole reason Windows toasts work from here.

Notes
  - closing the browser window or the page has no side effect at all:
    there is no window of our own and no cleanup handler.
  - the server keeps running after this script exits; if you ever want to
    stop it, use Task Manager and end the python.exe whose command line
    contains http.server.
  - want another port? change PORT below.
"""

import os
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request

PORT = 8000
PAGE = "index.html"             # the page that opens
HOST_DIR = os.path.dirname(os.path.abspath(__file__))
URL = "http://localhost:%d/%s" % (PORT, PAGE)
READY_TIMEOUT = 15.0
SCAN_PORTS = list(range(PORT, PORT + 10))

# CREATE_NO_WINDOW: everything we spawn stays invisible
_NO_WINDOW = 0x08000000 if os.name == "nt" else 0


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------
def run_hidden(args, timeout=20):
    """Run a console command with no window and return its stdout text."""
    try:
        p = subprocess.run(
            args,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            stdin=subprocess.DEVNULL,
            creationflags=_NO_WINDOW,
            timeout=timeout,
        )
    except Exception:
        return ""
    raw = p.stdout or b""
    for enc in ("utf-8", "gbk", "latin-1"):
        try:
            return raw.decode(enc)
        except Exception:
            continue
    return ""


def is_serving(timeout=0.35):
    """
    True when our page already answers on our port.

    The check asks for the real page, not for "/": an unrelated server on
    port 8000 would answer "/" happily and then hand the browser a 404.

    Do NOT use the hostname "localhost" here: when nothing is listening,
    resolving/connecting to it can take several seconds on Windows, which
    made the whole launch feel slow. Explicit addresses with a short
    timeout fail instantly instead.
    """
    for host in ("127.0.0.1", "::1"):
        try:
            with urllib.request.urlopen("http://%s:%d/%s" % (host, PORT, PAGE),
                                        timeout=timeout) as resp:
                if 200 <= resp.status < 400:
                    return True
        except urllib.error.HTTPError as exc:
            if exc.code < 500:
                return True
        except Exception:
            pass
    return False


def port_is_free(port):
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        s.bind(("127.0.0.1", port))
        return True
    except OSError:
        return False
    finally:
        s.close()


def python_exe():
    exe = sys.executable or "python"
    for name in ("python.exe", "pythonw.exe"):
        cand = os.path.join(os.path.dirname(exe), name)
        if os.path.isfile(cand):
            return cand
    return exe


def kill_pid(pid):
    try:
        p = subprocess.run(
            ["taskkill", "/PID", str(pid), "/F"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            stdin=subprocess.DEVNULL, creationflags=_NO_WINDOW, timeout=10,
        )
        return p.returncode == 0
    except Exception:
        return False


# --------------------------------------------------------------------------
# cleanup of leftovers (the only "safety" logic left)
# --------------------------------------------------------------------------
def pids_listening_on(ports):
    """PIDs LISTENING on the given TCP ports (from netstat)."""
    out = run_hidden(["netstat", "-ano", "-p", "TCP"])
    wanted = set(str(p) for p in ports)
    pids = set()
    for line in out.splitlines():
        parts = line.split()
        if len(parts) < 4 or parts[0].upper() != "TCP":
            continue
        if "LISTEN" not in parts[3].upper() or ":" not in parts[1]:
            continue
        if parts[1].rsplit(":", 1)[1].strip() in wanted:
            try:
                pids.add(int(parts[-1]))
            except ValueError:
                pass
    return pids


def python_pids_once():
    """
    One single powershell call that returns every python-like process which
    is either an http.server leftover or a leftover copy of this launcher.
    Two separate calls cost ~2x the powershell start-up, so they are merged.
    """
    ps = (
        "Get-CimInstance Win32_Process | "
        "Where-Object { $_.Name -like 'py*' -or $_.Name -like 'python*' } | "
        "Where-Object { $_.CommandLine -like '*http.server*' -or "
        "$_.CommandLine -like '*launcher.pyw*' } | "
        "ForEach-Object { $_.ProcessId }"
    )
    out = run_hidden(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass",
                      "-Command", ps])
    pids = []
    for tok in out.split():
        try:
            pid = int(tok.strip())
        except ValueError:
            continue
        if pid != os.getpid():
            pids.append(pid)
    return pids


def cleanup_leftovers():
    """
    Kill only leftover http.server / launcher processes, then wait until the
    port is really released. A process is only killed when its name looks
    like python/py AND its command line mentions http.server / launcher.pyw
    or it holds one of our ports, so unrelated python programs are safe.
    """
    targets = []
    for pid in list(pids_listening_on(SCAN_PORTS)) + python_pids_once():
        if pid not in targets:
            targets.append(pid)
    for pid in targets:
        kill_pid(pid)

    deadline = time.time() + 1.5
    while time.time() < deadline:
        if port_is_free(PORT):
            break
        time.sleep(0.2)


# --------------------------------------------------------------------------
# start / wait / open
# --------------------------------------------------------------------------
def start_server():
    """python -m http.server PORT, hidden, cwd = this folder."""
    args = [python_exe(), "-m", "http.server", str(PORT)]
    try:
        subprocess.Popen(
            args,
            cwd=HOST_DIR,                 # path with spaces / Chinese is safe here
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=_NO_WINDOW,
            close_fds=True,
        )
        return True
    except Exception:
        return False


def wait_ready(timeout=READY_TIMEOUT):
    """Poll until the server answers (server itself starts in < 1 s)."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        if is_serving():
            return True
        time.sleep(0.15)
    return False


def open_browser(url):
    """
    Open the default browser without ever blocking this script:
    os.startfile() can hang on slow browsers, so it runs in a thread and
    we wait at most 3 seconds for it.
    """
    def worker():
        try:
            os.startfile(url)
            return
        except Exception:
            pass
        try:
            import webbrowser
            webbrowser.open(url, new=2)
        except Exception:
            pass

    t = threading.Thread(target=worker, daemon=True)
    t.start()
    t.join(3.0)
    return True


# --------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------
def main():
    # 1) already running -> just show the page
    if is_serving():
        open_browser(URL)
        return 0

    # 2) clean leftovers only if something is in the way, then start
    for attempt in range(3):
        if not port_is_free(PORT):
            cleanup_leftovers()          # slow (netstat + powershell), so avoid it

        if is_serving():                 # another launch won the race
            open_browser(URL)
            return 0

        if not port_is_free(PORT):
            time.sleep(0.8)
            continue

        if start_server() and wait_ready():
            open_browser(URL)
            return 0

    # 3) still nothing: last try, then give up quietly
    if is_serving():
        open_browser(URL)
        return 0
    return 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        sys.exit(1)
