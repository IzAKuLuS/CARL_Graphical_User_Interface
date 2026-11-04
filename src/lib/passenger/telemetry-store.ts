import { finiteNumber, previewData, sanitizeDashboardData, type DashboardData, type Health } from './dashboard';

export type TelemetryTopic = 'heartbeat' | 'throttleStatus' | 'encoders' | 'steeringAngle';
type ObjectValue = Record<string, unknown>;
export interface Sample { value: ObjectValue; receivedAt: number; }
export interface TelemetryState {
  connected: boolean;
  samples: Partial<Record<TelemetryTopic, Sample>>;
}
export const FRESH_MS = { heartbeat: 1000, throttleStatus: 1000, encoders: 1000, steeringAngle: 250 } as const;
export const DISPLAY_PERIOD_MS = 100;
export const THROTTLE_LABELS = ['Initializing', 'Idle', 'Driving', 'Safe stop', 'E-stop'] as const;

function object(value: unknown): value is ObjectValue { return !!value && typeof value === 'object' && !Array.isArray(value); }
function integer(value: unknown, max: number) { return finiteNumber(value, 0, max) !== null && Number.isInteger(value); }

/** Validate before trusting incoming JSON. Bad messages clear that topic instead of extending freshness. */
export function ingest(state: TelemetryState, topic: TelemetryTopic, value: unknown, now: number): boolean {
  if (!state.connected || !Number.isFinite(now)) return false;
  let valid = false;
  if (object(value)) {
    switch (topic) {
      case 'heartbeat': valid = integer(value.counter, 255) && integer(value.flags, 255) && integer(value.mode, 2); break;
      case 'throttleStatus': valid = integer(value.state, 4) && integer(value.faults, 255) && finiteNumber(value.applied_left, -1, 1) !== null && finiteNumber(value.applied_right, -1, 1) !== null; break;
      case 'steeringAngle': valid = integer(value.status, 255) && typeof value.valid === 'boolean' && typeof value.calibrated === 'boolean' && (!value.valid || (finiteNumber(value.sensor_voltage, 0) !== null && (!value.calibrated || finiteNumber(value.angle_rad) !== null))); break;
      case 'encoders': valid = ['rear_left_counts', 'rear_right_counts'].every(k => Number.isSafeInteger(value[k]) && finiteNumber(value[k], -2147483648, 2147483647) !== null); break;
    }
  }
  if (valid) state.samples[topic] = { value: value as ObjectValue, receivedAt: now };
  else delete state.samples[topic];
  return valid;
}
export function setConnection(state: TelemetryState, connected: boolean) {
  // Reconnection must start with new samples; old healthy values cannot reappear.
  if (state.connected !== connected || !connected) state.samples = {};
  state.connected = connected;
}
function fresh(state: TelemetryState, topic: TelemetryTopic, now: number): ObjectValue | null {
  const sample = state.samples[topic];
  const age = sample ? now - sample.receivedAt : Infinity;
  return state.connected && sample && age >= 0 && age <= FRESH_MS[topic] ? sample.value : null;
}
function health(state: TelemetryState, topic: TelemetryTopic, now: number): Health {
  if (!state.connected) return 'offline';
  return fresh(state, topic, now) ? 'online' : state.samples[topic] ? 'stale' : 'unknown';
}
export function projectTelemetry(state: TelemetryState, now: number): DashboardData {
  const data = { ...previewData('reference'), sample: false,
    connection: state.connected ? 'online' as const : 'offline' as const,
    bridgePresence: null, heartbeat: health(state, 'heartbeat', now), throttleController: 'unknown' as Health, steeringController: 'unknown' as Health
  };
  const hb = fresh(state, 'heartbeat', now);
  const throttle = fresh(state, 'throttleStatus', now);
  const encoder = fresh(state, 'encoders', now);
  const steering = fresh(state, 'steeringAngle', now);
  data.throttle = throttle ? THROTTLE_LABELS[throttle.state as number] : null;
  if (hb) {
    const flags = hb.flags as number;
    data.heartbeat = flags & 1 ? 'online' : 'fault';
    data.heartbeatCounter = hb.counter as number;
    data.vehicleMode = ['Idle', 'Teleop', 'E-stop'][hb.mode as number];
    data.estopActive = !!(flags & 2);
    data.teleopReady = !!(flags & 4);
  }
  if (throttle) {
    data.throttleFaults = throttle.faults as number;
    data.appliedLeft = throttle.applied_left as number;
    data.appliedRight = throttle.applied_right as number;
  }
  if (encoder) { data.encoderLeft = encoder.rear_left_counts as number; data.encoderRight = encoder.rear_right_counts as number; }
  if (steering && !((steering.status as number) & 128)) {
    data.steeringValid = steering.valid === true && steering.status === 1;
    data.steeringCalibrated = steering.calibrated as boolean;
    data.steeringAngleDeg = data.steeringValid && data.steeringCalibrated ? (steering.angle_rad as number) * 180 / Math.PI : null;
  }
  return sanitizeDashboardData(data);
}

/** Avoid rerenders when values and freshness states have not changed. No serialization in the receive path. */
export function sameDashboard(a: DashboardData, b: DashboardData): boolean {
  return (Object.keys(a) as (keyof DashboardData)[]).every(key => {
    return a[key] === b[key];
  });
}
