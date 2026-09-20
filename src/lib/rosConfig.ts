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
  return `${protocol}://${window.location.hostname}:${DEFAULT_ROSBRIDGE_PORT}`;
}
