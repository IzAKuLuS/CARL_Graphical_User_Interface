import type { DashboardData } from '../../../lib/passenger/dashboard';
import { Row, HealthText } from './DashboardPrimitives';

interface TelemetryProps { data: DashboardData; speed: string | null; unit: string; }
const countFormatter = new Intl.NumberFormat();
const count = (value: number | null) => value === null ? '—' : countFormatter.format(value);
const percent = (value: number | null) => value === null ? '—' : `${(value * 100).toFixed(1)} %`;

function steeringLabel(data: DashboardData): string {
  if (data.steeringValid === null) return 'Unavailable';
  if (!data.steeringValid) return 'Invalid';
  return data.steeringCalibrated ? 'Valid · calibrated' : 'Valid · uncalibrated';
}

export default function TelemetryView({ data, speed, unit }: TelemetryProps) {
  return (
    <section className="page-content telemetry-page" aria-labelledby="telemetry-title" tabIndex={0}>
      <div className="page-heading">
        <div><p className="eyebrow">VEHICLE STATUS & DATA</p><h1 id="telemetry-title">Telemetry</h1></div>
        <span className="sample-label">{data.sample ? 'Sample data only' : 'Vehicle telemetry'}</span>
      </div>
      <section className="telemetry-group" aria-labelledby="health-title">
        <h2 className="group-title" id="health-title">System health</h2>
        <div className="columns">
          <section className="detail-section">
            <h3>Vehicle link</h3>
            <Row label="Rosbridge" value={<HealthText value={data.connection} />} />
            <Row label="CARL bridge endpoints" value={data.bridgePresence ?? '—'} />
            <Row label="Heartbeat" value={<HealthText value={data.heartbeat} />} />
            <Row label="Vehicle mode" value={data.vehicleMode ?? '—'} />
            <Row label="Emergency stop" value={data.estopActive === null ? '—' : data.estopActive ? 'Active' : 'Clear'} />
            <Row label="Teleop link" value={data.teleopReady === null ? '—' : data.teleopReady ? 'Ready' : 'Not ready'} />
            <p className="section-note">
              Controller health requires fresh, independent evidence. A connected ROS link alone is insufficient.
            </p>
          </section>
          <section className="detail-section">
            <h3>Controllers</h3>
            <Row label="Throttle Teensy" value={<HealthText value={data.throttleController} />} />
            <Row label="Steering Teensy" value={<HealthText value={data.steeringController} />} />
            <p className="section-note">
              THR follows throttle feedback; STR follows steering feedback. GUI command publishing is disabled.
            </p>
          </section>
        </div>
      </section>
      <section className="telemetry-group" aria-labelledby="vehicle-data-title">
        <h2 className="group-title" id="vehicle-data-title">Vehicle telemetry</h2>
        <div className="columns">
          <section className="detail-section">
            <h3>Motion & steering</h3>
            <Row label="Estimated speed" value={speed === null ? '—' : `${speed} ${unit}`}
              note={speed === null ? 'Estimator planned' : 'Illustrative reading'} />
            <Row label="Rear left encoder" value={count(data.encoderLeft)} note="/carl/encoders · counts" />
            <Row label="Steering angle" value={data.steeringAngleDeg === null ? '—' : `${data.steeringAngleDeg.toFixed(1)} °`}
              note="/carl/steering_angle · valid + calibrated only" />
            <Row label="Steering sensor" value={steeringLabel(data)} />
            <Row label="Rear right encoder" value={count(data.encoderRight)} note="/carl/encoders · counts" />
          </section>
          <section className="detail-section">
            <h3>Vehicle</h3>
            <Row label="Throttle state" value={data.throttle ?? '—'} note="/carl/throttle_status" />
            <Row label="Heartbeat counter" value={data.heartbeatCounter ?? '—'} note="/carl/heartbeat" />
          </section>
        </div>
        <div className="detail-section command-interfaces">
          <h3>Command interfaces</h3>
          <Row label="Throttle command" value="Read only" note="/carl/throttle_cmd · carl_msgs/msg/CarlThrottleCmd · GUI write disabled" />
          <Row label="Emergency stop" value="Read only" note="/carl/estop · carl_msgs/msg/CarlEstop · GUI write disabled" />
        </div>
        <div className="columns additional-readings">
          <section className="detail-section">
            <h3>Environment & energy</h3>
            <Row label="Ambient temperature" value={data.ambientC === null ? '—' : `${data.ambientC} °C`}
              note={data.ambientC === null ? 'Sensor planned' : undefined} />
            <Row label="Battery charge" value={data.batteryPercent === null ? '—' : `${data.batteryPercent} %`}
              note={data.batteryPercent === null ? 'BMS planned' : undefined} />
          </section>
          <section className="detail-section">
            <h3>Throttle feedback</h3>
            <Row label="Fault flags" value={data.throttleFaults ?? '—'} />
            <Row label="Applied left" value={percent(data.appliedLeft)} />
            <Row label="Applied right" value={percent(data.appliedRight)} />
          </section>
        </div>
      </section>
    </section>
  );
}
