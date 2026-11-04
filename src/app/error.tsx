'use client';

/** A rendering failure must show unavailable status, never leave old readings on screen. */
export default function DashboardError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="flex h-screen flex-col items-center justify-center gap-6 bg-black px-8 text-center text-white" role="alert">
      <h1 className="text-2xl">Vehicle display unavailable</h1>
      <p>Vehicle status is unknown. Reload the display to reconnect and receive fresh telemetry.</p>
      <button className="rounded border border-white px-6 py-3" onClick={reset}>Retry display</button>
    </main>
  );
}
