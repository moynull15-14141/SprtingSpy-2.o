/**
 * SportingSpy Database Safety Guard
 * ===================================
 * PHASE 2.1 — POSTGRESQL HARDENING & MIGRATION SAFETY.
 *
 * A small, deliberately simple guard that any script capable of writing a
 * lot of rows (today: server/scripts/migrate-json-to-postgres.ts; tomorrow:
 * a real test suite, if one is added) can call before touching the
 * database, to make it harder for a wrong DATABASE_URL to cause real damage.
 *
 * This is NOT a claim that it can reliably detect "production" — there is
 * no universal way to do that from a connection string alone. It catches
 * the actual realistic local-dev mistakes:
 *   - DATABASE_URL pointing at a non-local host (a real hosted database
 *     someone pasted in by habit, or a leftover from a different project).
 *   - DATABASE_URL whose database name contains "prod"/"production".
 * Anyone who genuinely wants to run a bulk-write script against a remote or
 * production-sounding database can still do so by setting
 * `ALLOW_DESTRUCTIVE_DB_OPS=true` — this is a speed bump for the common
 * mistake, not a security boundary.
 */

const LOCAL_HOST_PATTERNS = ['localhost', '127.0.0.1', '::1'];
const PRODUCTION_NAME_PATTERNS = ['prod', 'production'];

export interface DbSafetyCheck {
  safe: boolean;
  reason?: string;
}

/**
 * Parses DATABASE_URL just enough to check its host and database name —
 * never logs or returns the credentials portion of the URL.
 */
export function checkDatabaseUrlIsLocalDev(databaseUrl: string | undefined): DbSafetyCheck {
  if (!databaseUrl) {
    return { safe: false, reason: 'DATABASE_URL is not set.' };
  }

  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    return { safe: false, reason: 'DATABASE_URL could not be parsed as a URL.' };
  }

  const host = parsed.hostname.toLowerCase();
  const dbName = parsed.pathname.replace(/^\//, '').toLowerCase();

  if (!LOCAL_HOST_PATTERNS.includes(host)) {
    return { safe: false, reason: `DATABASE_URL host "${host}" does not look like a local development database (expected localhost/127.0.0.1).` };
  }

  if (PRODUCTION_NAME_PATTERNS.some((p) => dbName.includes(p))) {
    return { safe: false, reason: `DATABASE_URL database name "${dbName}" looks production-related.` };
  }

  return { safe: true };
}

/**
 * Call this at the top of any script that will write many rows or run
 * potentially-destructive operations. Exits the process with a clear,
 * credential-free error if the target doesn't look like a safe local dev
 * database — unless explicitly overridden.
 */
export function assertSafeForBulkDbOperation(scriptName: string): void {
  if (process.env.ALLOW_DESTRUCTIVE_DB_OPS === 'true') {
    // eslint-disable-next-line no-console
    console.warn(`[${scriptName}] ALLOW_DESTRUCTIVE_DB_OPS=true — skipping the local-dev-database safety check.`);
    return;
  }

  const check = checkDatabaseUrlIsLocalDev(process.env.DATABASE_URL);
  if (!check.safe) {
    // eslint-disable-next-line no-console
    console.error(
      `[${scriptName}] REFUSING TO RUN: ${check.reason}\n` +
        `If this is genuinely intended, set ALLOW_DESTRUCTIVE_DB_OPS=true and re-run. ` +
        `This check exists to prevent accidentally pointing a bulk-write script at the wrong database.`
    );
    process.exit(1);
  }
}
