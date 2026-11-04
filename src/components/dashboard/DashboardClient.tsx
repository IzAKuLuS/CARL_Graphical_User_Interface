'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useCarlPresence } from '@/hooks/useCarlPresence';
import { useROS } from '@/hooks/useROS';
import { CARL_TOPICS } from '@/lib/rosTopics';
import PassengerDashboard from './passenger/PassengerDashboard';
import { DISPLAY_PERIOD_MS, ingest, projectTelemetry, sameDashboard, setConnection, type TelemetryState, type TelemetryTopic } from '@/lib/passenger/telemetry-store';

const TOPICS: TelemetryTopic[] = ['heartbeat', 'throttleStatus', 'encoders', 'steeringAngle'];

/** Replacement entry component. Keeps the existing transport and absolute topic catalog intact. */
export default function DashboardClient() {
  const { isConnected, subscribe, connectionError, connect, isConnecting } = useROS();
  const presence = useCarlPresence();
  const state = useRef<TelemetryState>({ connected: false, samples: {} });
  const [data, setData] = useState(() => projectTelemetry(state.current, 0));

  useEffect(() => {
    const current = state.current;
    setConnection(current, isConnected);
    const flush = () => {
      const next = projectTelemetry(current, performance.now());
      setData(previous => sameDashboard(previous, next) ? previous : next);
    };
    flush();
    if (!isConnected) return;

    let stopped = false;
    // Receive path only validates and replaces latest samples, even for high-rate telemetry.
    // React receives at most 10 snapshots/second; freshness is checked before every snapshot.
    const unsubscribers = TOPICS.map(key => {
      const topic = CARL_TOPICS[key];
      return subscribe<unknown>(topic.path, topic.type, message => {
        if (!stopped) ingest(current, key, message, performance.now());
      });
    });
    let timer: ReturnType<typeof setInterval> | undefined;
    const resume = () => {
      clearInterval(timer);
      flush();
      if (!document.hidden) timer = setInterval(flush, DISPLAY_PERIOD_MS);
    };
    document.addEventListener('visibilitychange', resume);
    resume();
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', resume);
      unsubscribers.forEach(unsubscribe => unsubscribe());
      setConnection(current, false);
    };
  }, [isConnected, subscribe]);

  const displayData = useMemo(() => ({ ...data, bridgePresence: {
    'rosbridge-disconnected': null, 'checking': 'Checking…',
    'carl-bridge-unavailable': 'Not detected', 'carl-available': 'Detected'
  }[presence] }), [data, presence]);
  return <PassengerDashboard data={displayData} connectionError={connectionError}
    onReconnect={() => { void connect(); }} isConnecting={isConnecting} />;
}
