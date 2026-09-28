/**
 * Production launch guards (PHASE G). Checks that run once at startup and
 * refuse to serve a real production site in a known-unsafe state.
 *
 * Default passwords: every account imported from the original seed data was
 * given the publicly documented password LEGACY_SEED_DEFAULT_PASSWORD. On a
 * real production deployment (a public origin) the server will not start
 * while any active account still uses it. Local production-mode test runs —
 * a loopback origin, or a reserved test TLD (.test, .localhost, .invalid,
 * .example; RFC 2606/6761), which can never be a public site — get a warning
 * instead, so the existing verification suites keep working.
 *
 * Fix: npm run users:set-password -- <email>
 */

import { prisma } from './db';
import { verifyPassword } from './password';
import { LEGACY_SEED_DEFAULT_PASSWORD } from './jsonSchema';

export class LaunchGuardError extends Error {}

const isLocalOnlyOrigin = (origin: string | undefined) => {
  if (!origin) return true;
  try {
    const host = new URL(origin).hostname;
    return ['localhost', '127.0.0.1', '[::1]'].includes(host) || /\.(test|localhost|invalid|example)$/.test(host);
  } catch { return true; }
};

/** Roles of active accounts that still accept the documented default password. */
export async function accountsWithDefaultPassword(): Promise<string[]> {
  const users = await prisma.user.findMany({ where: { status: 'active' }, select: { role: true, passwordHash: true } });
  return users.filter((u) => verifyPassword(LEGACY_SEED_DEFAULT_PASSWORD, u.passwordHash)).map((u) => u.role);
}

export async function assertProductionLaunchSafe(deployment: { production: boolean; origin?: string }): Promise<void> {
  if (!deployment.production) return;
  const weak = await accountsWithDefaultPassword();
  if (!weak.length) return;
  const summary = `${weak.length} active account(s) (${weak.join(', ')}) still use the documented default password. Set real passwords with: npm run users:set-password -- <email>`;
  if (isLocalOnlyOrigin(deployment.origin)) {
    console.warn(`[SportingSpy] WARNING (local production-mode run): ${summary}`);
    return;
  }
  throw new LaunchGuardError(`Refusing to start: ${summary}`);
}
