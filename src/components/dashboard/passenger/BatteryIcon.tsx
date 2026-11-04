import { memo } from 'react';
import { batteryColor, batteryReading } from '../../../lib/passenger/dashboard';

/** One SVG rectangle, no animation loop, canvas, images or extra dependency. */
function BatteryIcon({ percent }: { percent: number | null }) {
  const valid = batteryReading(percent);
  return <svg viewBox="0 0 28 24" fill="none" aria-hidden="true" className="battery-icon">
    <rect x="1.5" y="6" width="22" height="12" rx="1.7" stroke="currentColor" strokeWidth="1.7" />
    <path d="M26 10v4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    {valid !== null && <rect data-battery-fill="" x="4" y="8.5" width={17 * valid / 100} height="7" rx=".6" fill={batteryColor(valid)} />}
  </svg>;
}
export default memo(BatteryIcon);
