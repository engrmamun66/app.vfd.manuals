import type { IncomingMessage } from 'node:http';
import { config } from '../config.js';

const strip = (ip: string) => ip.replace(/^::ffff:/, '');

/** Trust X-Forwarded-For only when the direct peer is an explicitly configured trusted proxy. */
export function clientIp(req: IncomingMessage): string {
  const peer = strip(req.socket?.remoteAddress || 'unknown');
  if (!config.trustedProxies.length || !config.trustedProxies.includes(peer)) return peer;
  const xff = String(req.headers['x-forwarded-for'] || '')
    .split(',')
    .map((s) => strip(s.trim()))
    .filter(Boolean);
  // Walk from the right, skipping trusted proxies; the first untrusted hop is the client.
  for (let i = xff.length - 1; i >= 0; i--) if (!config.trustedProxies.includes(xff[i])) return xff[i];
  return peer;
}
