import { createDashboardData, finiteNumber, sanitizeDashboardData, type DashboardData, type Health } from './dashboard';

export type TelemetryTopic = 'heartbeat' | 'throttleStatus' | 'encoders' | 'steeringAngle' | 'imu' | 'imuTemperature' | 'imuDiagnostics';
type Reading = Record<string, number | boolean | string | null>;
export interface Sample { value: Reading; receivedAt: number; }
export interface TelemetryState {
  connected: boolean;
  samples: Partial<Record<TelemetryTopic, Sample>>;
}
export const FRESH_MS = { heartbeat: 1000, throttleStatus: 1000, encoders: 1000, steeringAngle: 250,
  imu: 500, imuTemperature: 1000, imuDiagnostics: 2500 } as const;
export const DISPLAY_PERIOD_MS = 100;
export const THROTTLE_LABELS = ['Initializing', 'Idle', 'Driving', 'Safe stop', 'E-stop'] as const;
const MODE_LABELS = ['Idle', 'Teleop', 'E-stop'] as const;
const HEARTBEAT_OK = 1;
const ESTOP_ACTIVE = 2;
const TELEOP_READY = 4;
const STEERING_STALE = 128;

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function integer(value: unknown, max: number): value is number {
  return finiteNumber(value, 0, max) !== null && Number.isInteger(value);
}
function encoderCount(value: unknown): value is number {
  return Number.isInteger(value) && finiteNumber(value, -2147483648, 2147483647) !== null;
}

/** Keep only validated scalar fields. Headers and unbounded extra payloads are not retained. */
function normalize(topic: TelemetryTopic, value: unknown): Reading | null {
  if (!object(value)) return null;
  switch (topic) {
    case 'imu': {
      const a = value.linear_acceleration, g = value.angular_velocity;
      if (!object(a) || !object(g)) return null;
      const ax = finiteNumber(a.x), ay = finiteNumber(a.y), az = finiteNumber(a.z);
      const gx = finiteNumber(g.x), gy = finiteNumber(g.y), gz = finiteNumber(g.z);
      if ([ax, ay, az, gx, gy, gz].some(v => v === null)) return null;
      const covariance = value.orientation_covariance;
      const q = value.orientation;
      const orientation = Array.isArray(covariance) && covariance[0] === -1 ? false
        : object(q) && [q.x, q.y, q.z, q.w].every(v => finiteNumber(v) !== null)
          && Math.abs((q.x as number) ** 2 + (q.y as number) ** 2 + (q.z as number) ** 2 + (q.w as number) ** 2 - 1) < 0.1 ? true : null;
      return { ax, ay, az, gx, gy, gz, orientation };
    }
    case 'imuTemperature': {
      const temperature = finiteNumber(value.temperature, -273.15);
      return temperature === null ? null : { temperature };
    }
    case 'imuDiagnostics': {
      if (typeof value.data !== 'string' || value.data.length > 4096) return null;
      let d: unknown;
      try { d = JSON.parse(value.data); } catch { return null; }
      if (!object(d) || d.schema !== 1 || typeof d.ready !== 'boolean' || !integer(d.error_count, 65535)) return null;
      for (const key of ['sensor', 'stage', 'error']) {
        if (typeof d[key] !== 'string' || (d[key] as string).length > 64) return null;
      }
      return { sensor: d.sensor as string, stage: d.stage as string, error: d.error as string,
        ready: d.ready, error_count: d.error_count };
    }
    case 'heartbeat': {
      const { counter, flags, mode } = value;
      return integer(counter, 255) && integer(flags, 255) && integer(mode, 2)
        ? { counter, flags, mode } : null;
    }
    case 'throttleStatus': {
      const { state, faults } = value;
      const applied_left = finiteNumber(value.applied_left, -1, 1);
      const applied_right = finiteNumber(value.applied_right, -1, 1);
      return integer(state, 4) && integer(faults, 255) && applied_left !== null && applied_right !== null
        ? { state, faults, applied_left, applied_right } : null;
    }
    case 'encoders': {
      const { rear_left_counts, rear_right_counts } = value;
      return encoderCount(rear_left_counts) && encoderCount(rear_right_counts)
        ? { rear_left_counts, rear_right_counts } : null;
    }
    case 'steeringAngle': {
      const { status, valid, calibrated } = value;
      if (!integer(status, 255) || typeof valid !== 'boolean' || typeof calibrated !== 'boolean') return null;
      const sensor_voltage = finiteNumber(value.sensor_voltage, 0);
      const angle_rad = finiteNumber(value.angle_rad);
      if (valid && (sensor_voltage === null || (calibrated && angle_rad === null))) return null;
      return { status, valid, calibrated, sensor_voltage, angle_rad };
    }
    default: return null;
  }
}

