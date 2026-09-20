/** ROS 2 builtin_interfaces/msg/Time as serialized by rosbridge. */
export interface Ros2Time {
  sec: number;
  nanosec: number;
}

/** ROS 2 std_msgs/msg/Header as serialized by rosbridge. */
export interface Ros2Header {
  stamp: Ros2Time;
  frame_id: string;
}

export interface CarlEncoderFeedbackMessage {
  header: Ros2Header;
  rear_left_counts: number;
  rear_right_counts: number;
}

export type CarlThrottleState = 0 | 1 | 2 | 3 | 4;

export interface CarlThrottleStatusMessage {
  header: Ros2Header;
  state: CarlThrottleState;
  faults: number;
  applied_left: number;
  applied_right: number;
}

export type CarlHeartbeatMode = 0 | 1 | 2;

export interface CarlHeartbeatMessage {
  header: Ros2Header;
  counter: number;
  flags: number;
  mode: CarlHeartbeatMode;
}

export interface CarlThrottleCommandMessage {
  header: Ros2Header;
  front_left: number;
  front_right: number;
  rear_left: number;
  rear_right: number;
}

export type CarlEstopReason = 0 | 1;

export interface CarlEstopMessage {
  header: Ros2Header;
  reason: CarlEstopReason;
}
