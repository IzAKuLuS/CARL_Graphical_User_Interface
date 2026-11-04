const DEFAULT_ROSBRIDGE_PORT = 9090;

/**
 * Resolve the rosbridge WebSocket URL.
 *
 * Priority:
 * 1. NEXT_PUBLIC_ROSBRIDGE_URL, when configured.
 * 2. The hostname used to open the dashboard.
 * 3. localhost during server-side rendering.
 */
export function getRosbridgeUrl(): string {
  const configuredUrl = process.env.NEXT_PUBLIC_ROSBRIDGE_URL?.trim();

  if (configuredUrl) {
    return configuredUrl;
  }

  if (typeof window === "undefined") {
    return `ws://localhost:${DEFAULT_ROSBRIDGE_PORT}`;
  }

  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  const hostname = window.location.hostname || 'localhost';
  return `${protocol}://${hostname}:${DEFAULT_ROSBRIDGE_PORT}`;
}

/** Fail once for configuration mistakes instead of retrying them indefinitely. */
export function validateRosbridgeUrl(value: string): string {
  const url = new URL(value);
  if (!['ws:', 'wss:'].includes(url.protocol) || url.username || url.password || url.hash) {
    throw new Error('Use a ws:// or wss:// rosbridge address without credentials or a fragment.');
  }
  if (typeof window !== 'undefined' && window.location.protocol === 'https:' && url.protocol !== 'wss:') {
    throw new Error('HTTPS dashboards require a secure wss:// rosbridge address.');
  }
  return url.href;
}
