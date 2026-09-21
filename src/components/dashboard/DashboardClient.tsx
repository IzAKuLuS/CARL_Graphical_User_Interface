"use client";

import Image from "next/image";
import {
  Activity,
  Cable,
  CircleAlert,
  RefreshCw,
} from "lucide-react";
import EncoderTelemetryPanel from "@/components/dashboard/EncoderTelemetryPanel";
import VehicleInterfacesPanel from "@/components/dashboard/VehicleInterfacesPanel";
import { useCarlPresence } from "@/hooks/useCarlPresence";
import { useROS } from "@/hooks/useROS";

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

export default function DashboardClient() {
  const { isConnected, isConnecting, connectionError, connect } = useROS();
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
      <header className="relative flex h-20 items-center gap-3.5 border-b border-[#333333] bg-[#232323] px-6">
        <Image
          src="/branding/AVL_Logo_Blue.png"
          alt="AVL logo"
          width={105}
          height={36}
          priority
          className="h-9 w-auto object-contain"
        />
        <div>
          <h1 className="text-base font-semibold">CARL Vehicle Dashboard</h1>
          <p className="text-sm text-gray-500">Single-vehicle ROS 2 interface</p>
        </div>
        <Image
          src="/branding/CARL_higher_resolution-removebg-preview.png"
          alt="CARL logo"
          width={144}
          height={60}
          priority
          className="pointer-events-none absolute left-1/2 h-12 w-auto -translate-x-1/2 object-contain"
        />
        <div className="ml-auto flex items-center gap-2.5 text-sm text-gray-400">
          <StatusDot active={isConnected} />
          {isConnected ? "Rosbridge connected" : "Rosbridge disconnected"}
        </div>
      </header>

      <main className="mx-auto grid max-w-[1500px] gap-6 p-6 lg:grid-cols-2">
        <section className="rounded-xl border border-[#333333] bg-[#1e1e1e] p-6 lg:col-span-2">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#292929]">
              {isCarlAvailable ? (
                <Activity className="h-6 w-6 text-green-400" />
              ) : (
                <Cable className="h-6 w-6 text-gray-500" />
              )}
            </div>
            <div>
              <h2 className="text-base font-semibold">{carlStatusLabel}</h2>
              <p className="text-sm text-gray-500">
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
                className="ml-auto inline-flex h-10 items-center gap-2 rounded-md bg-[#00a5ff] px-4 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                <RefreshCw
                  className={`h-4 w-4 ${isConnecting ? "animate-spin" : ""}`}
                />
                {isConnecting ? "Connecting" : "Retry connection"}
              </button>
            )}
          </div>
          {connectionError && !isConnected && (
            <div
              role="alert"
              aria-live="polite"
              className="mt-4 flex items-start gap-3 rounded-lg border border-red-900/70 bg-red-950/40 p-3 text-sm text-red-200"
            >
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
              <p>{connectionError}</p>
            </div>
          )}
        </section>

        <EncoderTelemetryPanel />
        <VehicleInterfacesPanel />

        <section className="rounded-xl border border-[#333333] bg-[#1e1e1e] p-5 text-sm text-gray-400 lg:col-span-2">
          Command publishing is disabled while the CARL dashboard integration is
          being validated. Encoder values above are read directly from the
          absolute /carl/encoders topic.
        </section>
      </main>
    </div>
  );
}
