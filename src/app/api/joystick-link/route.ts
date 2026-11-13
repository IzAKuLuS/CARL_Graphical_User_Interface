import { readFile } from 'node:fs/promises';
import os from 'node:os';
import QRCode from 'qrcode';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function lanAddress(): Promise<string | null> {
  const interfaces = os.networkInterfaces();
  let preferred: string | undefined;
  try {
    const routes = (await readFile('/proc/net/route', 'utf8')).split('\n').slice(1);
    preferred = routes.map(line => line.trim().split(/\s+/)).find(parts => parts[1] === '00000000' && (parseInt(parts[3], 16) & 1))?.[0];
  } catch { /* Other hosts can use the single-address fallback. */ }
  const addresses = Object.entries(interfaces).flatMap(([name, records]) =>
    (records || []).filter(record => record.family === 'IPv4' && !record.internal && !record.address.startsWith('169.254.'))
      .map(record => ({ name, address: record.address })));
  const routed = addresses.find(entry => entry.name === preferred);
  return routed?.address ?? (addresses.length === 1 ? addresses[0].address : null);
}

export async function GET(request: Request): Promise<Response> {
  if (request.headers.get('host') !== '127.0.0.1:3215')
    return Response.json({ error: 'Available only on the passenger display.' }, { status: 403 });
  const address = await lanAddress();
  if (!address) return Response.json({ error: 'No unambiguous network address is available. Connect CARL to the device network.' }, { status: 503 });
  const url = `http://${address}:8001/`;
  const qr = await QRCode.toDataURL(url, { margin: 1, width: 180, errorCorrectionLevel: 'M' });
  return Response.json({ url, qr }, { headers: { 'Cache-Control': 'no-store' } });
}
