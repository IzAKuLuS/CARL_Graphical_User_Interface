export type Timer = ReturnType<typeof globalThis.setTimeout>;

/** Monotonic deadlines are independent of wall-clock/timezone changes. */
export interface Scheduler {
  now: () => number;
  setTimeout: (callback: () => void, delayMs: number) => Timer;
  clearTimeout: (timer: Timer | undefined) => void;
}

export const systemScheduler: Scheduler = {
  now: () => performance.now(),
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: timer => globalThis.clearTimeout(timer),
};
