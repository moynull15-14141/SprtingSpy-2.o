import 'dotenv/config';
import { BlockList, isIP } from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import type { Request, Response, NextFunction } from 'express';

export class DeploymentConfigError extends Error {}

/**
 * PHASE J: which environment this process serves. NODE_ENV=production means
 * "production build and hardening"; APP_ENV says whether that build is the
 * public site or a staging copy. Staging runs the same production code path
 * but is kept out of search engines (robots.txt Disallow: /, X-Robots-Tag
 * noindex on every response) and never notifies IndexNow.
 */
export const APP_ENVS = ['development', 'staging', 'production'] as const;
export type AppEnv = (typeof APP_ENVS)[number];

/** Placeholder values from .env.example that must never reach a real deployment. */
const PLACEHOLDER_DATABASE = /\/\/USER:PASSWORD@|\/\/user:password@/;

export function appEnv(env: NodeJS.ProcessEnv = process.env): AppEnv {
  const value = env.APP_ENV?.trim().toLowerCase();
  if (value && (APP_ENVS as readonly string[]).includes(value)) return value as AppEnv;
  return env.NODE_ENV === 'production' ? 'production' : 'development';
}

export function deploymentConfig(env: NodeJS.ProcessEnv = process.env, buildExists = fs.existsSync(path.resolve('.next/BUILD_ID'))) {
  const production = env.NODE_ENV === 'production';
  const fail = (message: string): never => { throw new DeploymentConfigError(message); };
  if (env.APP_ENV && !(APP_ENVS as readonly string[]).includes(env.APP_ENV.trim().toLowerCase())) fail(`APP_ENV must be one of ${APP_ENVS.join(', ')}.`);
  const environment = appEnv(env);
  if (!production && environment !== 'development') fail(`APP_ENV=${environment} requires NODE_ENV=production (use npm run start:production).`);
  if (production && environment === 'development') fail('NODE_ENV=production requires APP_ENV=staging or production; do not reuse development configuration.');
  if (env.DATABASE_URL && PLACEHOLDER_DATABASE.test(env.DATABASE_URL)) fail('DATABASE_URL still contains the USER:PASSWORD placeholder from .env.example.');
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
      // Local production smoke tests are allowed; public production must not
      // accidentally consume a development/test database copied from a shell.
      const localSmoke = origin && ['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname);
      if (environment === 'production' && !localSmoke && /(?:^|[_-])(dev|development|test|testing)(?:$|[_-])/i.test(decodeURIComponent(database.pathname.slice(1)))) fail('APP_ENV=production must not target a development/test database.');
    } catch (error) { if (error instanceof DeploymentConfigError) throw error; fail('DATABASE_URL must identify a PostgreSQL database.'); }
    if (env.SHADOW_DATABASE_URL?.trim()) fail('SHADOW_DATABASE_URL must be unset for production-mode startup; deployment uses existing migrations without a shadow database.');
    if (!origin) fail('ALLOWED_ORIGIN is required in production to identify the browser-facing service origin.');
    if (environment === 'production' && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname) && origin !== 'https://www.sportingspy.com') fail('APP_ENV=production requires ALLOWED_ORIGIN=https://www.sportingspy.com (local loopback smoke tests are exempt).');
    if (env.DEV_LOGIN_BYPASS === 'true') fail('DEV_LOGIN_BYPASS is forbidden when NODE_ENV=production.');
    if (!buildExists) fail('Production build missing: run npm run build before starting the server.');
    if (env.ALLOW_DESTRUCTIVE_DB_OPS === 'true') fail('ALLOW_DESTRUCTIVE_DB_OPS is a local-development switch and is forbidden when NODE_ENV=production.');
    if (env.SHOW_AD_PLACEHOLDERS === 'true' && environment === 'production') fail('SHOW_AD_PLACEHOLDERS is for development only and is forbidden in APP_ENV=production.');
  }
  return { production, port, host, origin, trustProxy, appEnv: environment };
}

let proxyHintLogged = false;
let proxyChainLogged = false;

// Loopback and private ranges: a client address resolving into one of these
// behind a platform proxy means TRUST_PROXY is missing a hop (or trusts too few).
const internalAddresses = new BlockList();
for (const [net, prefix] of [['127.0.0.0', 8], ['10.0.0.0', 8], ['172.16.0.0', 12], ['192.168.0.0', 16], ['169.254.0.0', 16], ['100.64.0.0', 10]] as const) internalAddresses.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of [['::1', 128], ['fc00::', 7], ['fe80::', 10]] as const) internalAddresses.addSubnet(net, prefix, 'ipv6');
const addressClass = (ip: string | undefined) => {
  const v4 = ip?.startsWith('::ffff:') && isIP(ip.slice(7)) === 4 ? ip.slice(7) : ip;
  const family = v4 ? isIP(v4) : 0;
  if (!family) return 'unknown';
  return internalAddresses.check(v4!, family === 4 ? 'ipv4' : 'ipv6') ? 'internal' : 'public';
};

export function enforceProductionTransport(req: Request, res: Response, next: NextFunction) {
  // Direct HTTP health probes (liveness and readiness) are allowed, but receive neither cookies nor HSTS.
  if (process.env.NODE_ENV === 'production' && process.env.ALLOWED_ORIGIN?.startsWith('https:') && !req.secure && req.path !== '/api/health' && req.path !== '/api/health/ready') {
    // PHASE R (deployment): a request that arrived over HTTPS through the
    // platform proxy but is not trusted as such points at TRUST_PROXY. Logged
    // once, with the proxy's address only (no client data).
    if (!proxyHintLogged && req.get('x-forwarded-proto') === 'https') {
      proxyHintLogged = true;
      const peer = req.socket.remoteAddress || 'unknown';
      const exact = isIP(peer) === 4 ? `${peer}/32` : isIP(peer) === 6 ? `${peer}/128` : peer;
      console.warn(`[SportingSpy] HTTPS request rejected: the reverse proxy at ${peer} is not in TRUST_PROXY. Add exactly ${exact} to TRUST_PROXY (never blanket trust).`);
    }
    return res.status(426).json({ error: 'HTTPS is required.' });
  }
  // Once per process, confirm the forwarded chain resolves to a real client so
  // per-client rate limits work. Logs hop count and address classes, never addresses.
  if (!proxyChainLogged && req.secure && req.get('x-forwarded-for')) {
    proxyChainLogged = true;
    const hops = (req.get('x-forwarded-for') || '').split(',').map(v => v.trim()).filter(Boolean);
    const resolved = addressClass(req.ip);
    console.log(`[SportingSpy] Proxy chain: peer ${addressClass(req.socket.remoteAddress)}, X-Forwarded-For ${hops.length} hop(s) [${hops.map(addressClass).join(', ')}], client address resolves ${resolved}.${resolved === 'public' ? '' : ' Rate limits would group visitors: add the internal hop to TRUST_PROXY.'}`);
  }
  next();
}
