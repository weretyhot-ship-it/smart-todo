#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
make-shortcut.pyw - drop a double-clickable shortcut on the Desktop.

It creates   <Desktop>\\智能待办清单.lnk   that runs launcher.pyw with pythonw
(no console window ever flashes), plus assets/todo.ico so the
shortcut has an icon of its own instead of the generic Python one.

Run it once:
    pythonw make-shortcut.pyw

Two ways to build the .lnk, tried in order:
  1. pywin32, when it happens to be installed
  2. Windows PowerShell + WScript.Shell COM - works on a stock Windows box

It is safe to run again: the shortcut is simply rewritten.
"""

import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
LAUNCHER = os.path.join(HERE, "launcher.pyw")
ICON = os.path.join(HERE, "assets", "todo.ico")
NAME = "智能待办清单.lnk"


# --------------------------------------------------------------------------
# desktop lookup: the shell knows the real path (OneDrive-redirected included)
# --------------------------------------------------------------------------
def desktop_dir():
    try:
        import winreg
        key = winreg.OpenKey(
            winreg.HKEY_CURRENT_USER,
            r"Software\Microsoft\Windows\CurrentVersion\Explorer\Shell Folders")
        value, _ = winreg.QueryValueEx(key, "Desktop")
        winreg.CloseKey(key)
        value = os.path.expandvars(value)
        if os.path.isdir(value):
            return value
    except Exception:
        pass
    try:
        import ctypes.wintypes
        buf = ctypes.create_unicode_buffer(260)
        ctypes.windll.shell32.SHGetFolderPathW(None, 0, None, 0, buf)
        if buf.value and os.path.isdir(buf.value):
            return buf.value
    except Exception:
        pass
    return os.path.join(os.path.expanduser("~"), "Desktop")


def pythonw():
    """
    Pick the most durable windowless interpreter, in order:
      1. pyw.exe - the official Windows launcher; survives any Python upgrade
      2. pythonw.exe - the real windowless interpreter
    Both are normally on PATH via the WindowsApps aliases.
    """
    import shutil
    for name in ("pyw.exe", "pythonw.exe"):
        found = shutil.which(name)
        if found:
            return found
    exe = sys.executable or ""
    if exe:
        cand = os.path.join(os.path.dirname(exe), "pythonw.exe")
        if os.path.isfile(cand):
            return cand
    return "pythonw.exe"


def shortcut_args(target):
    """pyw.exe needs to be told which Python to use; pythonw.exe does not."""
    if os.path.basename(target).lower().startswith("py"):
        return '-3 "%s"' % LAUNCHER
    return '"%s"' % LAUNCHER


def make_with_pywin32(link, target):
    import win32com.client
    shell = win32com.client.Dispatch("WScript.Shell")
    sc = shell.CreateShortCut(link)
    sc.TargetPath = target
    sc.Arguments = shortcut_args(target)
    sc.WorkingDirectory = HERE
    sc.IconLocation = ICON + ",0"
    sc.Description = "智能待办清单 - 本地启动，自动打开 http://localhost:8000/index.html"
    sc.WindowStyle = 1
    sc.Save()


# PowerShell does the same job when pywin32 is not installed (the usual case).
PS_SCRIPT = r"""
$ErrorActionPreference = 'Stop'
$here   = $env:TD_HERE
$link   = $env:TD_LINK
$target = $env:TD_TARGET
$launch = $env:TD_LAUNCHER
$icon   = $env:TD_ICON

