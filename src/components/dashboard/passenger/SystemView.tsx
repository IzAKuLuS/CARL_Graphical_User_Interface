import { memo, useEffect, useState } from 'react';
import { ChevronRight, Expand, LogOut } from 'lucide-react';
import { closeLocalGui } from '../../../lib/close-local-gui';
import Image from 'next/image';

interface SystemProps {
  healthyConnection: boolean;
  connectionError?: string | null;
  onReconnect?: () => void;
  isConnecting: boolean;
  unit: 'km/h' | 'mph';
  setUnit: (unit: 'km/h' | 'mph') => void;
  hour24: boolean;
  setHour24: (value: boolean) => void;
  onStopCarl?: () => void;
  onCloseLocalGui?: () => Promise<void>;
  controlMode?: 'none' | 'joystick' | null;
  operationState?: string;
  onStartJoystick?: () => void;
  onStopJoystick?: () => void;
}

function SystemView({ healthyConnection, connectionError, onReconnect, isConnecting,
  unit, setUnit, hour24, setHour24, onStopCarl, onCloseLocalGui,
  controlMode, operationState, onStartJoystick, onStopJoystick }: SystemProps) {
  const [fullscreenError, setFullscreenError] = useState('');
  const [confirmClose, setConfirmClose] = useState(false);
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState('');
  const [joystickLink, setJoystickLink] = useState<{ url: string; qr: string } | null>(null);
  const [linkError, setLinkError] = useState('');
  const connectionLabel = connectionError ?? (healthyConnection ? 'Rosbridge connected' : 'Rosbridge disconnected');
  const canRetry = !isConnecting && (!healthyConnection || !!connectionError);
  const retryLabel = isConnecting ? 'Connecting…' : canRetry ? 'Retry connection' : 'Connected';

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const response = await fetch('/api/joystick-link', { cache: 'no-store' });
        const result = await response.json() as { url?: string; qr?: string; error?: string };
        if (!active) return;
        if (!response.ok || !result.url || !result.qr) throw new Error(result.error || 'Joystick link unavailable.');
        setJoystickLink({ url: result.url, qr: result.qr });
        setLinkError('');
      } catch (error) {
        if (active) { setJoystickLink(null); setLinkError(error instanceof Error ? error.message : 'Joystick link unavailable.'); }
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 10000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
      setFullscreenError('');
    } catch {
      setFullscreenError('Fullscreen is unavailable in this browser. Open the dashboard in a separate browser window.');
    }
  }

  async function requestCloseLocalGui() {
    setClosing(true);
    setCloseError('');
    try {
      if (onCloseLocalGui) await onCloseLocalGui();
      else await closeLocalGui();
    } catch (error) {
      setCloseError(error instanceof Error ? error.message : 'Could not close the local GUI.');
      setClosing(false);
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
          {onStartJoystick && onStopJoystick && <>
            <h2>Joystick app</h2>
            {joystickLink ? <div className="joystick-qr">
              <Image src={joystickLink.qr} alt="QR code for CARL joystick application" width={180} height={180} unoptimized />
              <span>Scan on another device: {joystickLink.url}</span>
            </div> : <p className="section-note" role="status">{linkError || 'Finding CARL network address…'}</p>}
          </>}
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
        </section>
        <section className="detail-section">
          <h2>Screen</h2>
          {onStopCarl && <button className="action-row" onClick={onStopCarl}><LogOut /><span>Stop CARL</span><ChevronRight /></button>}
          {onStartJoystick && onStopJoystick && <div className="joystick-settings">
            <h3>Joystick control</h3>
            <p className="section-note">Mode: {controlMode === 'joystick' ? 'Joystick control' : 'No Control'}</p>
            <div className="close-gui-buttons">
              <button disabled={operationState !== 'on' || controlMode === 'joystick'} onClick={onStartJoystick}>Start CARL Joystick</button>
              <button disabled={operationState !== 'on' || controlMode !== 'joystick'} onClick={onStopJoystick}>Stop CARL Joystick</button>
            </div>
            {controlMode !== 'joystick' && <p className="section-note">Start CARL Joystick before connecting.</p>}
          </div>}
          <button className="action-row" onClick={toggleFullscreen}>
            <Expand /><span>Toggle fullscreen</span><ChevronRight />
          </button>
          {fullscreenError && <p className="section-note" role="status">{fullscreenError}</p>}
          <button className="action-row" onClick={() => { setConfirmClose(true); setCloseError(''); }}>
            <LogOut /><span>Close local GUI</span><ChevronRight />
          </button>
          {confirmClose && (
            <div className="close-gui-confirmation">
              <p>Stop CARL software, then close this display and its local GUI server?</p>
              <div className="close-gui-buttons">
                <button disabled={closing} onClick={() => setConfirmClose(false)}>Cancel</button>
                <button disabled={closing} onClick={() => void requestCloseLocalGui()}>
                  {closing ? 'Closing…' : 'Close GUI'}
                </button>
              </div>
            </div>
          )}
          {closeError && <p className="section-note" role="alert">{closeError}</p>}
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
