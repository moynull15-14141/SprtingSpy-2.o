import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { spawnSync } from 'node:child_process';

/** Local TLS edge proxy: generated certificate is trusted only by this test's
 * Node client and Chrome SPKI pin. No OS trust-store or production TLS changes. */
export async function productionTransport(upstreamPort: number) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sportingspy-tls-'));
  const certPath = path.join(directory, 'certificate.pem');
  const keyPath = path.join(directory, 'private-key.pem');
  const openssl = process.env.TEST_OPENSSL || (process.platform === 'win32' ? 'C:/Program Files/Git/usr/bin/openssl.exe' : 'openssl');
  const generated = spawnSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-keyout', keyPath, '-out', certPath, '-subj', '/CN=sportingspy.test', '-addext', 'subjectAltName=DNS:sportingspy.test'], { windowsHide: true, env: { ...process.env, MSYS_NO_PATHCONV: '1' }, stdio: 'pipe' });
  if (generated.status !== 0) {
    fs.rmSync(directory, { recursive: true });
    throw new Error('Could not generate local TLS certificate. Set TEST_OPENSSL to an installed OpenSSL executable.');
  }
  const cert = fs.readFileSync(certPath);
  const spki = crypto.createHash('sha256').update(new crypto.X509Certificate(cert).publicKey.export({ type: 'spki', format: 'der' })).digest('base64');
  const forwardedIps: string[] = [];
  const proxy = https.createServer({ key: fs.readFileSync(keyPath), cert }, (req, res) => {
    // Edge overwrites ALL forwarded identity/transport headers, never appends
    // attacker-supplied values. Only the edge's loopback IP is trusted upstream.
    const headers = { ...req.headers, 'x-forwarded-for': req.socket.remoteAddress || '127.0.0.1', 'x-forwarded-proto': 'https', 'x-forwarded-host': req.headers.host };
    forwardedIps.push(headers['x-forwarded-for']);
    const upstream = http.request({ host: '127.0.0.1', port: upstreamPort, path: req.url, method: req.method, headers }, response => {
      res.writeHead(response.statusCode || 502, response.headers); response.pipe(res);
    });
    upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end('Upstream unavailable'); });
    req.pipe(upstream);
  });
  await new Promise<void>(resolve => proxy.listen(0, '127.0.0.1', resolve));
  const port = (proxy.address() as { port: number }).port;
  const origin = `https://sportingspy.test:${port}`;
  const request = async (url: string, init: RequestInit = {}): Promise<Response> => new Promise((resolve, reject) => {
    const parsed = new URL(url);
    assert.equal(parsed.origin, origin, 'Local smoke client may only contact its test proxy.');
    // Send an explicit Content-Length (as fetch does) instead of chunked encoding.
    const headers = { ...(init.headers as Record<string, string>) };
    if (typeof init.body === 'string') headers['Content-Length'] = String(Buffer.byteLength(init.body));
    const req = https.request(parsed, {
      method: init.method || 'GET', headers, ca: cert,
      // Node 22 calls lookup with { all: true } and expects an address list.
      lookup: ((_hostname: string, options: { all?: boolean }, callback: (...args: unknown[]) => void) =>
        options?.all ? callback(null, [{ address: '127.0.0.1', family: 4 }]) : callback(null, '127.0.0.1', 4)) as never,
    }, res => {
      const chunks: Buffer[] = [];
      res.on('data', chunk => chunks.push(Buffer.from(chunk)));
      res.on('end', () => {
        const headers = new Headers();
        for (let i = 0; i < res.rawHeaders.length; i += 2) headers.append(res.rawHeaders[i], res.rawHeaders[i + 1]);
        const status = res.statusCode!;
        resolve(new Response([204, 304].includes(status) || init.method === 'HEAD' ? null : Buffer.concat(chunks), { status, headers }));
      });
    });
    req.on('error', reject);
    if (init.body) req.write(init.body);
    req.end();
  });
  return {
    origin, request, forwardedIps,
    browserArgs: ['--host-resolver-rules=MAP sportingspy.test 127.0.0.1', `--ignore-certificate-errors-spki-list=${spki}`, '--no-proxy-server'],
    async close() {
      proxy.closeAllConnections();
      await new Promise<void>(resolve => proxy.close(() => resolve()));
      // The target is the exact mkdtemp result, never a shared directory.
      assert(path.dirname(directory) === os.tmpdir() && path.basename(directory).startsWith('sportingspy-tls-'));
      fs.rmSync(directory, { recursive: true });
    },
  };
}
