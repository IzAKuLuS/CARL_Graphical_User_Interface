import { getRosbridgeUrl, validateRosbridgeUrl } from './rosConfig';
import type { ROSCallback } from '../types/ros';
import { systemScheduler, type Scheduler } from './scheduler';

export interface ConnectionSnapshot {
  readonly status: 'disconnected' | 'connecting' | 'connected' | 'reconnecting';
  readonly error: string | null;
}

export const DISCONNECTED: ConnectionSnapshot = Object.freeze({ status: 'disconnected', error: null });
export const TRANSPORT_LIMITS = Object.freeze({
  connectTimeoutMs: 8_000,
  idleTimeoutMs: 15_000,
  maxMessageChars: 1_048_576,
  maxBufferedBytes: 262_144,
  maxPendingServices: 32,
});

/** Small injectable boundary: production uses browser APIs; tests control time and sockets. */
interface Runtime extends Scheduler {
  socket: (url: string) => WebSocket;
  random: () => number;
}
export interface SubscriptionOptions {
  throttleRateMs?: number;
  queueLength?: number;
  onError?: (error: Error) => void;
}
interface Subscriber {
  callback: ROSCallback<unknown>;
  onError?: (error: Error) => void;
}
interface Subscription {
  messageType: string;
  throttleRateMs: number;
  queueLength: number;
  subscribers: Set<Subscriber>;
}
interface PendingService {
  timer: ReturnType<typeof setTimeout>;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}
interface Opening {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
}
type EventName = 'connected' | 'disconnected' | 'state';

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** One connection, bounded work, and no replay of publishes or service calls after failure. */
export class ROSBridge {
  private readonly runtime: Runtime;
  private ws: WebSocket | null = null;
  private url = '';
  private wanted = false;
  private owners = 0;
  private opening: Opening | null = null;
  private snapshot = DISCONNECTED;
  private listeners = new Map<EventName, Set<() => void>>();
  private subscriptions = new Map<string, Subscription>();
  private pending = new Map<string, PendingService>();
  private requestId = 0;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private connectTimer: ReturnType<typeof setTimeout> | undefined;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private lastReceivedAt = 0;
  private diagnostics = { received: 0, invalidMessages: 0, callbackErrors: 0, reconnects: 0 };

  constructor(runtime: Partial<Runtime> = {}) {
    this.runtime = {
      ...systemScheduler, socket: url => new WebSocket(url), random: Math.random, ...runtime,
    };
  }

  getSnapshot = (): ConnectionSnapshot => this.snapshot;
  getDiagnostics = () => ({ ...this.diagnostics, pendingServices: this.pending.size, subscriptions: this.subscriptions.size });
  subscribeConnection = (callback: () => void): (() => void) => {
    this.on('state', callback);
    return () => this.off('state', callback);
  };

  on(event: EventName, callback: () => void): this {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(callback);
    return this;
  }
  off(event: EventName, callback: () => void): this {
    this.listeners.get(event)?.delete(callback);
    return this;
  }
  private notify(event: EventName) {
    for (const callback of this.listeners.get(event) ?? []) {
      try { callback(); } catch { this.diagnostics.callbackErrors++; }
    }
  }
  private update(snapshot: ConnectionSnapshot) {
    if (snapshot.status === this.snapshot.status && snapshot.error === this.snapshot.error) return;
    this.snapshot = Object.freeze(snapshot);
    this.notify('state');
  }

