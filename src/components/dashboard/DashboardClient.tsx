"use client";

import { Activity, Cable, CarFront, RefreshCw } from "lucide-react";
import EncoderTelemetryPanel from "@/components/dashboard/EncoderTelemetryPanel";
import { useCarlPresence } from "@/hooks/useCarlPresence";
import { useROS } from "@/hooks/useROS";
import { CARL_TOPICS, type TopicEntry } from "@/lib/rosTopics";

const COMMAND_TOPICS = [
  ["Throttle command", CARL_TOPICS.throttleCommand],
  ["Emergency stop", CARL_TOPICS.estop],
] as const satisfies ReadonlyArray<readonly [string, TopicEntry]>;

function StatusDot({ active }: { active: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`h-2.5 w-2.5 rounded-full ${
        active ? "bg-green-500" : "bg-gray-600"
      }`}
    />
  );
}

function TopicList({
  title,
  topics,
  muted = false,
}: {
  title: string;
  topics: ReadonlyArray<readonly [string, TopicEntry]>;
  muted?: boolean;
}) {
  return (
    <section className="rounded-lg border border-[#333333] bg-[#1e1e1e] p-4">
      <h2 className="mb-3 text-sm font-semibold text-[#00a5ff]">{title}</h2>
      <div className="space-y-2">
        {topics.map(([label, topic]) => (
          <div
            key={topic.path}
            className="rounded-md border border-[#2f2f2f] bg-[#242424] px-3 py-2"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-gray-200">{label}</span>
              {muted && (
                <span className="rounded bg-yellow-950 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-yellow-400">
                  Disabled
                </span>
              )}
            </div>
            <code className="mt-1 block text-xs text-green-400">
              {topic.path}
            </code>
            <code className="block text-[11px] text-gray-500">{topic.type}</code>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function DashboardClient() {
  const { isConnected, isConnecting, connect } = useROS();
  const carlState = useCarlPresence();
  const isCarlAvailable = carlState === "carl-available";

  const carlStatusLabel = (() => {
    switch (carlState) {
      case "carl-available":
        return "CARL bridge detected";
      case "checking":
        return "Checking ROS graph";
      case "carl-bridge-unavailable":
        return "CARL bridge not detected";
      default:
        return "Waiting for rosbridge";
    }
  })();

  return (
    <div className="min-h-screen bg-[#171717] text-white">
      <header className="flex h-14 items-center gap-3 border-b border-[#333333] bg-[#232323] px-4">
        <CarFront className="h-5 w-5 text-[#00a5ff]" />
        <div>
          <h1 className="text-sm font-semibold">CARL Vehicle Dashboard</h1>
          <p className="text-xs text-gray-500">Single-vehicle ROS 2 interface</p>
        </div>
        <div className="ml-auto flex items-center gap-2 text-xs text-gray-400">
          <StatusDot active={isConnected} />
          {isConnected ? "Rosbridge connected" : "Rosbridge disconnected"}
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-4 p-4 md:grid-cols-2">
        <section className="md:col-span-2 rounded-lg border border-[#333333] bg-[#1e1e1e] p-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#252525]">
              {isCarlAvailable ? (
                <Activity className="h-5 w-5 text-green-400" />
              ) : (
                <Cable className="h-5 w-5 text-gray-500" />
              )}
            </div>
            <div>
              <h2 className="text-sm font-semibold">{carlStatusLabel}</h2>
              <p className="text-xs text-gray-500">
                {isCarlAvailable
                  ? "The CARL telemetry endpoints are present on the ROS graph."
                  : "Start the CARL bridge and rosbridge server on the same ROS domain."}
              </p>
            </div>
            {!isConnected && (
              <button
                type="button"
                disabled={isConnecting}
                onClick={() => void connect()}
                className="ml-auto inline-flex h-8 items-center gap-2 rounded-md bg-[#00a5ff] px-3 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${isConnecting ? "animate-spin" : ""}`}
                />
                {isConnecting ? "Connecting" : "Reconnect"}
              </button>
            )}
          </div>
        </section>

        <EncoderTelemetryPanel />
        <TopicList
          title="Vehicle command interfaces"
          topics={COMMAND_TOPICS}
          muted
        />

        <section className="md:col-span-2 rounded-lg border border-[#333333] bg-[#1e1e1e] p-4 text-xs text-gray-400">
          Command publishing is disabled while the CARL dashboard integration is
          being validated. Encoder values above are read directly from the
          absolute /carl/encoders topic.
        </section>
      </main>
    </div>
  );
}
