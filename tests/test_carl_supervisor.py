"""No ROS processes or vehicle devices are used by these supervisor checks."""
import importlib.util
from pathlib import Path
import subprocess
import unittest
import time
from unittest.mock import Mock, patch

SPEC = importlib.util.spec_from_file_location('carl_supervisor', Path(__file__).parents[1] / 'scripts/carl-supervisor.py')
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)


class SupervisorSafetyTests(unittest.TestCase):
    def make_owner(self):
        owner = module.Supervisor()
        owner.preflight = lambda: None
        owner.preflight_joystick = lambda: None
        owner.await_check = lambda *_args, **_kwargs: None
        owner.joy_health = lambda: {'ready': True, 'controller_connected': False}
        owner.web_bridge = lambda: True
        owner.zero = lambda: True
        return owner

    def test_no_control_does_not_launch_joystick_and_can_switch_modes(self):
        owner = self.make_owner()
        events = []
        owner.launch = lambda name, _command: (events.append('start:' + name), owner.processes.update({name: object()}))
        owner.terminate = lambda name: (events.append('stop:' + name), owner.processes.pop(name, None))
        with patch.object(module.time, 'sleep', lambda _seconds: None):
            owner.start()
        self.assertEqual(owner.status['state'], 'awaiting-mode')
        self.assertEqual(events, ['start:bridge', 'start:rosbridge'])
        owner.choose_no_control()
        self.assertEqual(owner.status['mode'], 'none')
        with patch.object(module.time, 'sleep', lambda _seconds: None):
            owner.start_joystick()
        self.assertEqual(owner.status['state'], 'on')
        self.assertEqual(owner.status['mode'], 'joystick')
        owner.start_joystick()
        self.assertEqual(events.count('start:joystick'), 1)
        owner.stop_joystick()
        owner.stop_joystick()
        self.assertEqual(owner.status['mode'], 'none')
        owner.stop()
        self.assertEqual(owner.status['state'], 'off')
        self.assertEqual(events, ['start:bridge', 'start:rosbridge', 'start:joystick',
                                  'stop:joystick', 'stop:joystick', 'stop:bridge', 'stop:rosbridge'])

    def test_second_stage_failure_rolls_back_bridge(self):
        owner = self.make_owner()
        events = []
        def launch(name, _command):
            if name == 'rosbridge':
                raise module.Failure('rosbridge', 'port in use')
            events.append('start:' + name)
            owner.processes[name] = object()
        owner.launch = launch
        owner.terminate = lambda name: (events.append('stop:' + name), owner.processes.pop(name, None))
        with patch.object(module.time, 'sleep', lambda _seconds: None):
            owner.start()
        self.assertEqual(owner.status['state'], 'fault')
        self.assertEqual(owner.processes, {})
        self.assertEqual(events, ['start:bridge', 'stop:joystick', 'stop:bridge', 'stop:rosbridge'])
        self.assertIn('port 9090', owner.status['error'])

    def test_joystick_failure_rolls_back_core_processes(self):
        owner = self.make_owner()
        events = []
        owner.launch = lambda name, _command: (events.append('start:' + name), owner.processes.update({name: object()}))
        owner.terminate = lambda name: (events.append('stop:' + name), owner.processes.pop(name, None))
        with patch.object(module.time, 'sleep', lambda _seconds: None):
            owner.start()
        owner.await_check = lambda name, *_args: (_ for _ in ()).throw(module.Failure('joystick', 'failed')) if name == 'joystick' else None
        with patch.object(module.time, 'sleep', lambda _seconds: None):
            owner.start_joystick()
        self.assertEqual(owner.status['state'], 'fault')
        self.assertEqual(owner.processes, {})
        self.assertEqual(events, ['start:bridge', 'start:rosbridge', 'start:joystick',
                                  'stop:joystick', 'stop:bridge', 'stop:rosbridge'])

    def test_joystick_server_can_start_while_estop_blocks_motion(self):
        owner = self.make_owner()
        owner.status.update(state='awaiting-mode')
        owner.launch = lambda name, _command: owner.processes.update({name: object()})
        owner.await_check = lambda name, check, *_args: self.assertTrue(check()) if name == 'joystick' else None
        owner.joy_health = lambda: {'ready': False, 'blocked_reason': 'estop', 'controller_connected': False}
        with patch.object(module.time, 'sleep', lambda _seconds: None):
            owner.start_joystick()
        self.assertEqual(owner.status['mode'], 'joystick')

    def test_controller_disconnect_returns_to_no_control_without_stopping_core(self):
        owner = self.make_owner()
        owner.status.update(state='on', mode='joystick')
        owner.last_display = time.monotonic()
        owner.processes = {name: Mock(poll=lambda: None) for name in ('bridge', 'rosbridge', 'joystick')}
        owner.terminate = lambda name: owner.processes.pop(name, None)
        owner.joy_health = lambda: {'ready': True, 'controller_connected': True}
        owner.check_once()
        self.assertTrue(owner.joystick_had_controller)
        owner.joy_health = lambda: {'ready': False, 'blocked_reason': 'estop', 'controller_connected': False}
        owner.check_once()
        self.assertEqual(owner.status['state'], 'on')
        self.assertEqual(owner.status['mode'], 'none')
        self.assertEqual(set(owner.processes), {'bridge', 'rosbridge'})

    def test_transient_joystick_feedback_fault_does_not_stop_carl(self):
        owner = self.make_owner()
        owner.status.update(state='on', mode='joystick')
        owner.last_display = time.monotonic()
        owner.terminate = lambda _name: self.fail('Transient feedback must not tear down CARL')
        owner.joy_health = lambda: {'ready': False, 'blocked_reason': 'throttle_status_fault', 'controller_connected': True}
        owner.check_once()
        owner.check_once()
        self.assertEqual(owner.status['state'], 'on')
        owner.joy_health = lambda: {'ready': True, 'controller_connected': True}
        owner.check_once()
        self.assertEqual(owner.joystick_health_misses, 0)

    def test_single_heartbeat_probe_timeout_does_not_abort_mode_selection(self):
        owner = self.make_owner()
        owner.status.update(state='awaiting-mode')
        owner.last_display = time.monotonic()
        results = iter((False, True))
        owner.heartbeat = lambda: next(results)
        owner.check_once()
        self.assertEqual(owner.status['state'], 'awaiting-mode')
        self.assertEqual(owner.heartbeat_misses, 1)
        owner.last_heartbeat_check = 0
        owner.check_once()
        self.assertEqual(owner.status['state'], 'awaiting-mode')
        self.assertEqual(owner.heartbeat_misses, 0)

    def test_no_control_zero_failure_rolls_back_core_processes(self):
        owner = self.make_owner()
        owner.launch = lambda name, _command: owner.processes.update({name: object()})
        owner.terminate = lambda name: owner.processes.pop(name, None)
        with patch.object(module.time, 'sleep', lambda _seconds: None):
            owner.start()
        owner.zero = lambda: False
        owner.choose_no_control()
        self.assertEqual(owner.status['state'], 'fault')
        self.assertEqual(owner.processes, {})
        self.assertIn('zero throttle', owner.status['error'])

    def test_joystick_stop_does_not_report_no_control_if_process_survives(self):
        owner = self.make_owner()
        owner.status.update(state='on', mode='joystick')
        owner.processes = {name: object() for name in ('bridge', 'rosbridge', 'joystick')}
        owner.terminate = lambda name: False if name == 'joystick' else (owner.processes.pop(name, None), True)[1]
        owner.stop_joystick()
        self.assertEqual(owner.status['state'], 'fault')
        self.assertNotEqual(owner.status['mode'], 'none')
        self.assertIn('physical E-stop', owner.status['error'])

    def test_terminate_confirms_an_owned_process_group_exits(self):
        owner = self.make_owner()
        process = subprocess.Popen(['/bin/sleep', '30'], start_new_session=True)
        owner.processes['joystick'] = process
        try:
            self.assertTrue(owner.terminate('joystick'))
            self.assertIsNotNone(process.poll())
            self.assertNotIn('joystick', owner.processes)
        finally:
            if process.poll() is None:
                process.kill()
                process.wait()

    def test_missing_serial_prevents_any_launch(self):
        owner = self.make_owner()
        owner.preflight = lambda: (_ for _ in ()).throw(module.Failure('serial_missing', '/dev/ttyACM0'))
        owner.launch = lambda *_args: self.fail('must not launch after preflight failure')
        owner.start()
        self.assertEqual(owner.status['state'], 'fault')
        self.assertEqual(owner.processes, {})
        self.assertIn('STM32', owner.status['error'])

    def test_display_watchdog_stops_all_owned_processes(self):
        owner = self.make_owner()
        owner.status['state'] = 'on'
        owner.status['mode'] = 'joystick'
        owner.last_display = time.monotonic() - 6
        owner.processes = {name: object() for name in ('bridge', 'rosbridge', 'joystick')}
        stopped = []
        owner.terminate = lambda name: (stopped.append(name), owner.processes.pop(name, None))
        owner.check_once()
        self.assertEqual(owner.status['state'], 'fault')
        self.assertEqual(stopped, ['joystick', 'bridge', 'rosbridge'])
        self.assertIn('display stopped responding', owner.status['error'].lower())

    def test_lost_feedback_stops_all_owned_processes(self):
        owner = self.make_owner()
        owner.status['state'] = 'on'
        owner.status['mode'] = 'joystick'
        owner.last_display = time.monotonic()
        owner.processes = {}
        owner.joy_health = lambda: {'ready': False, 'blocked_reason': 'heartbeat_stale', 'controller_connected': True}
        owner.terminate = lambda _name: None
        for _ in range(3): owner.check_once()
        self.assertEqual(owner.status['state'], 'fault')
        self.assertIn('STM32', owner.status['error'])

    def test_health_faults_have_specific_operator_messages(self):
        self.assertEqual(module.Supervisor.health_failure({'blocked_reason': 'estop'}), 'estop')
        self.assertEqual(module.Supervisor.health_failure({'blocked_reason': 'throttle_status_stale'}), 'throttle_feedback')
        self.assertEqual(module.Supervisor.health_failure({'blocked_reason': 'throttle_status_fault'}), 'throttle_fault')

    def test_failed_zero_command_never_reports_normal_off(self):
        owner = self.make_owner()
        owner.processes = {'bridge': object()}
        owner.zero = lambda: False
        owner.terminate = lambda name: owner.processes.pop(name, None)
        owner.stop()
        self.assertEqual(owner.status['state'], 'fault')
        self.assertIn('zero throttle', owner.status['error'])


if __name__ == '__main__':
    unittest.main()
