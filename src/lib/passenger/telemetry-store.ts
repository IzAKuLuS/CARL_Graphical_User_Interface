import { createDashboardData, finiteNumber, sanitizeDashboardData, type DashboardData, type Health } from './dashboard';

export type TelemetryTopic = 'heartbeat' | 'throttleStatus' | 'encoders' | 'steeringAngle';
type Reading = Record<string, number | boolean | null>;
export interface Sample { value: Reading; receivedAt: number; }
export interface TelemetryState {
  connected: boolean;
  samples: Partial<Record<TelemetryTopic, Sample>>;
}
export const FRESH_MS = { heartbeat: 1000, throttleStatus: 1000, encoders: 1000, steeringAngle: 250 } as const;
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
    data.throttle = THROTTLE_LABELS[throttle.state as number];
    data.throttleFaults = throttle.faults as number;
    data.appliedLeft = throttle.applied_left as number;
    data.appliedRight = throttle.applied_right as number;
  }
  if (encoder) {
    data.encoderLeft = encoder.rear_left_counts as number;
    data.encoderRight = encoder.rear_right_counts as number;
  }
  if (steering && !((steering.status as number) & STEERING_STALE)) {
    data.steeringValid = steering.valid === true && steering.status === 1;
    data.steeringCalibrated = steering.calibrated as boolean;
    data.steeringAngleDeg = data.steeringValid && data.steeringCalibrated
      ? (steering.angle_rad as number) * 180 / Math.PI : null;
  }
  return sanitizeDashboardData(data);
}

/** Compare scalar snapshots without serializing the high-rate receive path. */
const DASHBOARD_KEYS = Object.keys(createDashboardData()) as (keyof DashboardData)[];
export function sameDashboard(a: DashboardData, b: DashboardData): boolean {
  return DASHBOARD_KEYS.every(key => a[key] === b[key]);
}
