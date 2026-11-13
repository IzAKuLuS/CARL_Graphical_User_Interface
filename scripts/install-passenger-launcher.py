#!/usr/bin/env python3
"""Install the portable CARL desktop entry and on-demand user service."""

import os
from pathlib import Path
import shutil
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[1]


def desktop_argument(path):
    """Quote a desktop-entry Exec argument, including its reserved characters."""
    value = str(path)
    if "\n" in value or "\r" in value:
        raise ValueError("The clone path cannot contain a newline")
    for char in ("\\", '"', "`", "$"):
        value = value.replace(char, "\\" + char)
    value = value.replace("%", "%%")
    return '"' + value + '"'


def unit_argument(path):
    """Quote a systemd ExecStart argument and escape unit specifiers."""
    value = str(path)
    if "\n" in value or "\r" in value:
        raise ValueError("The clone path cannot contain a newline")
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"').replace("%", "%%") + '"'


def desktop_directory():
    if shutil.which("xdg-user-dir"):
        result = subprocess.run(["xdg-user-dir", "DESKTOP"], capture_output=True,
                                text=True, check=False)
        if result.returncode == 0 and result.stdout.strip():
            return Path(result.stdout.strip())
    return Path.home() / "Desktop"


def install():
    launcher = ROOT / "scripts/launch-passenger-gui.py"
    icon_source = ROOT / "public/branding/CARL_higher_resolution-removebg-preview.png"
    if not launcher.is_file() or not icon_source.is_file():
        raise RuntimeError("The GUI launcher or icon is missing from this clone")
    if not shutil.which("systemctl"):
        raise RuntimeError("This installer requires a systemd user session")

    data_home = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local/share"))
    config_home = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config"))
    app_dir = data_home / "applications"
    icon_dir = data_home / "icons"
    unit_dir = config_home / "systemd/user"
    desktop_dir = desktop_directory()
    for directory in (app_dir, icon_dir, unit_dir, desktop_dir):
        directory.mkdir(parents=True, exist_ok=True)

    icon = icon_dir / "carl-passenger-gui.png"
    shutil.copyfile(icon_source, icon)
    desktop = (ROOT / "desktop/carl-passenger-gui.desktop.in").read_text().replace(
        "@LAUNCHER@", desktop_argument(launcher)).replace("@ICON@", str(icon))
    python = Path("/usr/bin/python3") if Path("/usr/bin/python3").is_file() else Path(sys.executable)
    service = (ROOT / "desktop/carl-passenger-gui.service.in").read_text().replace(
        "@PYTHON@", unit_argument(python)).replace(
        "@LAUNCHER@", unit_argument(launcher))
    operation = (ROOT / "desktop/carl-operation.service.in").read_text().replace(
        "@PYTHON@", unit_argument(python)).replace(
        "@SUPERVISOR@", unit_argument(ROOT / "scripts/carl-supervisor.py"))

    app = app_dir / "carl-passenger-gui.desktop"
    shortcut = desktop_dir / "CARL Passenger GUI.desktop"
    unit = unit_dir / "carl-passenger-gui.service"
    for target in (app, shortcut):
        target.write_text(desktop)
        target.chmod(0o755)
    unit.write_text(service)
    unit.chmod(0o644)
    operation_unit = unit_dir / "carl-operation.service"
    operation_unit.write_text(operation)
    operation_unit.chmod(0o644)
    subprocess.run(["systemctl", "--user", "daemon-reload"], check=True)
    if shutil.which("gio"):
        subprocess.run(["gio", "set", str(shortcut), "metadata::trusted", "true"],
                       check=False)
    print(f"Installed CARL Passenger GUI from {ROOT}")
    print(f"Desktop icon: {shortcut}")


if __name__ == "__main__":
    try:
        install()
    except (OSError, ValueError, RuntimeError, subprocess.CalledProcessError) as error:
        raise SystemExit(f"CARL Passenger GUI installation failed: {error}") from error
