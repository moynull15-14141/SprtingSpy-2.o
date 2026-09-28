import 'dotenv/config';
import { isIP } from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import type { Request, Response, NextFunction } from 'express';

export class DeploymentConfigError extends Error {}

export function deploymentConfig(env: NodeJS.ProcessEnv = process.env, buildExists = fs.existsSync(path.resolve('.next/BUILD_ID'))) {
  const production = env.NODE_ENV === 'production';
  const fail = (message: string): never => { throw new DeploymentConfigError(message); };
  const port = Number(env.PORT || '3000');
  if (!Number.isInteger(port) || port < 1 || port > 65535) fail('PORT must be an integer between 1 and 65535.');
  const host = env.HOST || '0.0.0.0';
  if (!isIP(host)) fail('HOST must be a bind IP address.');
  let origin: string | undefined;
  if (env.ALLOWED_ORIGIN) {
    let parsed: URL;
    try { parsed = new URL(env.ALLOWED_ORIGIN); } catch { fail('ALLOWED_ORIGIN must be a single canonical HTTP(S) origin.'); }
    if (!['http:', 'https:'].includes(parsed!.protocol) || parsed!.origin !== env.ALLOWED_ORIGIN) fail('ALLOWED_ORIGIN must be a single canonical HTTP(S) origin without a path, credentials or wildcard.');
    if (production && parsed!.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(parsed!.hostname)) fail('Production ALLOWED_ORIGIN requires HTTPS (HTTP loopback is only for local smoke tests).');
    origin = parsed!.origin;
  }
  let trustProxy: false | string[] = false;
  if (env.TRUST_PROXY && env.TRUST_PROXY !== 'false') {
    trustProxy = env.TRUST_PROXY.split(',').map(value => value.trim());
    for (const entry of trustProxy) {
      const parts = entry.split('/');
      const family = isIP(parts[0]);
      if (!family || parts.length > 2 || (parts.length === 2 && (!/^\d+$/.test(parts[1]) || Number(parts[1]) < 1 || Number(parts[1]) > (family === 4 ? 32 : 128)))) {
        fail('TRUST_PROXY must be false or explicit proxy IP addresses/CIDRs; blanket trust and hop counts are not allowed.');
      }
    }
  }
  if (production) {
    if (!env.DATABASE_URL) fail('DATABASE_URL is required in production.');
    try {
      const database = new URL(env.DATABASE_URL!);
      if (!['postgres:', 'postgresql:'].includes(database.protocol) || !database.hostname || database.pathname.length < 2) fail('DATABASE_URL must identify a PostgreSQL database.');
    } catch { fail('DATABASE_URL must identify a PostgreSQL database.'); }
    if (!origin) fail('ALLOWED_ORIGIN is required in production to identify the browser-facing service origin.');
    if (env.DEV_LOGIN_BYPASS === 'true') fail('DEV_LOGIN_BYPASS is forbidden when NODE_ENV=production.');
    if (!buildExists) fail('Production build missing: run npm run build before starting the server.');
  }
  return { production, port, host, origin, trustProxy };
}

export function enforceProductionTransport(req: Request, res: Response, next: NextFunction) {
  // Direct HTTP health probes (liveness and readiness) are allowed, but receive neither cookies nor HSTS.
  if (process.env.NODE_ENV === 'production' && process.env.ALLOWED_ORIGIN?.startsWith('https:') && !req.secure && req.path !== '/api/health' && req.path !== '/api/health/ready') {
    return res.status(426).json({ error: 'HTTPS is required.' });
  }
  next();
}
