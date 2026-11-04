'use client';

import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import rosbridge, { DISCONNECTED, type SubscriptionOptions } from '@/lib/rosbridge';
import { getRosbridgeUrl } from '@/lib/rosConfig';
import type { ROSCallback } from '@/types/ros';

interface UseROSOptions {
  url?: string;
  autoConnect?: boolean;
  onConnected?: () => void;
  onDisconnected?: () => void;
}

/** All consumers observe the same immutable connection snapshot and socket. */
export function useROS(options: UseROSOptions = {}) {
  const { url = getRosbridgeUrl(), autoConnect = true } = options;
  const callbacks = useRef(options);
  callbacks.current = options;
  const state = useSyncExternalStore(rosbridge.subscribeConnection, rosbridge.getSnapshot, () => DISCONNECTED);

  const connect = useCallback(async (): Promise<boolean> => {
    // A rejected subscription can leave an otherwise healthy socket open.
    // An explicit retry must create fresh subscriptions in that case too.
    if (rosbridge.isConnected() && rosbridge.getSnapshot().error) rosbridge.disconnect();
    try { await rosbridge.connect(url); return rosbridge.isConnected(); }
    catch { return false; } // The shared snapshot carries the actionable error.
  }, [url]);

  useEffect(() => {
    const release = rosbridge.retain();
    const connected = () => callbacks.current.onConnected?.();
    const disconnected = () => callbacks.current.onDisconnected?.();
    const online = () => { if (autoConnect && !rosbridge.isConnected()) void connect(); };
    rosbridge.on('connected', connected).on('disconnected', disconnected);
    window.addEventListener('online', online);
    if (autoConnect) void connect();
    return () => {
      rosbridge.off('connected', connected).off('disconnected', disconnected);
      window.removeEventListener('online', online);
      release();
    };
  }, [autoConnect, connect]);

  const subscribe = useCallback(<T>(topic: string, messageType: string, callback: ROSCallback<T>, settings?: SubscriptionOptions) =>
    rosbridge.subscribe(topic, messageType, callback, settings), []);
  const publish = useCallback(<T>(topic: string, messageType: string, message: T) =>
    rosbridge.publish(topic, messageType, message), []);
  const disconnect = useCallback(() => rosbridge.disconnect(), []);

  return {
    isConnected: state.status === 'connected',
    isConnecting: state.status === 'connecting',
    connectionError: state.error,
    subscribe, publish, connect, disconnect,
  };
}

export default useROS;
