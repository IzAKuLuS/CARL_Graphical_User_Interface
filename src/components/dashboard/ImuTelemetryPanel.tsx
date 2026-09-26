"use client";

import { useEffect, useRef, useState } from "react";
import { Activity } from "lucide-react";
import { useROS } from "@/hooks/useROS";
import { CARL_TOPICS, type CarlTopicMessage } from "@/lib/rosTopics";

type ImuMessage = CarlTopicMessage<"imu">;
type TemperatureMessage = CarlTopicMessage<"imuTemperature">;
type StreamTone = "green" | "yellow" | "red" | "neutral";

interface ReceivedSample<TMessage> {
  message: TMessage;
  receivedAt: number;
}

const DISPLAY_PERIOD_MS = 100;
const IMU_STALE_MS = 500;

const STREAM_TONE_CLASSES: Record<StreamTone, string> = {
  green: "bg-green-500",
  yellow: "bg-yellow-500",
  red: "bg-red-500",
  neutral: "bg-gray-600",
};

function formatMeasurement(value: number | undefined): string {
  return value !== undefined && Number.isFinite(value) ? value.toFixed(3) : "—";
}

function AxisValue({
  axis,
  value,
  unit,
}: {
  axis: string;
  value: number | undefined;
  unit: string;
}) {
  return (
    <div className="rounded-lg border border-[#333333] bg-[#292929] p-4">
      <span className="block text-xs font-medium uppercase tracking-wide text-gray-500">
        {axis}
      </span>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="font-mono text-xl font-semibold tabular-nums text-white">
          {formatMeasurement(value)}
        </span>
        <span className="text-xs text-gray-500">{unit}</span>
      </div>
    </div>
  );
}

