# CARL Graphical User Interface

A web dashboard for monitoring CARL vehicle telemetry. It displays encoder feedback, IMU measurements and temperature, connection status, and heartbeat information including vehicle mode, emergency-stop state, and teleoperation readiness. Command publishing is currently disabled while the CARL integration is being validated.

## How It Works

The Next.js and React frontend connects to a ROS 2 rosbridge server over WebSocket. It detects the CARL bridge through its ROS topics and subscribes to `/carl/encoders`, `/carl/imu`, `/carl/imu/temperature`, and `/carl/heartbeat` to update the dashboard in real time.

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

Open [http://localhost:3000](http://localhost:3000). By default, the dashboard connects to rosbridge at `ws://localhost:9090` when opened locally. Without the CARL backend, the GUI opens but live telemetry remains unavailable.

## License

[MIT](LICENSE)

## Acknowledgments

This project is based on [ROSViz Web](https://github.com/prakash-aryan/rosviz-web) by [Prakash Aryan](https://github.com/prakash-aryan), adapted for CARL.
