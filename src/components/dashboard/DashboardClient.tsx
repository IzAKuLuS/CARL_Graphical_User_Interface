'use client';

import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { useCarlPresence } from '@/hooks/useCarlPresence';
import { useROS } from '@/hooks/useROS';
import { createDashboardData } from '@/lib/passenger/dashboard';
import { TelemetrySession } from '@/lib/passenger/telemetry-session';
import PassengerDashboard from './passenger/PassengerDashboard';

const OFFLINE = createDashboardData();
const PRESENCE_LABELS = {
  'rosbridge-disconnected': null,
  checking: 'Checking…',
  'carl-bridge-unavailable': 'Not detected',
  'carl-available': 'Detected',
} as const;

/** React coordinates lifetimes; transport, validation and display scheduling stay independent. */
export default function DashboardClient() {
  const { isConnected, subscribe, connectionError, connect, isConnecting } = useROS();
  const presence = useCarlPresence(isConnected);
  const session = useMemo(() => new TelemetrySession({ subscribe }), [subscribe]);
  const data = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);

  useEffect(() => {
    const visibility = () => session.setVisible(!document.hidden);
    const hide = () => session.setVisible(false);
    visibility();
    session.setConnected(isConnected);
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', hide);
    window.addEventListener('pageshow', visibility);
    return () => {
      session.setConnected(false);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', hide);
      window.removeEventListener('pageshow', visibility);
    };
  }, [isConnected, session]);

  const displayData = useMemo(() => ({
    ...(isConnected ? data : OFFLINE), bridgePresence: PRESENCE_LABELS[presence],
  }), [isConnected, data, presence]);

  return <PassengerDashboard data={displayData} connectionError={connectionError}
    onReconnect={connect} isConnecting={isConnecting} />;
}
