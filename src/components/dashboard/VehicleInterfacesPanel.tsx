"use client";

import { useEffect, useState } from "react";
import { HeartPulse } from "lucide-react";
import { useROS } from "@/hooks/useROS";
import {
  CARL_TOPICS,
  type CarlTopicMessage,
  type TopicEntry,
} from "@/lib/rosTopics";

type HeartbeatMessage = CarlTopicMessage<"heartbeat">;
type StatusTone = "green" | "red" | "yellow" | "neutral";

const HEARTBEAT_STALE_MS = 1_000;
const HEARTBEAT_FLAG_OK = 0x01;
const HEARTBEAT_FLAG_ESTOP = 0x02;
const HEARTBEAT_FLAG_TELEOP_OK = 0x04;

const COMMAND_TOPICS = [
  ["Throttle command", CARL_TOPICS.throttleCommand],
  ["Emergency stop", CARL_TOPICS.estop],
] as const satisfies ReadonlyArray<readonly [string, TopicEntry]>;

const MODE_LABELS: Record<HeartbeatMessage["mode"], string> = {
  0: "Idle",
  1: "Teleop",
  2: "E-stop",
};

const STATUS_TONE_CLASSES: Record<StatusTone, string> = {
  green: "bg-green-950 text-green-400",
  red: "bg-red-950 text-red-400",
  yellow: "bg-yellow-950 text-yellow-400",
  neutral: "bg-[#303030] text-gray-400",
};

function StatusBadge({
  label,
  tone,
}: {
  label: string;
  tone: StatusTone;
}) {
  return (
    <span
      className={`rounded px-2.5 py-1 text-xs font-medium uppercase tracking-wide ${STATUS_TONE_CLASSES[tone]}`}
    >
      {label}
    </span>
  );
}

function HeartbeatValue({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: StatusTone;
}) {
  const valueColor = {
    green: "text-green-400",
    red: "text-red-400",
    yellow: "text-yellow-400",
    neutral: "text-white",
  }[tone];

  return (
    <div className="rounded-md border border-[#333333] bg-[#292929] p-4">
      <span className="block text-xs font-medium uppercase tracking-wide text-gray-500">
        {label}
      </span>
      <span className={`mt-2 block text-lg font-semibold ${valueColor}`}>
        {value}
      </span>
    </div>
  );
}

export default function VehicleInterfacesPanel() {
  const { isConnected, subscribe } = useROS();
  const [heartbeat, setHeartbeat] = useState<HeartbeatMessage | null>(null);
  const [lastReceivedAt, setLastReceivedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!isConnected) {
      setHeartbeat(null);
      setLastReceivedAt(null);
      return;
    }

    return subscribe<HeartbeatMessage>(
      CARL_TOPICS.heartbeat.path,
      CARL_TOPICS.heartbeat.type,
      (message) => {
        const receivedAt = Date.now();
        setHeartbeat(message);
        setLastReceivedAt(receivedAt);
        setNow(receivedAt);
      },
    );
  }, [isConnected, subscribe]);

  useEffect(() => {
    if (!isConnected || lastReceivedAt === null) return;

    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [isConnected, lastReceivedAt]);

  const isHeartbeatFresh =
    isConnected &&
    heartbeat !== null &&
    lastReceivedAt !== null &&
    now - lastReceivedAt <= HEARTBEAT_STALE_MS;

  const streamStatus = !isConnected
    ? { label: "Offline", tone: "neutral" as const }
    : heartbeat === null
      ? { label: "Waiting", tone: "yellow" as const }
      : isHeartbeatFresh
        ? { label: "Live", tone: "green" as const }
        : { label: "Stale", tone: "red" as const };

  const flagIsSet = (flag: number) =>
    isHeartbeatFresh && heartbeat !== null
      ? (heartbeat.flags & flag) !== 0
      : null;

  const ok = flagIsSet(HEARTBEAT_FLAG_OK);
  const estop = flagIsSet(HEARTBEAT_FLAG_ESTOP);
  const teleopOk = flagIsSet(HEARTBEAT_FLAG_TELEOP_OK);
  const mode = isHeartbeatFresh && heartbeat ? MODE_LABELS[heartbeat.mode] : "Unknown";

  return (
    <section className="rounded-xl border border-[#333333] bg-[#1e1e1e] p-6">
      <div className="mb-4 flex items-center gap-2.5">
        <HeartPulse className="h-5 w-5 text-[#00a5ff]" />
        <h2 className="text-base font-semibold text-[#00a5ff]">
          Vehicle command interfaces
        </h2>
      </div>

      <div className="space-y-3">
        {COMMAND_TOPICS.map(([label, topic]) => (
          <div
            key={topic.path}
            className="rounded-lg border border-[#333333] bg-[#292929] p-4"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="text-base text-gray-200">{label}</span>
              <StatusBadge label="GUI write disabled" tone="yellow" />
            </div>
            <code className="mt-1.5 block text-sm text-green-400">
              {topic.path}
            </code>
            <code className="block text-xs text-gray-500">{topic.type}</code>
          </div>
        ))}
      </div>

      <div className="my-5 border-t border-[#333333]" />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-medium text-gray-200">CARL heartbeat</h3>
          <code className="mt-1 block text-sm text-green-400">
            {CARL_TOPICS.heartbeat.path}
          </code>
        </div>
        <StatusBadge label={streamStatus.label} tone={streamStatus.tone} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <HeartbeatValue
          label="Vehicle mode"
          value={mode}
          tone={mode === "E-stop" ? "red" : isHeartbeatFresh ? "green" : "neutral"}
        />
        <HeartbeatValue
          label="System heartbeat"
          value={ok === null ? "Unknown" : ok ? "OK" : "Fault"}
          tone={ok === null ? "neutral" : ok ? "green" : "red"}
        />
        <HeartbeatValue
          label="Emergency stop"
          value={estop === null ? "Unknown" : estop ? "Active" : "Clear"}
          tone={estop === null ? "neutral" : estop ? "red" : "green"}
        />
        <HeartbeatValue
          label="Teleop link"
          value={teleopOk === null ? "Unknown" : teleopOk ? "Ready" : "Not ready"}
          tone={teleopOk === null ? "neutral" : teleopOk ? "green" : "yellow"}
        />
        <HeartbeatValue
          label="Heartbeat counter"
          value={isHeartbeatFresh && heartbeat ? String(heartbeat.counter) : "—"}
        />
      </div>
    </section>
  );
}