function VectorGroup({
  title,
  vector,
  unit,
  magnitude,
}: {
  title: string;
  vector: ImuMessage["linear_acceleration"] | undefined;
  unit: string;
  magnitude?: number;
}) {
  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium text-gray-300">{title}</h3>
        {magnitude !== undefined && (
          <span className="font-mono text-xs tabular-nums text-gray-500">
            magnitude {formatMeasurement(magnitude)} {unit}
          </span>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <AxisValue axis="X" value={vector?.x} unit={unit} />
        <AxisValue axis="Y" value={vector?.y} unit={unit} />
        <AxisValue axis="Z" value={vector?.z} unit={unit} />
      </div>
    </div>
  );
}

export default function ImuTelemetryPanel() {
  const { isConnected, subscribe } = useROS();
  const latestImuSample = useRef<ReceivedSample<ImuMessage> | null>(null);
  const latestTemperatureSample =
    useRef<ReceivedSample<TemperatureMessage> | null>(null);
  const [displayImuSample, setDisplayImuSample] =
    useState<ReceivedSample<ImuMessage> | null>(null);
  const [displayTemperatureSample, setDisplayTemperatureSample] =
    useState<ReceivedSample<TemperatureMessage> | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    latestImuSample.current = null;
    latestTemperatureSample.current = null;

    if (!isConnected) {
      setDisplayImuSample(null);
      setDisplayTemperatureSample(null);
      return;
    }

    const unsubscribeImu = subscribe<ImuMessage>(
      CARL_TOPICS.imu.path,
      CARL_TOPICS.imu.type,
      (message) => {
        latestImuSample.current = {
          message,
          receivedAt: Date.now(),
        };
      },
    );
    const unsubscribeTemperature = subscribe<TemperatureMessage>(
      CARL_TOPICS.imuTemperature.path,
      CARL_TOPICS.imuTemperature.type,
      (message) => {
        latestTemperatureSample.current = {
          message,
          receivedAt: Date.now(),
        };
      },
    );

    // The sensor publishes near 100 Hz. Refreshing the visible panel at 10 Hz
    // keeps React work bounded while always presenting the newest sample.
    const displayTimer = window.setInterval(() => {
      const currentTime = Date.now();
      setNow(currentTime);

      if (latestImuSample.current !== null) {
        setDisplayImuSample(latestImuSample.current);
      }
      if (latestTemperatureSample.current !== null) {
        setDisplayTemperatureSample(latestTemperatureSample.current);
      }
    }, DISPLAY_PERIOD_MS);

    return () => {
      window.clearInterval(displayTimer);
      unsubscribeImu();
      unsubscribeTemperature();
      latestImuSample.current = null;
      latestTemperatureSample.current = null;
    };
  }, [isConnected, subscribe]);

  const message = displayImuSample?.message;
  const isImuFresh =
    isConnected &&
    displayImuSample !== null &&
    now - displayImuSample.receivedAt <= IMU_STALE_MS;
  const isTemperatureFresh =
    isConnected &&
    displayTemperatureSample !== null &&
    now - displayTemperatureSample.receivedAt <= IMU_STALE_MS;

  const streamStatus = !isConnected
    ? { label: "Offline", tone: "neutral" as const }
    : displayImuSample === null
      ? { label: "Waiting", tone: "yellow" as const }
      : isImuFresh
        ? { label: "Live", tone: "green" as const }
        : { label: "Stale", tone: "red" as const };
  const temperatureStatus = !isConnected
    ? { label: "Offline", tone: "neutral" as const }
    : displayTemperatureSample === null
      ? { label: "Waiting", tone: "yellow" as const }
      : isTemperatureFresh
        ? { label: "Live", tone: "green" as const }
        : { label: "Stale", tone: "red" as const };

  const accelerationMagnitude = message
    ? Math.hypot(
        message.linear_acceleration.x,
        message.linear_acceleration.y,
        message.linear_acceleration.z,
      )
    : undefined;

  const orientationUnavailable =
    message?.orientation_covariance[0] === -1;

  return (
    <section className="rounded-xl border border-[#333333] bg-[#1e1e1e] p-6 lg:col-span-2">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Activity className="h-5 w-5 text-[#00a5ff]" />
          <div>
            <h2 className="text-base font-semibold text-[#00a5ff]">
              IMU telemetry
            </h2>
            <code className="text-xs text-gray-600">
              {CARL_TOPICS.imu.path} · {message?.header.frame_id ?? "imu_link"}
            </code>
          </div>
        </div>
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <span
            aria-hidden="true"
            className={`h-2 w-2 rounded-full ${STREAM_TONE_CLASSES[streamStatus.tone]}`}
          />
          {streamStatus.label}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <VectorGroup
          title="Linear acceleration"
          vector={message?.linear_acceleration}
          unit="m/s²"
          magnitude={accelerationMagnitude}
        />
        <VectorGroup
          title="Angular velocity"
          vector={message?.angular_velocity}
          unit="rad/s"
        />
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-lg border border-[#333333] bg-[#292929] p-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium text-gray-300">
              MPU-6500 die temperature
            </h3>
            <span
              aria-hidden="true"
              className={`h-2 w-2 rounded-full ${STREAM_TONE_CLASSES[temperatureStatus.tone]}`}
            />
            <span className="text-xs text-gray-500">
              {temperatureStatus.label}
            </span>
          </div>
          <code className="mt-1 block text-xs text-gray-600">
            {CARL_TOPICS.imuTemperature.path}
          </code>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-3xl font-semibold tabular-nums text-white">
            {formatMeasurement(
              displayTemperatureSample?.message.temperature,
            )}
          </span>
          <span className="text-sm text-gray-500">°C</span>
        </div>
      </div>

      {orientationUnavailable && (
        <p className="mt-5 rounded-lg border border-[#333333] bg-[#252525] p-3 text-xs text-gray-500">
          Orientation is unavailable from this six-axis IMU stream; the bridge
          publishes acceleration and angular velocity without an attitude
          estimate.
        </p>
      )}
    </section>
  );
}
