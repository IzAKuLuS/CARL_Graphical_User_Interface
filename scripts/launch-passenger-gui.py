#!/usr/bin/env python3
"""Start the local dashboard and place a dedicated Chromium window on its display."""

import fcntl
import os
from pathlib import Path
import re
import shutil
import socket
import subprocess
import sys
import time
from urllib.error import URLError
from urllib.request import urlopen


ROOT = Path(__file__).resolve().parents[1]
URL = "http://127.0.0.1:3215/"
SERVICE = "carl-passenger-gui.service"
CONTROL_SOCKET = Path(os.environ.get("XDG_RUNTIME_DIR", f"/run/user/{os.getuid()}")) / "carl-passenger-gui.sock"
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


def close_kiosk(browser_pid):
    """Close only the X11 kiosk window owned by our dedicated browser process."""
    clients = subprocess.run(["xprop", "-root", "_NET_CLIENT_LIST"],
                             text=True, capture_output=True, check=True)
    matches = []
    for window_id in re.findall(r"0x[0-9a-fA-F]+", clients.stdout):
        props = subprocess.run(["xprop", "-id", window_id, "_NET_WM_PID", "WM_NAME"],
                               text=True, capture_output=True, check=False)
        if (re.search(rf"_NET_WM_PID\(CARDINAL\) = {browser_pid}(?:\s|$)", props.stdout)
                and re.search(r'WM_NAME\([^)]+\) = "CARL Vehicle Dashboard"', props.stdout)):
            matches.append(window_id)
    if len(matches) != 1:
        raise RuntimeError(f"Expected one CARL kiosk window for browser {browser_pid}, found {len(matches)}")
    subprocess.run(["xkill", "-id", matches[0]], check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def main():
    if not (ROOT / ".next" / "BUILD_ID").is_file():
        fail("No production build found. Run 'npm ci' and 'npm run build' in the GUI repository first.")
    browser = shutil.which("chromium-browser") or shutil.which("chromium")
    if not browser:
        fail("Chromium is not installed or is not on PATH.")
    for program in ("xrandr", "xprop", "xkill"):
        if not shutil.which(program):
            fail(f"{program} is required for touchscreen placement and clean kiosk exit.")
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
        requested_close = False
        listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        try:
            CONTROL_SOCKET.unlink(missing_ok=True)
            listener.bind(str(CONTROL_SOCKET))
            CONTROL_SOCKET.chmod(0o600)
            listener.listen(1)
            listener.settimeout(0.5)
            window = subprocess.Popen([
                browser, "--ozone-platform=x11", "--no-first-run",
                "--no-default-browser-check", "--disable-session-crashed-bubble",
                f"--user-data-dir={profile}", f"--window-position={x},{y}",
                f"--window-size={width},{height}", "--kiosk", f"--app={URL}",
            ], stdout=log, stderr=subprocess.STDOUT)
            while window.poll() is None:
                try:
                    connection, _ = listener.accept()
                except socket.timeout:
                    continue
                with connection:
                    connection.settimeout(2)
                    if connection.recv(32) == b"CLOSE\n":
                        connection.sendall(b"OK\n")
                        requested_close = True
                        break
            if requested_close:
                time.sleep(0.4)  # Let the browser receive the successful response.
                if window.poll() is None:
                    close_kiosk(window.pid)
                    window.wait(timeout=5)
            elif window.returncode:
                log.write(f"Chromium exited with status {window.returncode}.\n")
        except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired,
                RuntimeError) as error:
            log.write(f"Could not close the CARL kiosk cleanly: {error}\n")
            fail("Could not close the CARL kiosk. Press Alt+F4 or close its window from the desktop.")
        finally:
            listener.close()
            CONTROL_SOCKET.unlink(missing_ok=True)
            stopped = subprocess.run(["systemctl", "--user", "stop", SERVICE],
                                     text=True, capture_output=True)
            if stopped.returncode:
                log.write(f"Could not stop the GUI service: {stopped.stderr.strip()}\n")


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
