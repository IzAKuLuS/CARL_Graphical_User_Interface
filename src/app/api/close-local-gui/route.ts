import net from 'node:net';
import path from 'node:path';

export const runtime = 'nodejs';

export async function POST(request: Request): Promise<Response> {
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  if (origin !== 'http://127.0.0.1:3215' || host !== '127.0.0.1:3215') {
    return Response.json({ error: 'This action is available only on the local passenger display.' }, { status: 403 });
  }

  const runtimeDir = process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid?.()}`;
  const socketPath = path.join(runtimeDir, 'carl-passenger-gui.sock');
  try {
    await new Promise<void>((resolve, reject) => {
      const socket = net.createConnection(socketPath);
      socket.setTimeout(2000);
      socket.once('connect', () => socket.write('CLOSE\n'));
      socket.once('data', data => {
        socket.destroy();
        if (data.toString() === 'OK\n') resolve();
        else reject(new Error('Unexpected launcher reply'));
      });
      socket.once('error', reject);
      socket.once('timeout', () => socket.destroy(new Error('Launcher did not respond')));
    });
    return Response.json({ closing: true });
  } catch {
    return Response.json({ error: 'The desktop launcher is unavailable. Close the kiosk with Alt+F4.' }, { status: 503 });
  }
}
