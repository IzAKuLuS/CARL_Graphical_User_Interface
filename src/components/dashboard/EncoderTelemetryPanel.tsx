"use client";

import { useEffect, useState } from "react";
import { Gauge } from "lucide-react";
import { useROS } from "@/hooks/useROS";
import { CARL_TOPICS, type CarlTopicMessage } from "@/lib/rosTopics";

type EncoderMessage = CarlTopicMessage<"encoders">;

interface EncoderCounts {
  rearLeft: number;
  rearRight: number;
}

const countFormatter = new Intl.NumberFormat("en-US");

function EncoderValue({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded-lg border border-[#333333] bg-[#292929] p-6">
      <span className="block text-xs font-medium uppercase tracking-wide text-gray-500">
        {label}
      </span>
      <div className="mt-3 flex items-baseline gap-2.5">
        <span className="font-mono text-4xl font-semibold tabular-nums text-white">
          {value === null ? "—" : countFormatter.format(value)}
        </span>
        <span className="text-sm text-gray-500">counts</span>
      </div>
    </div>
  );
}

export default function EncoderTelemetryPanel() {
  const { isConnected, subscribe } = useROS();
  const [counts, setCounts] = useState<EncoderCounts | null>(null);

  useEffect(() => {
    if (!isConnected) {
      setCounts(null);
      return;
    }

    const unsubscribe = subscribe<EncoderMessage>(
      CARL_TOPICS.encoders.path,
      CARL_TOPICS.encoders.type,
      (message) => {
        setCounts({
          rearLeft: message.rear_left_counts,
          rearRight: message.rear_right_counts,
        });
      },
    );

    return unsubscribe;
  }, [isConnected, subscribe]);

  const statusLabel = !isConnected
    ? "Rosbridge disconnected"
    : counts === null
      ? "Waiting for encoder data"
      : "Live";

  return (
    <section className="rounded-xl border border-[#333333] bg-[#1e1e1e] p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Gauge className="h-5 w-5 text-[#00a5ff]" />
          <h2 className="text-base font-semibold text-[#00a5ff]">
            Rear wheel encoders
          </h2>
        </div>
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <span
            aria-hidden="true"
            className={`h-2 w-2 rounded-full ${
              counts !== null ? "bg-green-500" : "bg-gray-600"
            }`}
          />
          {statusLabel}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <EncoderValue label="Rear left" value={counts?.rearLeft ?? null} />
        <EncoderValue label="Rear right" value={counts?.rearRight ?? null} />
      </div>

      <code className="mt-4 block text-xs text-gray-600">
        {CARL_TOPICS.encoders.path}
      </code>
    </section>
  );
}
