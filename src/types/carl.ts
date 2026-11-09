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

/** Standard sensor_msgs IMU/temperature messages, in the sensor frame. */
export interface ImuMessage {
  header: Ros2Header;
  linear_acceleration: { x: number; y: number; z: number };
  angular_velocity: { x: number; y: number; z: number };
  orientation: { x: number; y: number; z: number; w: number };
  orientation_covariance: number[];
}
export interface ImuTemperatureMessage {
  header: Ros2Header;
  temperature: number;
  variance: number;
}
export interface StringMessage { data: string; }

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

/** Read-only steering feedback. Angle is meaningful only when valid and calibrated. */
export interface CarlSteeringAngleMessage {
  header: Ros2Header;
  raw_adc: number;
  sequence: number;
  status: number;
  valid: boolean;
  calibrated: boolean;
  sensor_voltage: number;
  absolute_angle_rad: number;
  angle_rad: number;
}
