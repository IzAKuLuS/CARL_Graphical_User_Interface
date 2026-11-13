import { memo } from 'react';
import { Info } from 'lucide-react';
import type { Health } from '../../../lib/passenger/dashboard';

interface DriveProps {
  healthyConnection: boolean;
  heartbeat: Health;
  speed: string | null;
  unit: string;
  onStopCarl?: () => void;
}

/** No dependency on encoder counters or other off-screen telemetry. */
function DriveView({ healthyConnection, heartbeat, speed, unit, onStopCarl }: DriveProps) {
  const speedLabel = speed === null ? 'Speed unavailable' : `Estimated speed ${speed} ${unit}`;
  return (
    <section className="drive-view" aria-label="Passenger overview">
      {!healthyConnection && (
        <div className="connection-notice" role="status">
          <Info />Connection unavailable · vehicle status unknown
        </div>
      )}
      {healthyConnection && heartbeat === 'stale' && (
        <div className="connection-notice stale" role="status">
          <Info />Heartbeat stale · waiting for fresh vehicle data
        </div>
      )}
      <div className="speed-display">
        <div className="speed-number" aria-label={speedLabel}>
          {speed === null ? <span className="speed-dash" /> : speed}
        </div>
        <div className="speed-unit">{unit}</div>
        <div className="speed-baseline" />
        <div className="speed-caption">Speed estimate</div>
      </div>
      {onStopCarl && <button type="button" className="drive-stop" onClick={onStopCarl}>Stop CARL</button>}
    </section>
  );
}
export default memo(DriveView);
