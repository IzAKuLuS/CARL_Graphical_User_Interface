import { memo, useState } from 'react';
import { ChevronRight, Expand } from 'lucide-react';

interface SystemProps {
  healthyConnection: boolean;
  connectionError?: string | null;
  onReconnect?: () => void;
  isConnecting: boolean;
  unit: 'km/h' | 'mph';
  setUnit: (unit: 'km/h' | 'mph') => void;
  hour24: boolean;
  setHour24: (value: boolean) => void;
  referenceClock: boolean;
  setReferenceClock: (value: boolean) => void;
}

function SystemView({ healthyConnection, connectionError, onReconnect, isConnecting,
  unit, setUnit, hour24, setHour24, referenceClock, setReferenceClock }: SystemProps) {
  const [fullscreenError, setFullscreenError] = useState('');
  const connectionLabel = connectionError ?? (healthyConnection ? 'Rosbridge connected' : 'Rosbridge disconnected');
  const canRetry = !isConnecting && (!healthyConnection || !!connectionError);
  const retryLabel = isConnecting ? 'Connecting…' : canRetry ? 'Retry connection' : 'Connected';

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
      setFullscreenError('');
    } catch {
      setFullscreenError('Fullscreen is unavailable in this browser. Open the dashboard in a separate browser window.');
    }
  }

  return (
    <section className="page-content" aria-labelledby="system-title">
      <div className="page-heading">
        <div><p className="eyebrow">PASSENGER DISPLAY</p><h1 id="system-title">System</h1></div>
      </div>
      {onReconnect && (
        <div className="connection-settings" role={connectionError ? 'alert' : undefined}>
          <p className="section-note">{connectionLabel}</p>
          <button className="reconnect-button" disabled={!canRetry} onClick={onReconnect}>
            {retryLabel}
          </button>
        </div>
      )}
      <div className="columns">
        <section className="detail-section">
          <h2>Appearance</h2>
          <div className="setting-row">
            <span>Speed units</span>
            <div className="segmented">
              {(['km/h', 'mph'] as const).map(value => (
                <button key={value} aria-pressed={unit === value} onClick={() => setUnit(value)}>{value}</button>
              ))}
            </div>
          </div>
          <label className="setting-row">
            <span>24-hour clock</span>
            <input type="checkbox" role="switch" checked={hour24} onChange={event => setHour24(event.target.checked)} />
          </label>
          <label className="setting-row">
            <span>Use concept date & time</span>
            <input type="checkbox" role="switch" checked={referenceClock} onChange={event => setReferenceClock(event.target.checked)} />
          </label>
        </section>
        <section className="detail-section">
          <h2>Screen</h2>
          <button className="action-row" onClick={toggleFullscreen}>
            <Expand /><span>Toggle fullscreen</span><ChevronRight />
          </button>
          {fullscreenError && <p className="section-note" role="status">{fullscreenError}</p>}
          <p className="section-note">
            Designed at 1024 × 600. Layout scales proportionally on other landscape displays.
            Preferences last for this session.
          </p>
        </section>
      </div>
    </section>
  );
}
export default memo(SystemView);