  /** The last mounted ROS consumer owns shutdown, including React Strict Mode cleanup. */
  retain(): () => void {
    this.owners++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (--this.owners === 0) this.disconnect();
    };
  }

  connect(url = getRosbridgeUrl()): Promise<void> {
    let endpoint: string;
    try { endpoint = validateRosbridgeUrl(url); }
    catch (error) {
      if (!this.ws) this.update({ status: 'disconnected', error: (error as Error).message });
      return Promise.reject(error);
    }
    if (this.url === endpoint && this.ws) {
      if (this.isConnected()) return Promise.resolve();
      if (this.opening) return this.opening.promise;
    }
    this.wanted = false;
    this.retire(new Error('ROS connection replaced'));
    this.url = endpoint;
    this.wanted = true;
    this.reconnectAttempt = 0;
    return this.open();
  }

  private open(): Promise<void> {
    // Store the deferred before constructing the socket: synchronous failures
    // must not leave an already-rejected promise stuck as the current attempt.
    let resolve!: () => void, reject!: (error: Error) => void;
    const promise = new Promise<void>((ok, fail) => { resolve = ok; reject = fail; });
    const attempt = { promise, resolve, reject };
    this.opening = attempt;
    this.update({ status: 'connecting', error: this.snapshot.error });
    if (this.opening !== attempt || !this.wanted) return promise;
    try {
      const socket = this.runtime.socket(this.url);
      this.ws = socket;
      socket.onopen = () => {
        if (this.ws !== socket) return;
        this.runtime.clearTimeout(this.connectTimer);
        this.connectTimer = undefined;
        this.lastReceivedAt = this.runtime.now();
        for (const [topic, subscription] of this.subscriptions) {
          if (!this.sendSubscription(topic, subscription)) return;
        }
        this.reconnectAttempt = 0;
        const opening = this.opening;
        this.opening = null;
        this.checkIdle(socket);
        this.update({ status: 'connected', error: null });
        if (this.ws !== socket) {
          opening?.reject(new Error('ROS connection superseded during startup'));
          return;
        }
        opening?.resolve();
        this.notify('connected');
      };
      socket.onclose = () => {
        if (this.ws === socket) this.retire(new Error(`ROS connection closed at ${this.url}`));
      };
      socket.onerror = () => {
        if (this.ws === socket) this.retire(new Error(`Unable to reach rosbridge at ${this.url}`));
      };
      socket.onmessage = event => {
        if (this.ws === socket) this.receive(event.data);
      };
      this.connectTimer = this.runtime.setTimeout(() => {
        if (this.ws === socket) this.retire(new Error(`ROS connection timed out at ${this.url}`));
      }, TRANSPORT_LIMITS.connectTimeoutMs);
    } catch {
      this.retire(new Error(`Unable to open rosbridge at ${this.url}`));
    }
    return promise;
  }

  private checkIdle(socket: WebSocket) {
    const remaining = TRANSPORT_LIMITS.idleTimeoutMs - (this.runtime.now() - this.lastReceivedAt);
    if (remaining <= 0) {
      this.retire(new Error('Rosbridge stopped responding; reconnecting'));
      return;
    }
    this.idleTimer = this.runtime.setTimeout(() => {
      if (this.ws === socket) this.checkIdle(socket);
    }, remaining);
  }

  /** Detach first so late close/open/message callbacks cannot affect a newer session. */
  private retire(error: Error) {
    const socket = this.ws;
    const wasConnected = this.snapshot.status === 'connected';
    this.ws = null;
    for (const timer of [this.connectTimer, this.idleTimer, this.reconnectTimer]) this.runtime.clearTimeout(timer);
    this.connectTimer = this.idleTimer = this.reconnectTimer = undefined;
    this.opening?.reject(error);
    this.opening = null;
    for (const [id] of this.pending) this.finishService(id, error);
    if (socket) {
      socket.onopen = socket.onclose = socket.onerror = socket.onmessage = null;
      try { socket.close(); } catch { /* Already unusable; cleanup must still finish. */ }
    }
    this.update({ status: 'disconnected', error: this.wanted ? error.message : null });
    if (wasConnected) this.notify('disconnected');
    if (this.wanted) this.scheduleReconnect();
  }

  private scheduleReconnect() {
    if (!this.wanted || this.ws || this.reconnectTimer !== undefined) return;
    const base = Math.min(1_000 * 2 ** Math.min(this.reconnectAttempt++, 5), 30_000);
    const delay = Math.min(30_000, Math.round(base * (0.8 + 0.4 * this.runtime.random())));
    this.update({ status: 'reconnecting', error: this.snapshot.error });
    this.reconnectTimer = this.runtime.setTimeout(() => {
      this.reconnectTimer = undefined;
      if (!this.wanted) return;
      this.diagnostics.reconnects++;
      void this.open().catch(() => { /* retire schedules the next bounded attempt. */ });
    }, delay);
  }

  private send(message: object): boolean {
    if (!this.ws || this.ws.readyState !== 1) return false;
    try {
      if (this.ws.bufferedAmount > TRANSPORT_LIMITS.maxBufferedBytes) throw new Error('ROS send queue full');
      this.ws.send(JSON.stringify(message));
      return true;
    } catch {
      this.retire(new Error('Rosbridge send failed or its output queue is full'));
      return false;
    }
  }

  private receive(raw: unknown) {
    this.diagnostics.received++;
    if (typeof raw !== 'string' || raw.length > TRANSPORT_LIMITS.maxMessageChars) {
      this.diagnostics.invalidMessages++;
      return;
    }
    let message: unknown;
    try { message = JSON.parse(raw); } catch { this.diagnostics.invalidMessages++; return; }
    if (!record(message) || typeof message.op !== 'string') {
      this.diagnostics.invalidMessages++;
      return;
    }
    this.lastReceivedAt = this.runtime.now();
    if (message.op === 'service_response' || message.op === 'param_response') {
      if (typeof message.id !== 'string') return;
      this.finishService(message.id, message.result === false
        ? new Error(`ROS service failed: ${typeof message.service === 'string' ? message.service : message.id}`) : null,
      message.values);
      return;
    }
    if (message.op === 'status' && message.level === 'error') {
      const error = new Error(`Rosbridge: ${String(message.msg ?? 'Request rejected').slice(0, 256)}`);
      if (typeof message.id === 'string' && this.pending.has(message.id)) this.finishService(message.id, error);
      else {
        this.update({ status: this.snapshot.status, error: error.message });
        for (const [topic, subscription] of this.subscriptions) {
          if (message.id !== `subscribe:${topic}`) continue;
          for (const { onError } of subscription.subscribers) {
            try { onError?.(error); } catch { this.diagnostics.callbackErrors++; }
          }
        }
      }
      return;
    }
    if (message.op !== 'publish' || typeof message.topic !== 'string') return;
    const subscription = this.subscriptions.get(message.topic);
    if (!subscription) return;
    const value = message.msg;
    // Preserve byte-array support without attempting it for every telemetry field.
    if (record(value) && typeof value.data === 'string' && value.data.length > 0
      && value.data.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(value.data)) {
      try { value.data = Uint8Array.from(atob(value.data), c => c.charCodeAt(0)); }
      catch { this.diagnostics.invalidMessages++; return; }
    }
    for (const { callback } of subscription.subscribers) {
      try { callback(value); } catch { this.diagnostics.callbackErrors++; }
    }
  }

  private sendSubscription(topic: string, sub: Subscription): boolean {
    return this.send({ op: 'subscribe', id: `subscribe:${topic}`, topic, type: sub.messageType,
      throttle_rate: sub.throttleRateMs, queue_length: sub.queueLength, compression: 'none' });
  }

  subscribe<T>(topic: string, messageType: string, callback: ROSCallback<T>, options: SubscriptionOptions = {}): () => void {
    if (!topic.startsWith('/') || !messageType) throw new Error('Subscriptions need an absolute topic and message type');
    const { throttleRateMs = 100, queueLength = 1, onError } = options;
    if (!Number.isInteger(throttleRateMs) || throttleRateMs < 0 || !Number.isInteger(queueLength) || queueLength < 1) {
      throw new Error('Subscription rate and queue length must be nonnegative/positive integers');
    }
    let sub = this.subscriptions.get(topic);
    if (sub && (sub.messageType !== messageType || sub.throttleRateMs !== throttleRateMs || sub.queueLength !== queueLength)) {
      throw new Error(`Conflicting subscription configuration for ${topic}`);
    }
    const subscriber: Subscriber = { callback: callback as ROSCallback<unknown>, onError };
    if (sub) sub.subscribers.add(subscriber);
    else {
      sub = { messageType, throttleRateMs, queueLength, subscribers: new Set([subscriber]) };
      this.subscriptions.set(topic, sub);
      if (this.isConnected()) this.sendSubscription(topic, sub);
    }
    const registered = sub;
    return () => {
      if (this.subscriptions.get(topic) !== registered || !registered.subscribers.delete(subscriber)) return;
      if (registered.subscribers.size) return;
      this.subscriptions.delete(topic);
      if (this.isConnected()) this.send({ op: 'unsubscribe', id: `subscribe:${topic}`, topic });
    };
  }

  async getParam(name: string): Promise<unknown> {
    const response = await this.callService<{ name: string }, { value?: unknown }>(
      '/rosapi/get_param', 'rosapi_msgs/srv/GetParam', { name }, 10_000);
    if (response.value === undefined) throw new Error(`Parameter ${name} not found`);
    return response.value;
  }

  callService<TReq extends object, TRes = unknown>(service: string, serviceType: string, args: TReq, timeoutMs = 5_000): Promise<TRes> {
    if (!this.isConnected()) return Promise.reject(new Error(`Not connected to ROS — cannot call ${service}`));
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60_000) return Promise.reject(new Error('Service timeout must be in (0, 60000] ms'));
    if (this.pending.size >= TRANSPORT_LIMITS.maxPendingServices) return Promise.reject(new Error('Too many pending ROS services'));
    return new Promise<TRes>((resolve, reject) => {
      const id = `service:${++this.requestId}`;
      const timer = this.runtime.setTimeout(() => this.finishService(id, new Error(`Service ${service} timed out`)), timeoutMs);
      this.pending.set(id, { timer, resolve: value => resolve(value as TRes), reject });
      if (!this.send({ op: 'call_service', id, service, type: serviceType, args })) {
        this.finishService(id, new Error(`Unable to send ROS service ${service}`));
      }
    });
  }

  private finishService(id: string, error: Error | null, value?: unknown) {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    this.runtime.clearTimeout(pending.timer);
    if (error) pending.reject(error); else pending.resolve(value);
  }

  publish<T>(topic: string, messageType: string, message: T): boolean {
    if (!topic.startsWith('/') || !messageType) throw new Error('Publishes need an absolute topic and message type');
    return this.isConnected() && this.send({ op: 'publish', topic, type: messageType, msg: message });
  }
  isConnected(): boolean { return this.snapshot.status === 'connected' && this.ws?.readyState === 1; }

  disconnect(): void {
    this.wanted = false;
    this.subscriptions.clear();
    this.retire(new Error('ROS connection disconnected'));
  }
}

const rosbridge = new ROSBridge();
export default rosbridge;
