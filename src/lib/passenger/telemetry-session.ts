import { CARL_TOPICS } from '../rosTopics';
import type { ROSCallback } from '../../types/ros';
import type { SubscriptionOptions } from '../rosbridge';
import { systemScheduler, type Scheduler } from '../scheduler';
import { DISPLAY_PERIOD_MS, ingest, projectTelemetry, sameDashboard, setConnection,
  type TelemetryState, type TelemetryTopic } from './telemetry-store';

interface TelemetryPort {
  subscribe<T>(topic: string, type: string, callback: ROSCallback<T>, options?: SubscriptionOptions): () => void;
}
const TOPICS: readonly TelemetryTopic[] = ['heartbeat', 'throttleStatus', 'encoders', 'steeringAngle'];

/** Owns receive buffers and display cadence, independently of React and the DOM. */
export class TelemetrySession {
  private state: TelemetryState = { connected: false, samples: {} };
  private snapshot = Object.freeze(projectTelemetry(this.state, 0));
  private listeners = new Set<() => void>();
  private visible = true;
  private generation = 0;
  private unsubscribers: (() => void)[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private scheduler: Scheduler;
  private diagnostics = { updates: 0, subscriptionErrors: 0, cleanupErrors: 0, listenerErrors: 0 };

  constructor(private port: TelemetryPort, scheduler: Partial<Scheduler> = {}) {
    this.scheduler = { ...systemScheduler, ...scheduler };
  }

  getSnapshot = () => this.snapshot;
  getDiagnostics = () => ({ ...this.diagnostics, retainedSamples: Object.keys(this.state.samples).length });
  subscribe = (callback: () => void) => {
    this.listeners.add(callback);
    return () => { this.listeners.delete(callback); };
  };

  setConnected(connected: boolean) {
    if (this.state.connected === connected) return;
    this.stopReceiving();
    setConnection(this.state, connected);
    this.flush();
    this.startReceiving();
  }

  setVisible(visible: boolean) {
    if (this.visible === visible) return;
    this.visible = visible;
    this.stopReceiving();
    this.state.samples = {};
    this.flush();
    this.startReceiving();
  }

  private startReceiving() {
    if (!this.state.connected || !this.visible) return;
    const generation = this.generation;
    for (const key of TOPICS) {
      if (generation !== this.generation) return;
      const topic = CARL_TOPICS[key];
      const receive = (message: unknown) => {
        if (generation === this.generation) ingest(this.state, key, message, this.scheduler.now());
      };
      try {
        const unsubscribe = this.port.subscribe(topic.path, topic.type, receive, {
          throttleRateMs: DISPLAY_PERIOD_MS, queueLength: 1, onError: () => receive(null),
        });
        if (generation !== this.generation) { unsubscribe(); return; }
        this.unsubscribers.push(unsubscribe);
      } catch { this.diagnostics.subscriptionErrors++; }
    }
    if (generation === this.generation) this.schedule();
  }

  private schedule() {
    const generation = this.generation;
    this.timer = this.scheduler.setTimeout(() => {
      if (generation !== this.generation) return;
      this.timer = undefined;
      this.flush();
      if (generation === this.generation && this.state.connected && this.visible) this.schedule();
    }, DISPLAY_PERIOD_MS);
  }

  private stopReceiving() {
    this.generation++;
    this.scheduler.clearTimeout(this.timer);
    this.timer = undefined;
    const unsubscribers = this.unsubscribers;
    this.unsubscribers = [];
    for (const unsubscribe of unsubscribers) {
      try { unsubscribe(); } catch { this.diagnostics.cleanupErrors++; }
    }
  }

  private flush() {
    const next = projectTelemetry(this.state, this.scheduler.now());
    if (sameDashboard(this.snapshot, next)) return;
    this.snapshot = Object.freeze(next);
    this.diagnostics.updates++;
    for (const listener of this.listeners) {
      try { listener(); } catch { this.diagnostics.listenerErrors++; }
    }
  }
}
