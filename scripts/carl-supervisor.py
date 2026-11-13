#!/usr/bin/env python3
"""User-session CARL process owner. Never treats a running process as drive readiness."""
import json
import base64
import hashlib
import os
from pathlib import Path
import signal
import socket
import subprocess
import threading
import time
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[2]
ROS = Path(os.environ.get('CARL_ROS_SETUP', '/opt/ros/lyrical/setup.bash'))
CARL = ROOT / 'AVL_CARL/ros2_ws/install/setup.bash'
JOY = ROOT / 'CARL_Joystick/install/setup.bash'
CONTROLS = ROOT / 'CARL_Controls_Application/src'
PORT = Path('/dev/ttyACM0')  # Must match carl_bridge/config/bridge.yaml.
SOCKET = Path(os.environ.get('XDG_RUNTIME_DIR', f'/run/user/{os.getuid()}')) / 'carl-operation.sock'
STATE = Path(os.environ.get('XDG_STATE_HOME', Path.home() / '.local/state')) / 'carl-operation'
PROTOCOL = 3

def notify_systemd(message):
    address = os.environ.get('NOTIFY_SOCKET')
    if not address:
        return
    if address.startswith('@'):
        address = '\0' + address[1:]
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM) as client:
            client.sendto(message.encode(), address)
    except OSError:
        pass
MESSAGES = {
    'environment': 'ROS 2 or the CARL software environment is missing. Check the installation and rebuild the workspaces.',
    'serial_missing': 'STM32 connection not found. Check its USB cable and power.',
    'serial_access': 'Cannot access the STM32 connection. Check device permissions.',
    'serial_busy': 'STM32 connection is in use. Close the other CARL session.',
    'messages': 'CARL message definitions are missing. Rebuild the ROS workspaces.',
    'dependency': 'A CARL software dependency is missing. Check the host installation.',
    'configuration': 'CARL configuration could not be loaded. Check its settings.',
    'port_9090': 'ROS web bridge cannot use port 9090. Check for another server.',
    'port_8001': 'Joystick server cannot use port 8001. Check for another server.',
    'controls': 'Remote controls page could not be found. Check its installation path.',
    'bridge': 'CARL bridge did not start. Check its configuration, messages, and STM32 connection.',
    'heartbeat': 'STM32 connected, but CARL is not responding. Check the board and firmware.',
    'rosbridge': 'ROS web bridge did not start. Check port 9090 and its ROS installation.',
    'joystick': 'Joystick server did not start. Check port 8001, dependencies, and controls files.',
    'joystick_version': 'Joystick software needs updating. Rebuild the CARL joystick workspace.',
    'feedback': 'CARL control is not ready. Check heartbeat, motor feedback, and E-stop.',
    'estop': 'CARL E-stop is active. Check the vehicle before resetting it.',
    'throttle_feedback': 'Motor-controller feedback is missing or stale. CARL control has stopped.',
    'throttle_fault': 'Motor controller reports a fault. CARL control has stopped.',
    'display': 'Passenger display stopped responding. CARL control has been stopped.',
    'zero_unverified': 'CARL software stopped, but zero throttle could not be sent. Use the physical E-stop.',
    'process_still_running': 'CARL software may still be running. Press the physical E-stop and check the host.',
    'unexpected': 'Something went wrong. CARL is no longer operational; check the host logs.',
}

