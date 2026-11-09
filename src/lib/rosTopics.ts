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
  ImuMessage, ImuTemperatureMessage, StringMessage,
} from "../types/carl";

export interface TopicEntry<TMessage = unknown> {
  path: string;
  type: string;
  /** Type-only association; this property is not present at runtime. */
  readonly __message?: TMessage;
}

export interface CarlTopicMessageMap {
  imu: ImuMessage;
  imuTemperature: ImuTemperatureMessage;
  imuDiagnostics: StringMessage;
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
  imu: { path: "/carl/imu", type: "sensor_msgs/msg/Imu" },
  imuTemperature: { path: "/carl/imu/temperature", type: "sensor_msgs/msg/Temperature" },
  imuDiagnostics: { path: "/carl/imu/diagnostics", type: "std_msgs/msg/String" },
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
