/**
 * Absolute ROS 2 topic catalog for the single CARL vehicle.
 *
 * Topic paths include the /carl namespace. Callers must pass these paths to
 * useROS unchanged; the frontend never constructs a robot namespace.
 */
import type {
  CarlEncoderFeedbackMessage,
  CarlEstopMessage,
  CarlHeartbeatMessage,
  CarlThrottleCommandMessage,
  CarlThrottleStatusMessage,
} from "@/types/carl";

export interface TopicEntry<TMessage = unknown> {
  path: string;
  type: string;
  /** Type-only association; this property is not present at runtime. */
  readonly __message?: TMessage;
}

export interface CarlTopicMessageMap {
  encoders: CarlEncoderFeedbackMessage;
  throttleStatus: CarlThrottleStatusMessage;
  heartbeat: CarlHeartbeatMessage;
  throttleCommand: CarlThrottleCommandMessage;
  estop: CarlEstopMessage;
}

type CarlTopicCatalog = {
  [Key in keyof CarlTopicMessageMap]: TopicEntry<CarlTopicMessageMap[Key]>;
};

export const CARL_TOPICS = {
  encoders: {
    path: "/carl/encoders",
    type: "carl_msgs/msg/CarlEncoderFeedback",
  },
  throttleStatus: {
    path: "/carl/throttle_status",
    type: "carl_msgs/msg/CarlThrottleStatus",
  },
  heartbeat: {
    path: "/carl/heartbeat",
    type: "carl_msgs/msg/CarlHeartbeat",
  },
  throttleCommand: {
    path: "/carl/throttle_cmd",
    type: "carl_msgs/msg/CarlThrottleCmd",
  },
  estop: {
    path: "/carl/estop",
    type: "carl_msgs/msg/CarlEstop",
  },
} as const satisfies CarlTopicCatalog;

export type CarlTopicKey = keyof typeof CARL_TOPICS;
export type CarlTopicMessage<Key extends CarlTopicKey> =
  CarlTopicMessageMap[Key];

/**
 * Simulator-only shared topics retained temporarily by dormant legacy
 * components. They are not part of CARL's ROS interface and are not used by
 * the active CARL dashboard.
 */
export const LEGACY_TOPICS = {
  tf: { path: "/tf", type: "tf2_msgs/TFMessage" },
  tfStatic: { path: "/tf_static", type: "tf2_msgs/TFMessage" },
  robotAlerts: { path: "/robot_alerts", type: "std_msgs/String" },
  robotAlertsHistory: {
    path: "/robot_alerts_history",
    type: "std_msgs/String",
  },
  robotAlertsRequestHistory: {
    path: "/robot_alerts_request_history",
    type: "std_msgs/String",
  },
  safetyAutoStop: { path: "/safety_auto_stop", type: "std_msgs/Bool" },
  safetyAutoStopStatus: {
    path: "/safety_auto_stop_status",
    type: "std_msgs/Bool",
  },
} as const satisfies Record<string, TopicEntry>;
