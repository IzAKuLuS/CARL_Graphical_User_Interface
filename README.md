# CARL Graphical User Interface
> Authored by Isaac Alvarado

A web dashboard for monitoring CARL vehicle telemetry. It displays encoder feedback, IMU measurements and temperature, connection status, and heartbeat information including vehicle mode, emergency-stop state, and teleoperation readiness to the passenger seated within CAR 1. This GUI is designed to be shown on a touchscreen display module aimed at the passenger so that key telemetry is communicated in an intuitive manner. Implemented with Next.js and a React frontend that connects to a ROS 2 rosbridge server over WebSocket. It detects the CARL bridge through its ROS topics and subscribes to `/carl/encoders`, `/carl/imu`, `/carl/imu/temperature`, and `/carl/heartbeat` to update the dashboard in real time.

## Run Locally

Install Node.js 22.9 or newer and npm. For live telemetry, run the CARL bridge and a rosbridge server on the same ROS domain, with rosbridge accessible on port `9090`.

```bash
git clone https://github.com/IzAKuLuS/CARL_Graphical_User_Interface.git
cd CARL_Graphical_User_Interface
npm ci

# Optional: set this if rosbridge runs on another computer.
# export NEXT_PUBLIC_ROSBRIDGE_URL=ws://192.168.1.50:9090
npm run dev
```

## License

[MIT](LICENSE)

## Acknowledgments

This project is based on [ROSViz Web](https://github.com/prakash-aryan/rosviz-web) by [Prakash Aryan](https://github.com/prakash-aryan), adapted for CARL.
