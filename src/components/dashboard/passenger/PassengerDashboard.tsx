'use client';

import { memo, useState } from 'react';
import { CarFront, ChartNoAxesColumnIncreasing, Settings, type LucideIcon } from 'lucide-react';
import { sanitizeDashboardData, speedValue, type DashboardData, type Page } from '../../../lib/passenger/dashboard';
import DashboardHeader from './DashboardHeader';
import DriveView from './DriveView';
import TelemetryView from './TelemetryView';
import SystemView from './SystemView';
import './passenger-dashboard.css';

const NAV: { page: Page; icon: LucideIcon }[] = [
  { page: 'Drive', icon: CarFront },
  { page: 'Telemetry', icon: ChartNoAxesColumnIncreasing },
  { page: 'System', icon: Settings },
];

export interface PassengerDashboardProps {
  data: DashboardData;
  connectionError?: string | null;
  onReconnect?: () => void;
  isConnecting?: boolean;
}

/** Presentation only: readings arrive through props; preferences persist across page navigation. */
function PassengerDashboard({ data: rawData, connectionError, onReconnect, isConnecting = false }: PassengerDashboardProps) {
  const data = sanitizeDashboardData(rawData);
  const [page, setPage] = useState<Page>('Drive');
  const [unit, setUnit] = useState<'km/h' | 'mph'>('km/h');
  const [referenceClock, setReferenceClock] = useState(false);
  const [hour24, setHour24] = useState(true);
  const speed = speedValue(data, unit);
  const healthyConnection = data.connection === 'online';

  return (
    <div className="prototype-stage">
      <div className="passenger-dashboard" data-page={page}>
        <DashboardHeader heartbeat={data.heartbeat} throttle={data.throttle}
          throttleFaults={data.throttleFaults} estopActive={data.estopActive}
          throttleController={data.throttleController} steeringController={data.steeringController}
          ambientC={data.ambientC} batteryPercent={data.batteryPercent} sample={data.sample}
          referenceClock={referenceClock} hour24={hour24} />
        <main className="main-area" id="main-content">
          {page === 'Drive' && (
            <DriveView healthyConnection={healthyConnection} heartbeat={data.heartbeat}
              speed={speed} unit={unit} sample={data.sample} />
          )}
          {page === 'Telemetry' && <TelemetryView data={data} speed={speed} unit={unit} />}
          {page === 'System' && (
            <SystemView healthyConnection={healthyConnection} connectionError={connectionError}
              onReconnect={onReconnect} isConnecting={isConnecting} unit={unit} setUnit={setUnit}
              hour24={hour24} setHour24={setHour24} referenceClock={referenceClock} setReferenceClock={setReferenceClock} />
          )}
          <div className="view-footer">
            <span className="footer-brand">CARL <i /> <span>PASSENGER DISPLAY</span></span>
            <span className="preview-disclaimer">{data.sample ? 'Preview · sample data' : 'Vehicle telemetry'}</span>
          </div>
        </main>
        <nav className="floating-dock" aria-label="Main navigation">
          {NAV.map(({ page: next, icon: Icon }) => (
            <button key={next} className={`dock-button ${page === next ? 'selected' : ''}`}
              aria-current={page === next ? 'page' : undefined} onClick={() => setPage(next)}>
              <Icon strokeWidth={1.65} aria-hidden="true" /><span>{next}</span>
            </button>
          ))}
        </nav>
      </div>
    </div>
  );
}
export default memo(PassengerDashboard);