# ---- 1. draw an icon of our own (32x32, .NET only, no extra modules) -------
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap 32, 32
$g   = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'
$g.Clear([System.Drawing.Color]::Transparent)
$dark = [System.Drawing.Color]::FromArgb(255, 36, 46, 42)
$lime = [System.Drawing.Color]::FromArgb(255, 232, 242, 238)
$brushDark = New-Object System.Drawing.SolidBrush $dark
$brushLime = New-Object System.Drawing.SolidBrush $lime
$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$path.AddArc(1, 1, 13, 13, 180, 90)
$path.AddArc(18, 1, 13, 13, 270, 90)
$path.AddArc(18, 18, 13, 13, 0, 90)
$path.AddArc(1, 18, 13, 13, 90, 90)
$path.CloseFigure()
$g.FillPath($brushDark, $path)
$pen = New-Object System.Drawing.Pen $lime, 3.1
$pen.StartCap = 'Round'
$pen.EndCap = 'Round'
$pen.LineJoin = 'Round'
# two explicit segments: the PointF[] overload of DrawLines is easy to get wrong
$pt1 = New-Object System.Drawing.PointF 8.5, 16.5
$pt2 = New-Object System.Drawing.PointF 13.5, 21.5
$pt3 = New-Object System.Drawing.PointF 23.5, 10.5
$g.DrawLine($pen, $pt1, $pt2)
$g.DrawLine($pen, $pt2, $pt3)
$g.Dispose()
$h = $bmp.GetHicon()
$ico = [System.Drawing.Icon]::FromHandle($h)
$fs = [System.IO.File]::Create($icon)
$ico.Save($fs)
$fs.Close()
$ico.Dispose()
$bmp.Dispose()

# ---- 2. the shortcut itself -----------------------------------------------
$shell = New-Object -ComObject WScript.Shell
$sc = $shell.CreateShortcut($link)
$sc.TargetPath       = $target
$sc.Arguments        = $env:TD_ARGS
$sc.WorkingDirectory = $here
$sc.IconLocation     = $icon + ',0'
$sc.Description      = '智能待办清单 - 本地启动，自动打开 http://localhost:8000/index.html'
$sc.WindowStyle      = 1
$sc.Save()
Write-Output ('OK ' + $link + ' -> ' + $target + ' "' + $launch + '"')
"""


def make_with_powershell(link, target):
    env = dict(os.environ)
    env.update({
        "TD_HERE": HERE, "TD_LINK": link, "TD_TARGET": target,
        "TD_LAUNCHER": LAUNCHER, "TD_ICON": ICON,
        "TD_ARGS": shortcut_args(target),
    })
    ps = os.path.join(os.environ.get("SystemRoot", r"C:\Windows"),
                      "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
    if not os.path.isfile(ps):
        ps = "powershell.exe"
    proc = subprocess.run(
        [ps, "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
         "-Command", PS_SCRIPT],
        env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        creationflags=0x08000000,          # no console window
    )
    out = (proc.stdout or b"").decode("utf-8", "replace").strip()
    if proc.returncode != 0 or not os.path.isfile(link):
        raise RuntimeError(out or ("powershell 退出码 %d" % proc.returncode))
    return out.splitlines()[-1] if out else "powershell"


def say(text):
    """print that never dies on a non-UTF8 console code page"""
    try:
        print(text)
    except UnicodeEncodeError:
        enc = (sys.stdout.encoding or "utf-8")
        sys.stdout.write(text.encode(enc, "replace").decode(enc, "replace") + "\n")


def main():
    if not os.path.isfile(LAUNCHER):
        say("找不到 launcher.pyw：%s" % LAUNCHER)
        return 1

    os.makedirs(os.path.dirname(ICON), exist_ok=True)   # assets/ 必须存在
    target = pythonw()
    desktop = desktop_dir()
    link = os.path.join(desktop, NAME)

    try:
        make_with_pywin32(link, target)
        note = "pywin32"
    except Exception:
        try:
            note = make_with_powershell(link, target)
        except Exception as exc:
            say("创建快捷方式失败：%s" % exc)
            say("可以手动创建：右键桌面 → 新建 → 快捷方式 → 目标填")
            say('  %s "%s"' % (target, LAUNCHER))
            return 1

    say("快捷方式已创建：%s" % link)
    say('  目标 : %s "%s"' % (target, LAUNCHER))
    say("  图标 : %s" % ICON)
    say("  (%s)" % note)
    return 0


if __name__ == "__main__":
    sys.exit(main())
