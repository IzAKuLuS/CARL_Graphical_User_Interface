

const DEFAULT_ROSBRIDGE_PORT = 9090;

export function getRosbridgeUrl(): string {
  const configuredUrl =
    process.env.NEXT_PUBLIC_ROSBRIDGE_URL?.trim();

  if (configuredUrl) {
    return configuredUrl;
  }

  if (typeof window === "undefined") {
    return `ws://localhost:${DEFAULT_ROSBRIDGE_PORT}`;
  }

  const protocol =
    window.location.protocol === "https:" ? "wss" : "ws";

  return `${protocol}://${window.location.hostname}:${DEFAULT_ROSBRIDGE_PORT}`;
}