/** Allowed-origin regression checks: the custom domain and the platform URL may
 * both sign in; every other origin stays refused. No database, no network.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { corsPolicy } from '../cors';
import { ensureCsrfCookie, requireCsrfToken } from '../csrf';
import { deploymentConfig } from '../deployment';

let checks = 0;
const pass = (name: string) => { checks++; console.log(`PASS ${name}`); };

const RENDER = 'https://sprtingspy-2-o.onrender.com';
const APEX = 'https://sportingspy.com';
const WWW = 'https://www.sportingspy.com';

const staging: NodeJS.ProcessEnv = { NODE_ENV: 'production', APP_ENV: 'staging', DATABASE_URL: 'postgresql://fixture:fixture@db.example.invalid/sportingspy', ALLOWED_ORIGIN: APEX, HOST: '127.0.0.1', TRUST_PROXY: '127.0.0.1/32' };
assert.equal(deploymentConfig(staging, true).origin, APEX);
assert.equal(deploymentConfig({ ...staging, ADDITIONAL_ALLOWED_ORIGINS: `${RENDER}, ${WWW}` }, true).origin, APEX, 'extra origins never replace the canonical origin');
for (const value of ['*', 'https://*.sportingspy.com', 'http://sportingspy.com', 'https://sportingspy.com/', 'https://sportingspy.com/admin', 'https://user:pass@sportingspy.com', 'sportingspy.com', `${RENDER},*`, 'null']) {
  assert.throws(() => deploymentConfig({ ...staging, ADDITIONAL_ALLOWED_ORIGINS: value }, true), /ADDITIONAL_ALLOWED_ORIGINS/, `startup must refuse ADDITIONAL_ALLOWED_ORIGINS=${value}`);
}
// The public site's canonical host is the apex domain; the extra list cannot stand in for it.
assert.equal(deploymentConfig({ ...staging, APP_ENV: 'production', ADDITIONAL_ALLOWED_ORIGINS: RENDER }, true).origin, APEX);
assert.throws(() => deploymentConfig({ ...staging, APP_ENV: 'production', ALLOWED_ORIGIN: WWW, ADDITIONAL_ALLOWED_ORIGINS: APEX }, true), /ALLOWED_ORIGIN=https:\/\/sportingspy\.com/);
assert.throws(() => deploymentConfig({ ...staging, APP_ENV: 'production', ALLOWED_ORIGIN: RENDER, ADDITIONAL_ALLOWED_ORIGINS: APEX }, true), /ALLOWED_ORIGIN=https:\/\/sportingspy\.com/);
pass('startup accepts exact HTTPS extra origins and refuses wildcards, HTTP, paths, credentials and bare hosts');

// The real middleware chain in front of a stand-in for the login handler.
const app = express();
app.use(corsPolicy);
app.use(express.json());
app.use(ensureCsrfCookie);
app.use(requireCsrfToken);
let reached = 0;
app.post('/api/auth/login', (_req, res) => { reached++; res.status(401).json({ error: 'Invalid email or password.' }); });
const server = http.createServer(app);
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

const login = (origin?: string, csrf = true) => fetch(`${base}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}), ...(csrf ? { Cookie: 'csrf_token=fixture', 'x-csrf-token': 'fixture' } : {}) },
  body: JSON.stringify({ email: 'fixture@example.test', password: 'fixture' }),
});
const preflight = (origin: string) => fetch(`${base}/api/auth/login`, { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,x-csrf-token' } });

const saved = { NODE_ENV: process.env.NODE_ENV, ALLOWED_ORIGIN: process.env.ALLOWED_ORIGIN, ADDITIONAL_ALLOWED_ORIGINS: process.env.ADDITIONAL_ALLOWED_ORIGINS };
const setEnv = (values: Record<string, string | undefined>) => { for (const [key, value] of Object.entries(values)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } };
try {
  // The reported fault: the service only knows its platform URL.
  setEnv({ NODE_ENV: 'production', ALLOWED_ORIGIN: RENDER, ADDITIONAL_ALLOWED_ORIGINS: undefined });
  assert.equal((await login(RENDER)).status, 401);
  const refused = await login(APEX);
  assert.equal(refused.status, 403); assert.deepEqual(await refused.json(), { error: 'Origin not allowed.' });
  pass('reproduced: with only the platform URL configured, sign-in from the custom domain is refused');

  setEnv({ ALLOWED_ORIGIN: APEX, ADDITIONAL_ALLOWED_ORIGINS: ` ${RENDER} , ${WWW} ` });
  for (const origin of [APEX, RENDER, WWW]) {
    reached = 0;
    const response = await login(origin);
    assert.equal(response.status, 401, `${origin} must reach the login handler`); assert.equal(reached, 1);
    assert.equal(response.headers.get('access-control-allow-origin'), origin);
    assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
    assert(response.headers.get('vary')?.includes('Origin'));
    const options = await preflight(origin);
    assert.equal(options.status, 204); assert.equal(options.headers.get('access-control-allow-origin'), origin);
  }
  pass('sign-in from sportingspy.com, www.sportingspy.com and the Render URL reaches the login handler');

  for (const origin of ['https://unapproved.example', 'http://sportingspy.com', 'https://sportingspy.com.evil.example', 'https://evil-sportingspy.com', 'https://admin.sportingspy.com', 'https://sportingspy.com:8443', 'https://SPORTINGSPY.com.', 'null', base]) {
    reached = 0;
    const response = await login(origin);
    assert.equal(response.status, 403, `${origin} must be refused`); assert.equal(reached, 0);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
    assert.equal(response.headers.get('access-control-allow-credentials'), null);
    const options = await preflight(origin);
    assert.equal(options.status, 403); assert.equal(options.headers.get('access-control-allow-origin'), null);
  }
  pass('look-alike, HTTP, subdomain, other-port, null and same-host origins are refused before the handler; nothing is reflected');

  reached = 0;
  const noToken = await login(APEX, false);
  assert.equal(noToken.status, 403); assert.match((await noToken.json()).error, /CSRF/); assert.equal(reached, 0);
  const noOrigin = await login(undefined, false);
  assert.equal(noOrigin.status, 403); assert.equal(reached, 0);
  pass('an allowed origin still needs the CSRF token; requests without Origin still need it too');
} finally {
  setEnv(saved);
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
}
console.log(`Allowed-origin verification passed: ${checks} checks.`);
