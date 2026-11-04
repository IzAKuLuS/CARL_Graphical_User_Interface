/**
 * Absolute ROS 2 topic catalog for the single CARL vehicle.
 *
 * Topic paths include the /carl namespace. Callers must pass these paths to
 * useROS unchanged; the frontend never constructs a robot namespace.
 */
import type {
  CarlEncoderFeedbackMessage,
  CarlSteeringAngleMessage,
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
  steeringAngle: CarlSteeringAngleMessage;
  throttleStatus: CarlThrottleStatusMessage;
  heartbeat: CarlHeartbeatMessage;
  throttleCommand: CarlThrottleCommandMessage;
  estop: CarlEstopMessage;
}

type CarlTopicCatalog = {
  [Key in keyof CarlTopicMessageMap]: TopicEntry<CarlTopicMessageMap[Key]>;
};

export const CARL_TOPICS = {
  steeringAngle: {
    path: "/carl/steering_angle",
    type: "carl_msgs/msg/CarlSteeringAngle",
  },
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
