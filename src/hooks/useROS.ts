import { useState, useEffect, useCallback } from "react";
import rosbridge from "@/lib/rosbridge";
import { getRosbridgeUrl } from "@/lib/rosConfig";
import type { ROSCallback } from "@/types/ros";

interface UseROSOptions {
  url?: string;
  autoConnect?: boolean;
  onConnected?: () => void;
  onDisconnected?: () => void;
}

function requireAbsoluteTopic(topic: string): string {
  if (!topic.startsWith("/")) {
    throw new Error(`ROS topic must be absolute: ${topic}`);
  }
  return topic;
}

function connectionFailureMessage(url: string): string {
  return `Could not connect to rosbridge at ${url}. Check that the server is running and the address is reachable.`;
}

export function useROS(options: UseROSOptions = {}) {
  const {
    url = getRosbridgeUrl(),
    autoConnect = true,
    onConnected,
    onDisconnected,
  } = options;

  const [isConnected, setIsConnected] = useState(rosbridge.isConnected());
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  const connect = useCallback(async (): Promise<boolean> => {
    setConnectionError(null);
    setIsConnecting(true);

    try {
      await rosbridge.connect(url);
      return true;
    } catch (error) {
      console.warn("ROS connection unavailable:", error);
      setIsConnecting(false);
      setConnectionError(connectionFailureMessage(url));
      return false;
    }
  }, [url]);

  useEffect(() => {
    const handleConnect = () => {
      console.log("ROS connection established");
      setIsConnected(true);
      setIsConnecting(false);
      setConnectionError(null);
      onConnected?.();
    };

    const handleDisconnect = () => {
      console.log("ROS connection lost");
      setIsConnected(false);
      setIsConnecting(false);
      onDisconnected?.();
    };

    rosbridge.on("connected", handleConnect);
    rosbridge.on("disconnected", handleDisconnect);

    if (autoConnect && !rosbridge.isConnected()) {
      console.log("Attempting to connect to ROS...");
      void connect();
    }

    return () => {
      rosbridge.off("connected", handleConnect);
      rosbridge.off("disconnected", handleDisconnect);
    };
  }, [autoConnect, connect, onConnected, onDisconnected]);

  /**
   * Subscribe to a topic.
   *
   * @param topic      Absolute topic path (for example '/carl/encoders').
   * @param messageType ROS message type string.
   * @param callback   Called with each incoming message.
   * @returns Unsubscribe function.
   */
  const subscribe = useCallback(
    <T>(
      topic: string,
      messageType: string,
      callback: ROSCallback<T>,
    ): (() => void) => {
      return rosbridge.subscribe<T>(
        requireAbsoluteTopic(topic),
        messageType,
        callback,
      );
    },
    [],
  );

  /**
   * Publish a message to a topic.
   *
   * @param topic       Absolute topic path.
   * @param messageType ROS message type string.
   * @param message     The message object.
   * @returns true if sent, false if not connected.
   */
  const publish = useCallback(
    <T>(
      topic: string,
      messageType: string,
      message: T,
    ): boolean => {
      return rosbridge.publish<T>(
        requireAbsoluteTopic(topic),
        messageType,
        message,
      );
    },
    [],
  );

  return {
    isConnected,
    isConnecting,
    connectionError,
    subscribe,
    publish,
    connect,
    disconnect: useCallback(() => rosbridge.disconnect(), []),
  };
}

export default useROS;
