# CARL Graphical User Interface

A web dashboard for monitoring CARL vehicle telemetry. The passenger display is designed for a 1024 × 600 touchscreen, with Drive, scrollable Telemetry, and System settings. It displays encoder counts, throttle feedback, steering feedback when valid and calibrated, ROS connection status, heartbeat, vehicle mode, emergency-stop state, and teleoperation readiness. Command publishing is currently disabled while the CARL integration is being validated.

## How It Works

The Next.js and React frontend connects to a ROS 2 rosbridge server over WebSocket. It detects the CARL bridge through its ROS topics and subscribes to `/carl/encoders`, `/carl/velocity`, `/carl/heartbeat`, `/carl/throttle_status`, `/carl/steering_angle`, `/carl/imu`, `/carl/imu/temperature`, and `/carl/imu/diagnostics` to update the dashboard in real time.

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

### Passenger touchscreen launcher (Linux)

The launcher, icon image, and service templates are included in this repository.
On each computer after cloning, install Node.js, Chromium, and the X11 tools
`xrandr`, `xprop`, and `xkill`; run `npm ci` and
`npm run build`, then run `python3 scripts/install-passenger-launcher.py` once
as the desktop user (without `sudo`). This creates a **CARL Passenger GUI**
desktop icon and an on-demand user service using that clone's actual path.
Re-run the installer if the clone moves or the Python installation changes.
Clicking the icon starts the production GUI server on `127.0.0.1:3215` and opens
a dedicated Chromium kiosk window on the one active **1024 × 600 landscape**
display. The launcher checks the live monitor layout each time and stops with an
error if that display is absent or ambiguous; it does not change the resolution,
orientation, or position of other monitors. On this laptop the touchscreen is
`HDMI-1` at `1024x600+0+0`. Set `CARL_TOUCHSCREEN_OUTPUT` in the launcher
environment if a future setup has more than one matching display.


## Runtime and maintenance

The live path has four explicit layers:

| Layer | Responsibility |
| --- | --- |
| `src/lib/rosbridge.ts` | One shared WebSocket, connection state, subscriptions, bounded service requests and failure cleanup |
| `src/lib/passenger/telemetry-store.ts` | Validate/copy scalar readings and derive display values using monotonic freshness deadlines |
| `src/lib/passenger/telemetry-session.ts` | Own subscriptions, discard obsolete callbacks, retain latest samples, and schedule display snapshots |
| Passenger view components | Render snapshots and keep local display preferences; they make no ROS calls |

The ROS hook observes an immutable shared connection snapshot with React's
`useSyncExternalStore`; individual components do not maintain competing socket
state. The last ROS consumer unmounting closes the connection and cancels pending
work. Old sockets cannot deliver messages or complete service calls for a newer
session. Intentional disconnect cancels reconnection; unexpected loss retries
with jittered exponential backoff, capped at 30 seconds. Opening a socket has an
8-second deadline. A peer that sends no valid protocol envelopes for 15 seconds
is replaced, even when the operating system has not closed its TCP connection.
Graph-discovery replies keep an otherwise quiet connection alive.

Subscriptions request at most 10 messages/second per topic with a one-message
server queue. The seven current streams therefore have a 70-message/second
telemetry budget. This uses rosbridge's documented `throttle_rate` and
`queue_length` fields; it does not reduce the vehicle's ROS publisher rates.
See the [rosbridge subscription protocol](https://github.com/RobotWebTools/rosbridge_suite/blob/ros2/ROSBRIDGE_PROTOCOL.md#434-subscribe-c--s).
The receiver copies only validated scalar fields and retains at most seven
samples. Extra headers/payload fields cannot accumulate in the store. Display
updates run at most every 100 ms, skip unchanged snapshots, and still expire
readings when no new messages arrive. Heartbeat/throttle/encoders expire after
one second; steering after 250 ms. IMU motion expires after 500 ms, temperature
after 1 second and diagnostics after 2.5 seconds. These are receive-time freshness checks,
not a guarantee about source age when clocks or upstream transports differ.

Hidden pages unsubscribe telemetry, discard stored readings and stop the display
timer. Returning requires fresh samples. The connection and one non-overlapping
discovery request every five seconds after completion remain available. The
header, Drive and System views are memoized with relevant scalar props, so
off-screen encoder counts do not force their rendering. The clock updates once
per minute. One locally bundled variable font is shared throughout the display.

Transport limits are named in `TRANSPORT_LIMITS`: 1 MiB of JSON characters per
message, 256 KiB of pending outbound bytes, and 32 pending service requests.
Service deadlines must be finite and at most 60 seconds; disconnect rejects them
immediately, and requests/publishes are never replayed after reconnection. Invalid
JSON and throwing callbacks are isolated and counted without per-message console
logging. Subscription rejection clears its reading and appears under System;
Retry connection remains available to rebuild subscriptions after that fault.
`getDiagnostics()` on the transport and telemetry session exposes bounded counters
for tests and future diagnostic UI. A rendering failure replaces readings with an
explicit unavailable screen and a recovery action.

To add telemetry, update the typed topic catalog, the normalized reading/freshness
policy, the session's topic list and its presentation together. Add malformed,
stale, disconnect and recovery tests alongside the happy path. Keep subscriptions
and timers out of presentation components; use the existing injectable scheduler
and socket boundary for deterministic failure tests. Generic `subscribe`,
`callService`, `getParam` and `publish` remain transport APIs; the passenger GUI
uses only read operations.

For a Jetson deployment, use `npm run build` followed by `npm start`, with a
fullscreen browser. Run the browser soak on the target device to measure total
browser/server CPU, RSS, thermals and response time alongside the ROS workload.
Host Chromium CPU throttling and JavaScript-heap metrics are useful regressions;
they do not establish Jetson capacity or the full browser's memory footprint.

Validation on November 3, 2026: all 67 local regression checks passed without
skips, along with lint, type checks, production and isolated builds, and the
Chromium failure/recovery suite. A 65-second soak with 4× CPU throttling received
2,560 telemetry messages (below the 2,600-message budget), retained one connection
and four subscriptions, and ended at 5.03 MiB of JavaScript heap (0.66 MiB below
the initial reading after garbage collection). Native screenshots were visually
checked; deployment assets contain no fixture endpoint. See `tests/validation.json`
for the recorded checks and measurement limits.

## License

[MIT](LICENSE)

## Acknowledgments

This project is based on [ROSViz Web](https://github.com/prakash-aryan/rosviz-web) by [Prakash Aryan](https://github.com/prakash-aryan), adapted for CARL.
