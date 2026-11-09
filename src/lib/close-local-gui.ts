export async function closeLocalGui(): Promise<void> {
  const response = await fetch('/api/close-local-gui', { method: 'POST' });
  if (!response.ok) {
    const result = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(result.error || 'The local launcher did not accept the close request.');
  }
  window.close(); // The desktop launcher also closes the kiosk if Chromium blocks this.
}