class Supervisor:
    def __init__(self):
        self.lock = threading.RLock()
        self.status = {'state': 'off', 'step': None, 'mode': None, 'error': None, 'detail': None}
        self.processes = {}
        self.last_display = 0.0
        self.last_rosbridge_check = 0.0
        self.last_heartbeat_check = 0.0
        self.heartbeat_misses = 0
        self.joystick_health_misses = 0
        self.joystick_had_controller = False
        self.logs = {}

    def shell(self, command, timeout=8):
        script = f'source "{ROS}" && source "{CARL}" && {command}'
        return subprocess.run(['/bin/bash', '-c', script], capture_output=True,
                              text=True, timeout=timeout)

    def preflight(self):
        if not all(p.is_file() for p in (ROS, CARL)):
            raise Failure('environment', 'ROS or workspace setup file missing')
        for package in ('carl_bringup', 'carl_bridge', 'carl_msgs', 'rosbridge_server', 'rosapi'):
            result = self.shell(f'ros2 pkg prefix {package}', 6)
            if result.returncode:
                raise Failure('environment', f'{package}: {result.stderr[-400:]}')
        if not PORT.exists():
            raise Failure('serial_missing', str(PORT))
        if not os.access(PORT, os.R_OK | os.W_OK):
            raise Failure('serial_access', str(PORT))
        self.check_port(9090, 'port_9090')

    def check_port(self, port, code):
        with socket.socket(socket.AF_INET) as probe:
            probe.settimeout(.3)
            if probe.connect_ex(('127.0.0.1', port)) == 0:
                raise Failure(code, f'Port {port} is already in use')

    def preflight_joystick(self):
        if not JOY.is_file() or not (CONTROLS / 'joystick.html').is_file():
            raise Failure('controls', 'Joystick workspace or controls page missing')
        result = subprocess.run(['/bin/bash', '-c', f'source "{ROS}" && source "{CARL}" && source "{JOY}" && ros2 pkg prefix carl_joystick'], capture_output=True, text=True, timeout=6)
        if result.returncode:
            raise Failure('environment', 'carl_joystick is not built or sourced')
        self.check_port(8001, 'port_8001')

    def diagnose(self, name, detail):
        try:
            log = (STATE / f'{name}.log').read_text(errors='replace')[-5000:].lower()
        except OSError:
            log = ''
        if 'permission denied' in log or 'errno 13' in log:
            code = 'serial_access' if name == 'bridge' else 'configuration'
        elif 'device or resource busy' in log or 'could not exclusively lock' in log:
            code = 'serial_busy'
        elif 'address already in use' in log or 'errno 98' in log:
            code = 'port_9090' if name == 'rosbridge' else 'port_8001'
        elif 'carl_msgs' in log and ('no module named' in log or 'not found' in log):
            code = 'messages'
        elif 'no module named' in log or 'modulenotfounderror' in log:
            code = 'dependency'
        elif 'controls_dir must contain' in log:
            code = 'controls'
        elif 'parameter' in log or 'yaml' in log:
            code = 'configuration'
        else:
            code = name
        return Failure(code, detail + ('; ' + log[-600:] if log else ''))

    def launch(self, name, command):
        with self.lock:
            if self.status['state'] not in ('starting', 'joystick-starting'):
                raise Failure('unexpected', 'Startup was cancelled')
            log = (STATE / f'{name}.log').open('a', buffering=1)
            self.logs[name] = log
            overlay = f' && source "{JOY}"' if name == 'joystick' else ''
            script = f'source "{ROS}" && source "{CARL}"{overlay} && exec {command}'
            process = subprocess.Popen(['/bin/bash', '-c', script], stdout=log,
                                       stderr=subprocess.STDOUT, start_new_session=True)
            self.processes[name] = process

    def await_check(self, name, check, seconds=12):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            with self.lock:
                if self.status['state'] not in ('starting', 'joystick-starting'):
                    raise Failure('unexpected', 'Startup was cancelled')
                process = self.processes.get(name)
                if process is None:
                    raise Failure('unexpected', f'{name} was stopped during startup')
                if process.poll() is not None:
                    raise self.diagnose(name, f'{name} exited: {process.returncode}')
            if check():
                return
            time.sleep(.2)
        failure = self.diagnose(name, f'{name} did not become ready within {seconds}s')
        if failure.code == name and name == 'bridge': failure.code = 'heartbeat'
        if failure.code == name and name == 'joystick':
            failure.code = self.health_failure(self.joy_health())
        raise failure

    @staticmethod
    def health_failure(health):
        reason = (health or {}).get('blocked_reason')
        if reason in ('estop', 'heartbeat_fault'): return 'estop'
        if reason in ('throttle_status_missing', 'throttle_status_stale'): return 'throttle_feedback'
        if reason == 'throttle_status_fault': return 'throttle_fault'
        if reason in ('heartbeat_missing', 'heartbeat_stale'): return 'heartbeat'
        return 'feedback'

    def heartbeat(self):
        try:
            result = self.shell('ros2 topic echo --once /carl/heartbeat carl_msgs/msg/CarlHeartbeat', 2)
            return result.returncode == 0 and 'counter:' in result.stdout
        except (OSError, subprocess.TimeoutExpired):
            return False

    def web_bridge(self):
        try:
            key = base64.b64encode(os.urandom(16)).decode()
            request = (f'GET / HTTP/1.1\r\nHost: 127.0.0.1:9090\r\nUpgrade: websocket\r\n'
                       f'Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n')
            with socket.create_connection(('127.0.0.1', 9090), timeout=.5) as connection:
                connection.settimeout(.5)
                connection.sendall(request.encode())
                response = connection.recv(4096).decode(errors='replace')
            expected = base64.b64encode(hashlib.sha1((key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').encode()).digest()).decode()
            if ' 101 ' not in response or expected.lower() not in response.lower():
                return False
            return self.shell('ros2 service list', 2).stdout.find('/rosapi/topics') >= 0
        except (OSError, subprocess.TimeoutExpired):
            return False

    def joy_health(self):
        try:
            with urlopen('http://127.0.0.1:8001/health', timeout=.6) as response:
                return json.load(response)
        except (OSError, ValueError):
            return None

    def start(self):
        with self.lock:
            if self.status['state'] != 'off':
                return
            self.status = {'state': 'starting', 'step': 'bridge', 'mode': None, 'error': None, 'detail': None}
            self.last_display = time.monotonic()
        try:
            self.preflight()
            self.launch('bridge', 'ros2 launch carl_bringup carl.launch.py')
            self.await_check('bridge', self.heartbeat, 15)
            time.sleep(1)
            with self.lock: self.status['step'] = 'rosbridge'
            self.launch('rosbridge', 'ros2 launch rosbridge_server rosbridge_websocket_launch.xml')
            self.await_check('rosbridge', self.web_bridge, 12)
            time.sleep(1)
            with self.lock:
                if self.status['state'] == 'starting':
                    self.status = {'state': 'awaiting-mode', 'step': None, 'mode': None, 'error': None, 'detail': None}
        except Failure as error:
            with self.lock:
                if self.status['state'] != 'off': self.fail(error.code, error.detail)
        except (OSError, subprocess.TimeoutExpired, ValueError) as error:
            self.fail('unexpected', str(error))
        except Exception as error:
            self.fail('unexpected', str(error))

    def zero(self):
        try:
            result = self.shell('ros2 topic pub --once /carl/throttle_cmd carl_msgs/msg/CarlThrottleCmd "{}"', 3)
            return result.returncode == 0
        except (OSError, subprocess.TimeoutExpired):
            return False

    def choose_no_control(self):
        with self.lock:
            if self.status['state'] == 'awaiting-mode':
                if not self.zero():
                    self.fail('zero_unverified', 'Could not send zero when selecting No Control')
                else:
                    self.status = {'state': 'on', 'step': None, 'mode': 'none', 'error': None, 'detail': None}

    def start_joystick(self):
        with self.lock:
            if self.status['state'] == 'on' and self.status['mode'] == 'joystick': return
            if self.status['state'] not in ('awaiting-mode', 'on') or 'joystick' in self.processes: return
            if self.status['state'] == 'on' and self.status['mode'] != 'none': return
            self.status = {'state': 'joystick-starting', 'step': 'joystick', 'mode': None, 'error': None, 'detail': None}
            self.joystick_had_controller = False
            self.joystick_health_misses = 0
        try:
            self.preflight_joystick()
            self.launch('joystick', f'ros2 launch carl_joystick joystick.launch.py controls_dir:={CONTROLS}')
            def server_ready():
                health = self.joy_health()
                if health is None:
                    return False
                if type(health.get('controller_connected')) is not bool:
                    raise Failure('joystick_version', 'Health endpoint lacks controller connection status')
                return True
            self.await_check('joystick', server_ready, 12)
            time.sleep(1)
            with self.lock:
                if self.status['state'] == 'joystick-starting':
                    self.status = {'state': 'on', 'step': None, 'mode': 'joystick', 'error': None, 'detail': None}
        except Failure as error:
            with self.lock:
                if self.status['state'] != 'off': self.fail(error.code, error.detail)
        except Exception as error:
            self.fail('unexpected', str(error))

    def stop_joystick(self):
        with self.lock:
            if self.status['state'] == 'on' and self.status['mode'] == 'none': return
            if self.status['state'] != 'on' or self.status['mode'] != 'joystick': return
            self.status['state'] = 'joystick-stopping'
            if self.terminate('joystick') is False:
                self.fail('process_still_running', 'Joystick process group did not exit')
                return
            if not self.zero():
                self.fail('zero_unverified', 'Zero command failed while stopping joystick')
                return
            self.joystick_had_controller = False
            self.joystick_health_misses = 0
            self.last_display = time.monotonic()  # Status polling may have waited for process cleanup.
            self.status = {'state': 'on', 'step': None, 'mode': 'none', 'error': None, 'detail': None}

    def terminate(self, name):
        process = self.processes.get(name)
        if not process:
            return True
        for sig, delay in ((signal.SIGINT, 3), (signal.SIGTERM, 2), (signal.SIGKILL, 1)):
            try:
                os.killpg(process.pid, sig)
            except ProcessLookupError:
                self.processes.pop(name, None)
                return True
            except OSError:
                return False
            deadline = time.monotonic() + delay
            while time.monotonic() < deadline:
                try:
                    process.wait(timeout=min(.2, max(.01, deadline - time.monotonic())))
                except subprocess.TimeoutExpired:
                    pass
                try:
                    os.killpg(process.pid, 0)
                except ProcessLookupError:
                    self.processes.pop(name, None)
                    return True
                except OSError:
                    return False
                time.sleep(.05)
        return False

    def stop(self, error=None, detail=None):
        with self.lock:
            self.status['state'] = 'stopping'
            had_processes = bool(self.processes)
            termination_failed = self.terminate('joystick') is False
            zero_sent = self.zero() if 'bridge' in self.processes else False
            termination_failed = (self.terminate('bridge') is False) or termination_failed
            termination_failed = (self.terminate('rosbridge') is False) or termination_failed
            for log in self.logs.values():
                log.close()
            self.logs.clear()
            if termination_failed:
                error = 'process_still_running'
            elif had_processes and not zero_sent and not error:
                error = 'zero_unverified'
            self.status = {'state': 'fault' if error else 'off', 'step': None, 'mode': None,
                           'error': MESSAGES.get(error, MESSAGES['unexpected']) if error else None,
                           'detail': detail or ('Zero command could not be confirmed.' if not zero_sent else None)}

    def fail(self, code, detail):
        print(f'CARL supervisor failure [{code}]: {detail}', flush=True)
        self.stop(code, detail)

    def monitor(self):
        while True:
            time.sleep(1)
            self.check_once()
            notify_systemd('WATCHDOG=1')

    def check_once(self):
        with self.lock:
            state = self.status['state']
            if state not in ('on', 'starting', 'awaiting-mode', 'joystick-starting', 'joystick-stopping'):
                return
            if time.monotonic() - self.last_display > 5:
                self.fail('display', 'Display heartbeat timeout')
                return
            for name, process in self.processes.items():
                if process.poll() is not None:
                    failure = self.diagnose(name, f'{name} exited: {process.returncode}')
                    self.fail(failure.code, failure.detail)
                    return
            if state in ('on', 'awaiting-mode'):
                if time.monotonic() - self.last_rosbridge_check >= 3:
                    self.last_rosbridge_check = time.monotonic()
                    if not self.web_bridge():
                        self.fail('rosbridge', 'WebSocket or rosapi stopped responding')
                        return
                if state == 'on' and self.status['mode'] == 'joystick':
                    health = self.joy_health()
                    if health and health.get('controller_connected') is True:
                        self.joystick_had_controller = True
                    elif health and health.get('controller_connected') is False and self.joystick_had_controller:
                        print('CARL joystick controller disconnected; returning to No Control.', flush=True)
                        self.stop_joystick()
                        return
                    blocked = (health or {}).get('blocked_reason')
                    if health and (health.get('ready') or blocked in ('estop', 'heartbeat_fault')):
                        self.joystick_health_misses = 0
                    else:
                        self.joystick_health_misses += 1
                        if self.joystick_health_misses >= 3:
                            self.fail('joystick' if health is None else self.health_failure(health), str(health))
                elif time.monotonic() - self.last_heartbeat_check >= 3:
                    self.last_heartbeat_check = time.monotonic()
                    if not self.heartbeat():
                        self.heartbeat_misses += 1
                        if self.heartbeat_misses >= 3:
                            self.fail('heartbeat', 'Heartbeat missing in no-control mode')
                    else:
                        self.heartbeat_misses = 0

class Failure(Exception):
    def __init__(self, code, detail):
        self.code, self.detail = code, detail

def main():
    STATE.mkdir(parents=True, exist_ok=True)
    SOCKET.unlink(missing_ok=True)
    owner = Supervisor()
    threading.Thread(target=owner.monitor, daemon=True).start()
    server = socket.socket(socket.AF_UNIX)
    server.bind(str(SOCKET))
    SOCKET.chmod(0o600)
    server.listen(8)
    notify_systemd('READY=1')
    def shutdown(_signum, _frame):
        owner.stop('unexpected', 'Supervisor stopped')
        raise SystemExit(0)
    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)
    try:
        while True:
            connection, _ = server.accept()
            with connection:
                connection.settimeout(2)
                try:
                    request = json.loads(connection.recv(1024))
                    action = request.get('action')
                    if action == 'start':
                        threading.Thread(target=owner.start, daemon=True).start()
                    elif action == 'no-control':
                        owner.choose_no_control()
                    elif action == 'start-joystick':
                        threading.Thread(target=owner.start_joystick, daemon=True).start()
                    elif action == 'stop-joystick':
                        threading.Thread(target=owner.stop_joystick, daemon=True).start()
                    elif action == 'stop':
                        threading.Thread(target=owner.stop, daemon=True).start()
                    elif action == 'status':
                        with owner.lock: owner.last_display = time.monotonic()
                    else:
                        raise ValueError('Unknown action')
                    with owner.lock: reply = dict(owner.status, protocol=PROTOCOL)
                except (ValueError, OSError) as error:
                    reply = {'state': 'fault', 'error': MESSAGES['unexpected'], 'detail': str(error)}
                connection.sendall(json.dumps(reply).encode() + b'\n')
    finally:
        owner.stop('unexpected', 'Supervisor stopped')
        server.close()
        SOCKET.unlink(missing_ok=True)

if __name__ == '__main__':
    main()
