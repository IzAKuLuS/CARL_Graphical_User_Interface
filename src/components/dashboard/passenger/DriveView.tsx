import { memo } from 'react';
import { Info } from 'lucide-react';
import type { Health } from '../../../lib/passenger/dashboard';

interface DriveProps {
  healthyConnection: boolean;
  heartbeat: Health;
  speed: string | null;
  unit: string;
  sample: boolean;
}

/** No dependency on encoder counters or other off-screen telemetry. */
function DriveView({ healthyConnection, heartbeat, speed, unit, sample }: DriveProps) {
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
        <div className="speed-caption">
          Speed estimate <span>·</span> {speed === null ? 'Planned' : sample ? 'Sample' : 'Estimated'}
        </div>
      </div>
    </section>
  );
}
export default memo(DriveView);
