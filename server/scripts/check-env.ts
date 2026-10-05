/**
 * PHASE J: pre-deployment configuration check.
 *
 *   NODE_ENV=production APP_ENV=staging npm run check:env
 *
 * Runs the same validation the server runs at boot (deployment config and
 * media storage) and reports every problem it can find, without starting the
 * server, touching the database or printing any secret value.
 * Exit code 0 = ready to start; 1 = fix the listed problems first.
 */
import 'dotenv/config';
import { appEnv, deploymentConfig, DeploymentConfigError } from '../deployment';
import { s3ConfigFromEnv } from '../media/s3';
import { profileImageOrigins } from '../profileImage';

const problems: string[] = [];
const warnings: string[] = [];
const env = process.env;
const set = (k: string) => !!env[k]?.trim();

try { deploymentConfig(); } catch (e) { problems.push(e instanceof DeploymentConfigError ? e.message : 'Deployment configuration is invalid.'); }

const environment = appEnv();
const provider = (env.MEDIA_STORAGE_PROVIDER || 'local').trim().toLowerCase();
if (provider === 's3' || provider === 'r2') {
  try { s3ConfigFromEnv(env, provider); } catch (e) { problems.push((e as Error).message); }
} else if (provider === 'local') {
  if (environment !== 'development' && !set('MEDIA_LOCAL_DIR')) warnings.push('MEDIA_LOCAL_DIR is not set: uploads go to ./storage/media inside the app directory. Point it at a persistent, backed-up volume (or use MEDIA_STORAGE_PROVIDER=s3).');
} else problems.push(`MEDIA_STORAGE_PROVIDER "${provider}" is not supported; use "local", "s3" or "r2".`);
try { profileImageOrigins(); } catch (e) { problems.push((e as Error).message); }

if (environment !== 'development') {
  if (env.AUTH_MODE !== 'production') warnings.push('AUTH_MODE is not "production".');
  if (!set('TRUST_PROXY') || env.TRUST_PROXY === 'false') warnings.push('TRUST_PROXY is not set: behind a TLS-terminating proxy, HTTPS detection, HSTS and per-client rate limits need the proxy address.');
  if (set('DATABASE_URL')) {
    try {
      const db = new URL(env.DATABASE_URL!);
      if (['localhost', '127.0.0.1', '::1', '[::1]'].includes(db.hostname)) warnings.push('DATABASE_URL points at this machine. That is fine for a single-server install only if the database is backed up (see DEPLOYMENT.md).');
      if (!/sslmode=(require|verify-full|verify-ca)/.test(db.search) && !['localhost', '127.0.0.1', '::1', '[::1]'].includes(db.hostname)) warnings.push('DATABASE_URL has no sslmode=require: most managed PostgreSQL providers need TLS.');
    } catch { /* reported by deploymentConfig */ }
  }
  for (const k of ['DEV_BYPASS_USER_ID', 'ALLOW_THIRD_PARTY_IN_DEVELOPMENT']) if (set(k)) warnings.push(`${k} is a development-only variable and should not be set here.`);
  if (set('GEMINI_API_KEY') && env.GEMINI_API_KEY === 'MY_GEMINI_API_KEY') problems.push('GEMINI_API_KEY still has the .env.example placeholder value; remove it or set a real key.');
}

console.log(`Environment: ${environment} (NODE_ENV=${env.NODE_ENV ?? 'unset'}), media storage: ${provider}`);
for (const w of warnings) console.log(`WARN  ${w}`);
for (const p of problems) console.log(`FAIL  ${p}`);
if (problems.length) { console.log(`\n${problems.length} problem(s) must be fixed before starting.`); process.exit(1); }
console.log(`\nConfiguration OK${warnings.length ? ` (${warnings.length} warning(s))` : ''}. The default-password guard still runs at startup against the database.`);
