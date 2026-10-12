/**
 * Isolation check for the WordPress migration pilot. A write-capable pilot
 * step must call this first and stop on any problem. It only reads the
 * environment it is given; it opens no connection.
 *
 * The pilot runs with DOTENV_CONFIG_PATH pointing at its own env file, so the
 * project's .env (which may point at the hosted database) is never loaded.
 */
export const PILOT_DATABASE_NAME = /^sportingspy_wp_pilot(_[a-z0-9]+)?$/;
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
/** Settings that would let the pilot reach anything outside this machine. */
export const MUST_BE_EMPTY = ['MEDIA_S3_BUCKET', 'MEDIA_S3_ENDPOINT', 'MEDIA_S3_ACCESS_KEY_ID', 'MEDIA_S3_SECRET_ACCESS_KEY', 'MEDIA_S3_SESSION_TOKEN', 'MEDIA_PUBLIC_BASE_URL', 'INDEXNOW_ENDPOINT', 'RESEND_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_SEARCH_CONSOLE_CREDENTIALS', 'BING_WEBMASTER_API_KEY', 'SHADOW_DATABASE_URL'];

export function checkPilotIsolation(env: Record<string, string | undefined>): { safe: boolean; problems: string[] } {
  const problems: string[] = [];
  const envFile = (env.DOTENV_CONFIG_PATH ?? '').replace(/\\/g, '/');
  if (!envFile) problems.push('DOTENV_CONFIG_PATH is not set: the project .env would be loaded.');
  else if (/(^|\/)\.env$/.test(envFile)) problems.push('DOTENV_CONFIG_PATH points at the project .env.');

  let url: URL | undefined;
  try { url = new URL(env.DATABASE_URL ?? ''); } catch { problems.push('DATABASE_URL is missing or not a URL.'); }
  if (url) {
    if (!['postgres:', 'postgresql:'].includes(url.protocol)) problems.push('DATABASE_URL is not a PostgreSQL URL.');
    if (!LOOPBACK.has(url.hostname.toLowerCase())) problems.push(`DATABASE_URL host "${url.hostname}" is not this machine.`);
    const name = decodeURIComponent(url.pathname.slice(1));
    if (!PILOT_DATABASE_NAME.test(name)) problems.push(`DATABASE_URL database "${name}" is not a pilot database (expected sportingspy_wp_pilot).`);
  }

  if ((env.MEDIA_STORAGE_PROVIDER || 'local') !== 'local') problems.push(`MEDIA_STORAGE_PROVIDER is "${env.MEDIA_STORAGE_PROVIDER}"; the pilot uses local storage only.`);
  if (!env.MEDIA_LOCAL_DIR) problems.push('MEDIA_LOCAL_DIR is not set: the pilot needs its own media folder.');
  for (const key of MUST_BE_EMPTY) if (env[key]) problems.push(`${key} must be empty for the pilot.`);
  if (env.NODE_ENV === 'production') problems.push('NODE_ENV is production.');
  if (env.APP_ENV && env.APP_ENV !== 'development') problems.push(`APP_ENV is "${env.APP_ENV}"; the pilot runs as development.`);
  if (env.ALLOW_DESTRUCTIVE_DB_OPS === 'true') problems.push('ALLOW_DESTRUCTIVE_DB_OPS must not be set.');
  if (env.ALLOWED_ORIGIN) {
    try { if (!LOOPBACK.has(new URL(env.ALLOWED_ORIGIN).hostname.toLowerCase())) problems.push('ALLOWED_ORIGIN is not a local address.'); }
    catch { problems.push('ALLOWED_ORIGIN is not a URL.'); }
  }
  return { safe: problems.length === 0, problems };
}
