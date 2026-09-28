/**
 * Refuses to continue unless DATABASE_URL points at a local development
 * database (PHASE G). Runs before `npm run db:migrate` (`prisma migrate dev`),
 * which can offer to RESET the database when it detects drift and so must
 * never run against a database holding real data.
 *
 * Production and staging apply existing migrations with
 * `npm run db:migrate:deploy` (never resets, never creates migrations),
 * which this guard does not block.
 */
import 'dotenv/config';
import { checkDatabaseUrlIsLocalDev } from '../dbSafety';

const check = checkDatabaseUrlIsLocalDev(process.env.DATABASE_URL);
if (!check.safe) {
  console.error(`[db-guard] Refusing: ${check.reason}`);
  console.error('[db-guard] `prisma migrate dev` is for local development only. On staging/production use: npm run db:migrate:deploy');
  process.exit(1);
}
