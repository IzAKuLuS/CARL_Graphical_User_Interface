#!/usr/bin/env python3
"""Start the local dashboard and place a dedicated Chromium window on its display."""

import fcntl
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
from urllib.error import URLError
from urllib.request import urlopen


ROOT = Path(__file__).resolve().parents[1]
URL = "http://127.0.0.1:3215/"
SERVICE = "carl-passenger-gui.service"
DISPLAY_RE = re.compile(
    r"^(\S+) connected(?: primary)? (\d+)x(\d+)\+(-?\d+)\+(-?\d+) \((normal|left|right|inverted)"
)


def fail(message):
    print(f"CARL Passenger GUI: {message}", file=sys.stderr)
    if shutil.which("zenity") and os.environ.get("DISPLAY"):
        subprocess.run(["zenity", "--error", "--title=CARL Passenger GUI",
                        f"--text={message}"], check=False)
    raise SystemExit(1)


def touchscreen():
    try:
        result = subprocess.run(["xrandr", "--query"], text=True,
                                capture_output=True, check=True)
    except (OSError, subprocess.CalledProcessError):
        fail("Cannot read the desktop display layout. Log into a graphical session first.")

    connected = []
    for line in result.stdout.splitlines():
        match = DISPLAY_RE.match(line)
        if match:
            name, width, height, x, y, rotation = match.groups()
            connected.append((name, int(width), int(height), int(x), int(y), rotation))

    required_output = os.environ.get("CARL_TOUCHSCREEN_OUTPUT", "").strip()
    candidates = [display for display in connected
                  if display[1:3] == (1024, 600) and display[5] == "normal"
                  and (not required_output or display[0] == required_output)]
    if len(candidates) != 1:
        details = ", ".join(f"{d[0]} {d[1]}x{d[2]} {d[5]}" for d in connected)
        fail("Expected exactly one active 1024 x 600 landscape touchscreen"
             + (f" on {required_output}" if required_output else "")
             + f". Connected displays: {details or 'none'}.")
    return candidates[0]


def wait_for_server():
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        result = subprocess.run(["systemctl", "--user", "is-active", "--quiet", SERVICE])
        if result.returncode:
            fail("The local GUI service stopped. Check its log with 'journalctl --user -u carl-passenger-gui'.")
        try:
            with urlopen(URL, timeout=1) as response:
                if response.status == 200:
                    return
        except (OSError, URLError):
            pass
        time.sleep(0.3)
    fail("The local GUI server did not become ready within 30 seconds. Check the launcher log.")


def main():
    if not (ROOT / ".next" / "BUILD_ID").is_file():
        fail("No production build found. Run 'npm ci' and 'npm run build' in the GUI repository first.")
    browser = shutil.which("chromium-browser") or shutil.which("chromium")
    if not browser:
        fail("Chromium is not installed or is not on PATH.")
    node = shutil.which("node")
    if not node or not (ROOT / "node_modules/next/dist/bin/next").is_file():
        fail("Node.js or Next.js is missing. Run 'npm ci' in the GUI repository first.")

    state = Path(os.environ.get("XDG_STATE_HOME", Path.home() / ".local/state")) / "carl-passenger-gui"
    state.mkdir(parents=True, exist_ok=True)
    lock = (state / "launcher.lock").open("w")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        fail("The passenger GUI is already running.")

    name, width, height, x, y, _ = touchscreen()
    print(f"CARL Passenger GUI: opening on {name} at {width}x{height}+{x}+{y}")
    started = subprocess.run(["systemctl", "--user", "start", SERVICE],
                             text=True, capture_output=True)
    if started.returncode:
        fail(f"Could not start the local GUI service: {started.stderr.strip()}")
    wait_for_server()

    log = (state / "launcher.log").open("a", buffering=1)
    log.write(f"\n--- Launch {time.strftime('%Y-%m-%d %H:%M:%S')} on {name} ---\n")
    # Ubuntu's Chromium snap cannot write to arbitrary hidden directories.
    profile = (Path.home() / "snap/chromium/common/carl-passenger-gui"
               if browser.startswith("/snap/") or browser == "/usr/bin/chromium-browser"
               else state / "chromium-profile")
    with log:
        window = subprocess.Popen([
            browser, "--ozone-platform=x11", "--no-first-run",
            "--no-default-browser-check", "--disable-session-crashed-bubble",
            f"--user-data-dir={profile}", f"--window-position={x},{y}",
            f"--window-size={width},{height}", "--kiosk", f"--app={URL}",
        ], stdout=log, stderr=subprocess.STDOUT)
        if window.wait():
            fail("Chromium exited with an error. Check the launcher log.")


def serve():
    """Run the GUI server from a managed user service, independent of the browser."""
    node = shutil.which("node")
    next_bin = ROOT / "node_modules/next/dist/bin/next"
    if not node or not next_bin.is_file() or not (ROOT / ".next/BUILD_ID").is_file():
        print("Build the GUI with 'npm ci' and 'npm run build' first.", file=sys.stderr)
        raise SystemExit(1)
    os.chdir(ROOT)
    os.execv(node, [node, str(next_bin), "start", "--hostname", "127.0.0.1",
                    "--port", "3215"])


if __name__ == "__main__":
    if sys.argv[1:] == ["--serve"]:
        serve()
    elif len(sys.argv) == 1:
        main()
    else:
        raise SystemExit("Usage: launch-passenger-gui.py [--serve]")