/** Bad messages clear that topic rather than extending the last good sample's freshness. */
export function ingest(state: TelemetryState, topic: TelemetryTopic, value: unknown, now: number): boolean {
  if (!state.connected || !Number.isFinite(now) || now < 0) return false;
  const reading = normalize(topic, value);
  const previous = state.samples[topic];
  if (!reading || (previous && now < previous.receivedAt)) {
    delete state.samples[topic];
    return false;
  }
  state.samples[topic] = { value: reading, receivedAt: now };
  return true;
}

export function setConnection(state: TelemetryState, connected: boolean) {
  // Reconnection starts with new samples; old healthy values cannot reappear.
  if (state.connected !== connected || !connected) state.samples = {};
  state.connected = connected;
}
function fresh(state: TelemetryState, topic: TelemetryTopic, now: number): Reading | null {
  const sample = state.samples[topic];
  const age = sample ? now - sample.receivedAt : Infinity;
  return state.connected && sample && age >= 0 && age <= FRESH_MS[topic] ? sample.value : null;
}
function health(state: TelemetryState, topic: TelemetryTopic, now: number): Health {
  if (!state.connected) return 'offline';
  return fresh(state, topic, now) ? 'online' : state.samples[topic] ? 'stale' : 'unknown';
}

export function projectTelemetry(state: TelemetryState, now: number): DashboardData {
  const data = createDashboardData();
  data.connection = state.connected ? 'online' : 'offline';
  data.heartbeat = health(state, 'heartbeat', now);
  data.throttleController = health(state, 'throttleStatus', now);
  data.steeringController = health(state, 'steeringAngle', now);
  data.imuHealth = health(state, 'imu', now);
  data.imuTemperatureHealth = health(state, 'imuTemperature', now);
  data.imuDiagnosticsHealth = health(state, 'imuDiagnostics', now);
  const imu = fresh(state, 'imu', now);
  const temperature = fresh(state, 'imuTemperature', now);
  const diagnostics = fresh(state, 'imuDiagnostics', now);
  if (imu) {
    data.imuAccelX = imu.ax as number; data.imuAccelY = imu.ay as number; data.imuAccelZ = imu.az as number;
    data.imuGyroX = imu.gx as number; data.imuGyroY = imu.gy as number; data.imuGyroZ = imu.gz as number;
    data.imuOrientationAvailable = imu.orientation as boolean | null;
  }
  if (temperature) data.imuTemperatureC = temperature.temperature as number;
  if (diagnostics) {
    data.imuSensor = diagnostics.sensor as string; data.imuStage = diagnostics.stage as string;
    data.imuError = diagnostics.error as string; data.imuErrorCount = diagnostics.error_count as number;
    data.imuDiagnosticsHealth = diagnostics.error !== 'ok' ? 'fault' : diagnostics.ready ? 'online' : 'unknown';
  }
  const hb = fresh(state, 'heartbeat', now);
  const throttle = fresh(state, 'throttleStatus', now);
  const encoder = fresh(state, 'encoders', now);
  const steering = fresh(state, 'steeringAngle', now);
  if (hb) {
    const flags = hb.flags as number;
    data.heartbeat = flags & HEARTBEAT_OK ? 'online' : 'fault';
    data.heartbeatCounter = hb.counter as number;
    data.vehicleMode = MODE_LABELS[hb.mode as number];
    // Either source of e-stop evidence wins if mode and flags disagree.
    data.estopActive = !!(flags & ESTOP_ACTIVE) || hb.mode === 2;
    data.teleopReady = !!(flags & TELEOP_READY) && !data.estopActive;
  }
  if (throttle) {
    data.throttleController = throttle.faults || throttle.state === 3 || throttle.state === 4
      ? 'fault' : throttle.state === 0 ? 'unknown' : 'online';
    data.throttle = THROTTLE_LABELS[throttle.state as number];
    data.throttleFaults = throttle.faults as number;
    data.appliedLeft = throttle.applied_left as number;
    data.appliedRight = throttle.applied_right as number;
  }
  if (encoder) {
    data.encoderLeft = encoder.rear_left_counts as number;
    data.encoderRight = encoder.rear_right_counts as number;
  }
  if (steering) {
    // The bridge's timeout sentinel is not evidence of a live steering Teensy.
    // Calibration controls angle display, not whether feedback is healthy.
    if ((steering.status as number) & STEERING_STALE) {
      data.steeringController = 'stale';
    } else {
      data.steeringValid = steering.valid === true && steering.status === 1;
      data.steeringController = data.steeringValid ? 'online' : 'fault';
      data.steeringCalibrated = steering.calibrated as boolean;
      data.steeringAngleDeg = data.steeringValid && data.steeringCalibrated
        ? (steering.angle_rad as number) * 180 / Math.PI : null;
    }
  }
  return sanitizeDashboardData(data);
}

/** Compare scalar snapshots without serializing the high-rate receive path. */
const DASHBOARD_KEYS = Object.keys(createDashboardData()) as (keyof DashboardData)[];
export function sameDashboard(a: DashboardData, b: DashboardData): boolean {
  return DASHBOARD_KEYS.every(key => a[key] === b[key]);
}
