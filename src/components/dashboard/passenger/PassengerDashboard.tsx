'use client';

import { memo, useState, type ReactNode } from 'react';
import { Activity, CarFront, ChartNoAxesColumnIncreasing,
  ChevronRight, Cpu, Expand, Info, Settings, Thermometer,
  type LucideIcon } from 'lucide-react';
import { HEALTH_LABELS, sanitizeDashboardData, speedValue, type DashboardData, type Health, type Page } from '@/lib/passenger/dashboard';

import BatteryIcon from './BatteryIcon';
import DashboardClock from './DashboardClock';
import './passenger-dashboard.css';

const NAV: { page: Page; icon: LucideIcon }[] = [
  { page: 'Drive', icon: CarFront }, { page: 'Telemetry', icon: ChartNoAxesColumnIncreasing },
  { page: 'System', icon: Settings }
];

function Pedal({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 28 32" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M11 2h13l-7 27H4L11 2Z" /><path d="m13 8 6-2M11 15l6-2M9 22l6-2M3 30h17" />
  </svg>;
}

function HealthDot({ value }: { value: Health }) {
  return <span className={`health-dot ${value}`} aria-hidden="true" />;
}

function StatusIndicator({ icon, label, health, accessibleLabel }: {
  icon: ReactNode; label: string; health?: Health; accessibleLabel: string;
}) {
  return <span className="status-indicator" role="img" aria-label={accessibleLabel}>
    {icon}{health && <HealthDot value={health} />}<span>{label}</span>
  </span>;
}

function Row({ label, value, note }: { label: string; value: ReactNode; note?: string }) {
  return <div className="detail-row"><div><span>{label}</span>{note && <small>{note}</small>}</div><strong>{value}</strong></div>;
}

function HealthText({ value }: { value: Health }) {
  return <span className="health-text"><HealthDot value={value} />{HEALTH_LABELS[value]}</span>;
}

export interface PassengerDashboardProps {
  data: DashboardData;
  connectionError?: string | null;
  onReconnect?: () => void;
  isConnecting?: boolean;
}

/** No ROS imports, network calls or command publishing. All readings arrive through props. */
function PassengerDashboard({ data: rawData, connectionError, onReconnect, isConnecting = false }: PassengerDashboardProps) {
  const data = sanitizeDashboardData(rawData);
  const [page, setPage] = useState<Page>('Drive');
  const [unit, setUnit] = useState<'km/h' | 'mph'>('km/h');
  const [referenceClock, setReferenceClock] = useState(false);
  const [hour24, setHour24] = useState(true);
  const [fullscreenError, setFullscreenError] = useState('');

  const speed = speedValue(data, unit);
  const healthyConnection = data.connection === 'online';
  const heartbeatLabel = data.heartbeat === 'online' ? 'Live' : HEALTH_LABELS[data.heartbeat];
  const throttle = healthyConnection ? data.throttle : null;
  const temperature = healthyConnection ? data.ambientC : null;
  const battery = healthyConnection ? data.batteryPercent : null;
  const statusDescription = (name: string, value: Health) => `${name}: ${HEALTH_LABELS[value]}${data.sample ? ' (sample status)' : ''}`;

  return <div className="prototype-stage">
    <div className="passenger-dashboard" data-page={page}>
      <header className="top-bar">
        <div className="brand" aria-label="CARL, Autonomous Systems Laboratory">
          <span className="wordmark">CARL</span><span className="brand-divider" />
          <span className="laboratory">Autonomous<br />Systems<br />Laboratory</span>
        </div>
        <div className="status-strip" aria-label="Vehicle status indicators">
          <StatusIndicator icon={<Activity />} label={heartbeatLabel} health={data.heartbeat} accessibleLabel={statusDescription('Heartbeat', data.heartbeat)} />
          <StatusIndicator icon={<Pedal />} label={`Throttle ${throttle?.toLowerCase() ?? '—'}`} health={throttle ? data.throttleFaults || data.estopActive ? 'fault' : 'online' : 'unknown'} accessibleLabel={`Throttle status: ${throttle ?? 'Unavailable'}`} />
          <StatusIndicator icon={<Cpu />} label="THR" health={data.throttleController} accessibleLabel={statusDescription('Throttle Teensy', data.throttleController)} />
          <StatusIndicator icon={<Cpu />} label="STR" health={data.steeringController} accessibleLabel={statusDescription('Steering Teensy', data.steeringController)} />
          <StatusIndicator icon={<Thermometer />} label={temperature === null ? '— °C' : `${temperature} °C`} accessibleLabel={`Ambient temperature: ${temperature === null ? 'Sensor planned' : `${temperature} degrees Celsius, sample`}`} />
          <StatusIndicator icon={<BatteryIcon percent={battery} />} label={battery === null ? '— %' : `${battery} %`} accessibleLabel={`Battery: ${battery === null ? 'BMS planned' : `${battery} percent, sample`}`} />
        </div>
        <DashboardClock reference={referenceClock} hour24={hour24} />
      </header>

      <main className="main-area" id="main-content">
        {page === 'Drive' && <section className="drive-view" aria-label="Passenger overview">
          {!healthyConnection && <div className="connection-notice" role="status"><Info />Connection unavailable · vehicle status unknown</div>}
          {healthyConnection && data.heartbeat === 'stale' && <div className="connection-notice stale" role="status"><Info />Heartbeat stale · waiting for fresh vehicle data</div>}
          <div className="speed-display">
            <div className="speed-number" aria-label={speed === null ? 'Speed unavailable' : `Estimated speed ${speed} ${unit}`}>
              {speed === null ? <span className="speed-dash" /> : speed}
            </div>
            <div className="speed-unit">{unit}</div>
            <div className="speed-baseline" />
            <div className="speed-caption">Speed estimate <span>·</span> {speed === null ? 'Planned' : data.sample ? 'Sample' : 'Estimated'}</div>
          </div>
        </section>}

        {page === 'Telemetry' && <section className="page-content telemetry-page" aria-labelledby="telemetry-title" tabIndex={0}>
          <div className="page-heading"><div><p className="eyebrow">VEHICLE STATUS & DATA</p><h1 id="telemetry-title">Telemetry</h1></div><span className="sample-label">{data.sample ? 'Sample data only' : 'Vehicle telemetry'}</span></div>
          <section className="telemetry-group" aria-labelledby="health-title">
            <h2 className="group-title" id="health-title">System health</h2>
            <div className="columns"><section className="detail-section"><h3>Vehicle link</h3>
              <Row label="Rosbridge" value={<HealthText value={data.connection} />} />
              <Row label="CARL bridge endpoints" value={data.bridgePresence ?? '—'} />
              <Row label="Heartbeat" value={<HealthText value={data.heartbeat} />} />
              <Row label="Vehicle mode" value={data.vehicleMode ?? '—'} />
              <Row label="Emergency stop" value={data.estopActive === null ? '—' : data.estopActive ? 'Active' : 'Clear'} />
              <Row label="Teleop link" value={data.teleopReady === null ? '—' : data.teleopReady ? 'Ready' : 'Not ready'} />
              <p className="section-note">Controller health requires fresh, independent evidence. A connected ROS link alone is insufficient.</p>
            </section><section className="detail-section"><h3>Controllers</h3>
              <Row label="Throttle Teensy" value={<HealthText value={data.throttleController} />} />
              <Row label="Steering Teensy" value={<HealthText value={data.steeringController} />} />
              <p className="section-note">Controller indicators require independent health feedback. GUI command publishing is disabled.</p>
            </section></div>
          </section>
          <section className="telemetry-group" aria-labelledby="vehicle-data-title">
            <h2 className="group-title" id="vehicle-data-title">Vehicle telemetry</h2>
            <div className="columns">
              <section className="detail-section"><h3>Motion & steering</h3>
                <Row label="Estimated speed" value={speed === null ? '—' : `${speed} ${unit}`} note={speed === null ? 'Estimator planned' : 'Illustrative reading'} />
                <Row label="Rear left encoder" value={data.encoderLeft?.toLocaleString() ?? '—'} note="/carl/encoders · counts" />
                <Row label="Steering angle" value={data.steeringAngleDeg === null ? '—' : `${data.steeringAngleDeg.toFixed(1)} °`} note="/carl/steering_angle · valid + calibrated only" />
                <Row label="Steering sensor" value={data.steeringValid === null ? 'Unavailable' : data.steeringValid ? data.steeringCalibrated ? 'Valid · calibrated' : 'Valid · uncalibrated' : 'Invalid'} />
                <Row label="Rear right encoder" value={data.encoderRight?.toLocaleString() ?? '—'} note="/carl/encoders · counts" />
              </section>
              <section className="detail-section"><h3>Vehicle</h3>
                <Row label="Throttle state" value={throttle ?? '—'} note="/carl/throttle_status" />
                <Row label="Heartbeat counter" value={data.heartbeatCounter ?? '—'} note="/carl/heartbeat" />
              </section>
            </div>
            <div className="detail-section command-interfaces"><h3>Command interfaces</h3>
              <Row label="Throttle command" value="Read only" note="/carl/throttle_cmd · carl_msgs/msg/CarlThrottleCmd · GUI write disabled" />
              <Row label="Emergency stop" value="Read only" note="/carl/estop · carl_msgs/msg/CarlEstop · GUI write disabled" />
            </div>
            <div className="columns additional-readings">
              <section className="detail-section"><h3>Environment & energy</h3>
                <Row label="Ambient temperature" value={temperature === null ? '—' : `${temperature} °C`} note={temperature === null ? 'Sensor planned' : undefined} />
                <Row label="Battery charge" value={battery === null ? '—' : `${battery} %`} note={battery === null ? 'BMS planned' : undefined} />
              </section>
              <section className="detail-section"><h3>Throttle feedback</h3>
                <Row label="Fault flags" value={data.throttleFaults ?? '—'} />
                <Row label="Applied left" value={data.appliedLeft === null ? '—' : `${(data.appliedLeft * 100).toFixed(1)} %`} />
                <Row label="Applied right" value={data.appliedRight === null ? '—' : `${(data.appliedRight * 100).toFixed(1)} %`} />
              </section>
            </div>
          </section>
        </section>}

        {page === 'System' && <section className="page-content" aria-labelledby="system-title">
          <div className="page-heading"><div><p className="eyebrow">PASSENGER DISPLAY</p><h1 id="system-title">System</h1></div></div>
          {onReconnect && <div className="connection-settings" role={connectionError ? 'alert' : undefined}><p className="section-note">{connectionError ?? (healthyConnection ? 'Rosbridge connected' : 'Rosbridge disconnected')}</p><button className="reconnect-button" disabled={isConnecting || healthyConnection} onClick={onReconnect}>{isConnecting ? 'Connecting…' : healthyConnection ? 'Connected' : 'Retry connection'}</button></div>}
          <div className="columns"><section className="detail-section"><h2>Appearance</h2>
            <div className="setting-row"><span>Speed units</span><div className="segmented">{(['km/h', 'mph'] as const).map(value => <button key={value} aria-pressed={unit === value} onClick={() => setUnit(value)}>{value}</button>)}</div></div>
            <label className="setting-row"><span>24-hour clock</span><input type="checkbox" role="switch" checked={hour24} onChange={e => setHour24(e.target.checked)} /></label>
            <label className="setting-row"><span>Use concept date & time</span><input type="checkbox" role="switch" checked={referenceClock} onChange={e => setReferenceClock(e.target.checked)} /></label>
          </section><section className="detail-section"><h2>Screen</h2>
            <button className="action-row" onClick={async () => {
              try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }
              catch { setFullscreenError('Fullscreen is unavailable in this browser. Open the prototype in a separate browser window.'); }
            }}><Expand /><span>Toggle fullscreen</span><ChevronRight /></button>
            {fullscreenError && <p className="section-note" role="status">{fullscreenError}</p>}
            <p className="section-note">Designed at 1024 × 600. Layout scales proportionally on other landscape displays. Preferences last for this preview session.</p>
          </section></div>
        </section>}

        <div className="view-footer"><span className="footer-brand">CARL <i /> <span>PASSENGER DISPLAY</span></span><span className="preview-disclaimer">{data.sample ? 'Preview · sample data' : 'Vehicle telemetry'}</span></div>
      </main>

      <nav className="floating-dock" aria-label="Main navigation">{NAV.map(({ page: next, icon: Icon }) =>
        <button key={next} className={`dock-button ${page === next ? 'selected' : ''}`} aria-current={page === next ? 'page' : undefined} onClick={() => setPage(next)}><Icon strokeWidth={1.65} aria-hidden="true" /><span>{next}</span></button>
      )}</nav>


    </div>
  </div>;
}

export default memo(PassengerDashboard);
