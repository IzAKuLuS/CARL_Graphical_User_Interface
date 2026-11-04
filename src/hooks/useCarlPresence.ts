'use client';

import { useEffect, useState } from 'react';
import rosbridge from '@/lib/rosbridge';
import { CARL_TOPICS } from '@/lib/rosTopics';

export type CarlConnectionState =
  | 'rosbridge-disconnected'
  | 'checking'
  | 'carl-bridge-unavailable'
  | 'carl-available';

const POLL_INTERVAL_MS = 5_000;
const REQUIRED_TOPICS = [CARL_TOPICS.encoders.path, CARL_TOPICS.throttleStatus.path, CARL_TOPICS.heartbeat.path];

/** Graph discovery confirms endpoints, independently of firmware heartbeat freshness. */
export function useCarlPresence(isConnected: boolean): CarlConnectionState {
  const [state, setState] = useState<CarlConnectionState>('rosbridge-disconnected');

  useEffect(() => {
    if (!isConnected) {
      setState('rosbridge-disconnected');
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const discover = async () => {
      try {
        const response = await rosbridge.callService<Record<string, never>, { topics?: unknown }>(
          '/rosapi/topics', 'rosapi_msgs/srv/Topics', {}, POLL_INTERVAL_MS);
        if (cancelled) return;
        const topics = response?.topics;
        const available = Array.isArray(topics) && REQUIRED_TOPICS.every(topic => topics.includes(topic));
        setState(available ? 'carl-available' : 'carl-bridge-unavailable');
      } catch {
        if (!cancelled) setState('carl-bridge-unavailable');
      } finally {
        // Schedule after completion: slow discovery cannot accumulate calls or
        // allow an older reply to overwrite the result of a newer request.
        if (!cancelled) timer = setTimeout(discover, POLL_INTERVAL_MS);
      }
    };
    setState('checking');
    void discover();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [isConnected]);

  return isConnected ? state : 'rosbridge-disconnected';
}

export default useCarlPresence;
