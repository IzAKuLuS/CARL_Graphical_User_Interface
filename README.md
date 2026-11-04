# CARL Graphical User Interface

A web dashboard for monitoring CARL vehicle telemetry. The passenger display is designed for a 1024 × 600 touchscreen, with Drive, scrollable Telemetry, and System settings. It displays encoder counts, throttle feedback, steering feedback when valid and calibrated, ROS connection status, heartbeat, vehicle mode, emergency-stop state, and teleoperation readiness. Command publishing is currently disabled while the CARL integration is being validated.

## How It Works

The Next.js and React frontend connects to a ROS 2 rosbridge server over WebSocket. It detects the CARL bridge through its ROS topics and subscribes to `/carl/encoders`, `/carl/heartbeat`, `/carl/throttle_status`, and `/carl/steering_angle` to update the dashboard in real time.

## Run Locally

Install Node.js 22.9 or newer and npm. Docker is not required. For live telemetry, run the CARL bridge and a rosbridge server on the same ROS domain, with rosbridge accessible on port `9090`.

```bash
git clone https://github.com/IzAKuLuS/CARL_Graphical_User_Interface.git
cd CARL_Graphical_User_Interface
npm ci

# Optional: set this if rosbridge runs on another computer.
# export NEXT_PUBLIC_ROSBRIDGE_URL=ws://192.168.1.50:9090
npm run build
npm start -- --hostname 127.0.0.1
```

Open [http://localhost:3000](http://localhost:3000) in the browser on CARL’s host computer and use fullscreen mode for the passenger display. Keep the server running while the display is in use. By default, the dashboard connects to rosbridge at `ws://localhost:9090` when opened locally. Without the CARL backend, the GUI opens but live telemetry remains unavailable.

For development with hot reload, use `npm run dev` instead of the build/start commands. Set `NEXT_PUBLIC_ROSBRIDGE_URL` before building if a different backend address is needed.

## Joystick Test

Run the normal CARL bridge and joystick application, plus rosbridge, in the same ROS domain and with the CARL message workspace sourced. The GUI reads hardware feedback independently of joystick commands and does not publish vehicle commands. For a local browser, the default WebSocket endpoint is `ws://localhost:9090`.

During your joystick test, open Telemetry and watch left/right encoder counts, throttle state, applied outputs, heartbeat and mode. Values update without refreshing the page, at up to 10 display updates per second. Expired readings clear even if the socket remains connected. Connection errors and Retry connection are under System. Existing legacy page URLs still redirect to Drive.

Date/time comes from the local browser computer's OS clock and timezone; live time is the default. Correct CARL's OS clock/timezone if needed. Speed remains unavailable until a velocity estimator exists. Ambient temperature and battery percentage remain unavailable until their sensor/BMS inputs exist. Independent controller status remains Unknown without confirmed health data. IMU inputs are not subscribed to or displayed.

The font and icons are bundled locally. No runtime internet connection or Docker is required. The responsive layout fills the native 1024 × 600 aspect ratio; use browser fullscreen mode on the passenger display.

## Checks

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

The sample-data WebSocket fixture in `tests/mock-rosbridge.cjs` binds only to localhost port 9192 and never opens hardware transports. For development smoke tests, build with `CARL_GUI_TEST_BUILD=1 NEXT_PUBLIC_ROSBRIDGE_URL=ws://127.0.0.1:9192 npm run build`, then run `CARL_GUI_TEST_BUILD=1 npm start -- --hostname 127.0.0.1 --port 3212`. This uses `.next-test` and cannot replace the normal `.next` deployment build. Keep fixture settings out of the vehicle deployment.

## License

[MIT](LICENSE)

## Acknowledgments

This project is based on [ROSViz Web](https://github.com/prakash-aryan/rosviz-web) by [Prakash Aryan](https://github.com/prakash-aryan), adapted for CARL.
