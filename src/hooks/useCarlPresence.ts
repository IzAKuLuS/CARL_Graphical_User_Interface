import { useEffect, useState } from "react";
import rosbridge from "@/lib/rosbridge";
import { CARL_TOPICS } from "@/lib/rosTopics";
import { useROS } from "./useROS";

interface TopicsResponse {
  topics?: string[];
}

export type CarlConnectionState =
  | "rosbridge-disconnected"
  | "checking"
  | "carl-bridge-unavailable"
  | "carl-available";

const POLL_INTERVAL_MS = 5000;
const REQUIRED_TOPICS = [
  CARL_TOPICS.encoders.path,
  CARL_TOPICS.throttleStatus.path,
  CARL_TOPICS.heartbeat.path,
];

/**
 * Detect the single CARL bridge from its ROS graph endpoints.
 *
 * This confirms that the CARL bridge node has created its telemetry topics.
 * It does not prove that fresh firmware telemetry is arriving; heartbeat
 * freshness will be tracked separately when live telemetry is displayed.
 */
export function useCarlPresence(): CarlConnectionState {
  const { isConnected } = useROS();
  const [state, setState] = useState<CarlConnectionState>(
    isConnected ? "checking" : "rosbridge-disconnected",
  );

  useEffect(() => {
    if (!isConnected) {
      setState("rosbridge-disconnected");
      return;
    }

    let cancelled = false;

    const discoverCarl = async () => {
      try {
        const response = await rosbridge.callService<
          Record<string, never>,
          TopicsResponse
        >(
          "/rosapi/topics",
          "rosapi_msgs/srv/Topics",
          {},
          5000,
        );

        if (cancelled) return;

        const availableTopics = new Set(response.topics ?? []);
        const hasCarlBridge = REQUIRED_TOPICS.every((topic) =>
          availableTopics.has(topic),
        );

        setState(
          hasCarlBridge ? "carl-available" : "carl-bridge-unavailable",
        );
      } catch (error) {
        if (!cancelled) {
          console.warn("[useCarlPresence] CARL discovery failed:", error);
          setState("carl-bridge-unavailable");
        }
      }
    };

    setState("checking");
    void discoverCarl();
    const interval = window.setInterval(discoverCarl, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [isConnected]);

  return state;
}

export default useCarlPresence;
