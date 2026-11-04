/** Presentation-only contract. Bind to useROS in the real app, not in this prototype. */
export type Health = 'online' | 'stale' | 'offline' | 'unknown' | 'fault';
export type Page = 'Drive' | 'Telemetry' | 'System';
export type Scenario = 'reference' | 'driving' | 'stale' | 'disconnected';
export interface DashboardData {
  sample: boolean;
  connection: Health;
  bridgePresence: string | null;
  heartbeat: Health;
  throttleController: Health;
  steeringController: Health;
  throttle: string | null;
  speedKmh: number | null;
  ambientC: number | null;
  batteryPercent: number | null;
  encoderLeft: number | null;
  encoderRight: number | null;
  heartbeatCounter: number | null;
  steeringAngleDeg: number | null;
  steeringValid: boolean | null;
  steeringCalibrated: boolean | null;
  vehicleMode: string | null;
  estopActive: boolean | null;
  teleopReady: boolean | null;
  throttleFaults: number | null;
  appliedLeft: number | null;
  appliedRight: number | null;
}
export const HEALTH_LABELS: Record<Health, string> = {
  online: 'Online', stale: 'Stale', offline: 'Offline', unknown: 'Unknown', fault: 'Fault'
};
export function previewData(scenario: Scenario): DashboardData {
  const reference: DashboardData = {
    sample: true, connection: 'online', bridgePresence: 'Sample endpoints', heartbeat: 'online',
    throttleController: 'online', steeringController: 'online', throttle: 'Idle',
    speedKmh: null, ambientC: null, batteryPercent: null,
    encoderLeft: null, encoderRight: null, heartbeatCounter: null,
    vehicleMode: null, estopActive: null, teleopReady: null,
    steeringAngleDeg: null, steeringValid: null, steeringCalibrated: null,
    throttleFaults: null, appliedLeft: null, appliedRight: null
  };
  if (scenario === 'driving') return { ...reference, throttle: 'Active', speedKmh: 12.4,
    ambientC: null, batteryPercent: 78, encoderLeft: 12480, encoderRight: 12464,
    heartbeatCounter: 248, vehicleMode: 'Teleop', estopActive: false, teleopReady: true,
    steeringAngleDeg: null, steeringValid: null, steeringCalibrated: null,
    throttleFaults: 0, appliedLeft: 0.12, appliedRight: 0.12 };
  if (scenario === 'stale') return { ...reference, heartbeat: 'stale', throttle: null,
    throttleController: 'stale', steeringController: 'unknown' };
  if (scenario === 'disconnected') return { ...reference, connection: 'offline', heartbeat: 'offline',
    throttleController: 'unknown', steeringController: 'unknown', throttle: null };
  return reference;
}
export function speedValue(data: DashboardData, unit: 'km/h' | 'mph') {
  if (data.connection !== 'online' || data.heartbeat !== 'online' || finiteNumber(data.speedKmh, 0) === null) return null;
  return (unit === 'mph' ? data.speedKmh! * 0.621371 : data.speedKmh!).toFixed(1);
}

/** Invalid readings are unavailable, never silently represented as a healthy zero/full reading. */
export function finiteNumber(value: unknown, min = -Infinity, max = Infinity): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : null;
}
export function batteryReading(value: unknown): number | null { return finiteNumber(value, 0, 100); }
export function batteryColor(percent: number): string { return `hsl(${percent * 1.2} 85% 48%)`; }
export function sanitizeDashboardData(data: DashboardData): DashboardData {
  const online = data.connection === 'online';
  const heartbeatFresh = online && (data.heartbeat === 'online' || data.heartbeat === 'fault');
  return { ...data,
    heartbeat: online ? data.heartbeat : 'offline',
    bridgePresence: online ? data.bridgePresence : null,
    throttleController: online ? data.throttleController : 'unknown',
    steeringController: online ? data.steeringController : 'unknown',
    throttle: online ? data.throttle : null,
    speedKmh: heartbeatFresh ? finiteNumber(data.speedKmh, 0) : null,
    batteryPercent: online ? batteryReading(data.batteryPercent) : null,
    ambientC: online ? finiteNumber(data.ambientC, -273.15) : null,
    encoderLeft: online ? finiteNumber(data.encoderLeft) : null,
    encoderRight: online ? finiteNumber(data.encoderRight) : null,
    heartbeatCounter: heartbeatFresh ? finiteNumber(data.heartbeatCounter, 0) : null,
    vehicleMode: heartbeatFresh ? data.vehicleMode : null,
    estopActive: heartbeatFresh ? data.estopActive : null,
    teleopReady: heartbeatFresh ? data.teleopReady : null,
    throttleFaults: online ? finiteNumber(data.throttleFaults, 0, 255) : null,
    steeringAngleDeg: online && data.steeringValid === true && data.steeringCalibrated === true ? finiteNumber(data.steeringAngleDeg) : null,
    steeringValid: online ? data.steeringValid : null,
    steeringCalibrated: online ? data.steeringCalibrated : null,
    appliedLeft: online ? finiteNumber(data.appliedLeft, -1, 1) : null,
    appliedRight: online ? finiteNumber(data.appliedRight, -1, 1) : null,
  };
}
