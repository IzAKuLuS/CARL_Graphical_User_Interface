import net from 'node:net';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';

export const runtime = 'nodejs';
const execFileAsync = promisify(execFile);
const LOCAL = '127.0.0.1:3215';
type Action = 'status' | 'start' | 'stop' | 'no-control' | 'start-joystick' | 'stop-joystick';
const PROTOCOL = 3;
const OUTDATED_MESSAGE = 'CARL control service is running an older version. Use Return to start to stop CARL, then press Start CARL again to load the update.';
class OutdatedSupervisor extends Error {}
let restartPromise: Promise<void> | null = null;

function allowed(request: Request): boolean {
  const host = request.headers.get('host');
  const origin = request.headers.get('origin');
  return host === LOCAL && (!origin || origin === `http://${LOCAL}`);
}

async function askRaw(action: Action): Promise<Record<string, unknown>> {
  const runtimeDir = process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid?.()}`;
  const socketPath = path.join(runtimeDir, 'carl-operation.sock');
  if (!existsSync(socketPath)) {
    await execFileAsync('systemctl', ['--user', 'start', 'carl-operation.service'], { timeout: 5000 });
  }
  for (let attempt = 0; !existsSync(socketPath) && attempt < 20; attempt++)
    await new Promise(resolve => setTimeout(resolve, 100));
  return await new Promise<Record<string, unknown>>((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let data = '';
    socket.setTimeout(20000);
    socket.once('connect', () => socket.write(JSON.stringify({ action })));
    socket.on('data', chunk => { data += chunk; if (data.includes('\n')) socket.end(); });
    socket.once('end', () => { try { resolve(JSON.parse(data) as Record<string, unknown>); } catch { reject(new Error('Invalid supervisor reply')); } });
    socket.once('error', reject);
    socket.once('timeout', () => socket.destroy(new Error('Supervisor timeout')));
  });
}

async function ask(action: Action): Promise<Record<string, unknown>> {
  if (restartPromise) await restartPromise;
  // A stop request must remain available even when an older supervisor is running.
  if (action === 'stop') return askRaw('stop');
  let status = await askRaw('status');
  if (status.protocol !== PROTOCOL && action === 'status' && (status.state === 'off' || status.state === 'stopping'))
    return { ...status, mode: null };
  if (status.protocol !== PROTOCOL && action === 'start' && status.state === 'off') {
    // Restart only when the old supervisor confirms all CARL software is off.
    restartPromise ??= (async () => {
      try { await execFileAsync('systemctl', ['--user', 'restart', 'carl-operation.service'], { timeout: 10000 }); }
      finally { restartPromise = null; }
    })();
    await restartPromise;
    status = await askRaw('status');
  }
  if (status.protocol !== PROTOCOL) throw new OutdatedSupervisor(OUTDATED_MESSAGE);
  if (action === 'status') return status;
  const reply = await askRaw(action);
  if (reply.protocol !== PROTOCOL) throw new OutdatedSupervisor(OUTDATED_MESSAGE);
  return reply;
}

async function handle(request: Request, action: Action): Promise<Response> {
  if (!allowed(request)) return Response.json({ error: 'Only the local passenger display can control CARL.' }, { status: 403 });
  try { return Response.json(await ask(action)); }
  catch (error) {
    if (error instanceof OutdatedSupervisor)
      return Response.json({ state: 'fault', error: error.message }, { status: 409 });
    return Response.json({ state: 'fault', error: 'CARL supervisor is unavailable. CARL is no longer operational.' }, { status: 503 });
  }
}

export async function GET(request: Request) { return handle(request, 'status'); }
export async function POST(request: Request) {
  if (request.headers.get('origin') !== `http://${LOCAL}`) return Response.json({ error: 'Only the local passenger display can control CARL.' }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  if (!['start', 'stop', 'no-control', 'start-joystick', 'stop-joystick'].includes(body?.action)) return Response.json({ error: 'Unknown action' }, { status: 400 });
  return handle(request, body.action);
}
