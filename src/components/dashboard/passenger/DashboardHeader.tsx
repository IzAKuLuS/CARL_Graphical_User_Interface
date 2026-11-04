import { memo } from 'react';
import { Activity, Cpu, Thermometer } from 'lucide-react';
import { HEALTH_LABELS, type DashboardData, type Health } from '../../../lib/passenger/dashboard';
import { Pedal, StatusIndicator } from './DashboardPrimitives';
import BatteryIcon from './BatteryIcon';
import DashboardClock from './DashboardClock';

type HeaderReadings = Pick<DashboardData,
  'heartbeat' | 'throttle' | 'throttleFaults' | 'estopActive' | 'throttleController'
  | 'steeringController' | 'ambientC' | 'batteryPercent' | 'sample'>;
interface HeaderProps extends HeaderReadings {
  referenceClock: boolean;
  hour24: boolean;
}

/** Scalar props let encoder/count updates skip the status strip entirely. */
function DashboardHeader(props: HeaderProps) {
  const { heartbeat, throttle, throttleController, steeringController, ambientC, batteryPercent } = props;
  const heartbeatLabel = heartbeat === 'online' ? 'Live' : HEALTH_LABELS[heartbeat];
  const throttleStopped = throttle === 'Safe stop' || throttle === 'E-stop';
  const throttleHealth: Health = !throttle || throttle === 'Initializing' ? 'unknown'
    : throttleStopped || props.throttleFaults || props.estopActive ? 'fault' : 'online';
  const statusDescription = (name: string, value: Health) =>
    `${name}: ${HEALTH_LABELS[value]}${props.sample ? ' (sample status)' : ''}`;
  const temperatureDescription = ambientC === null ? 'Sensor planned' : `${ambientC} degrees Celsius`;
  const batteryDescription = batteryPercent === null ? 'BMS planned' : `${batteryPercent} percent`;

  return (
    <header className="top-bar">
      <div className="brand" aria-label="CARL, Autonomous Systems Laboratory">
        <span className="wordmark">CARL</span><span className="brand-divider" />
        <span className="laboratory">Autonomous<br />Systems<br />Laboratory</span>
      </div>
      <div className="status-strip" aria-label="Vehicle status indicators">
        <StatusIndicator icon={<Activity />} label={heartbeatLabel} health={heartbeat}
          accessibleLabel={statusDescription('Heartbeat', heartbeat)} />
        <StatusIndicator icon={<Pedal />} label={`Throttle ${throttle?.toLowerCase() ?? '—'}`}
          health={throttleHealth} accessibleLabel={`Throttle status: ${throttle ?? 'Unavailable'}`} />
        <StatusIndicator icon={<Cpu />} label="THR" health={throttleController}
          accessibleLabel={statusDescription('Throttle Teensy', throttleController)} />
        <StatusIndicator icon={<Cpu />} label="STR" health={steeringController}
          accessibleLabel={statusDescription('Steering Teensy', steeringController)} />
        <StatusIndicator icon={<Thermometer />} label={ambientC === null ? '— °C' : `${ambientC} °C`}
          accessibleLabel={`Ambient temperature: ${temperatureDescription}`} />
        <StatusIndicator icon={<BatteryIcon percent={batteryPercent} />}
          label={batteryPercent === null ? '— %' : `${batteryPercent} %`}
          accessibleLabel={`Battery: ${batteryDescription}`} />
      </div>
      <DashboardClock reference={props.referenceClock} hour24={props.hour24} />
    </header>
  );
}
export default memo(DashboardHeader);
