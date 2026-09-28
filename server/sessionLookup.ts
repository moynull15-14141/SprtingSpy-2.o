/**
 * Session → identity resolution (PHASE C: extracted so Express and the
 * Next.js staff preview use the exact same rules).
 *
 * A session authenticates only if it exists, has not expired, belongs to an
 * active user, and that user's role is currently allowed (Reader accounts are
 * launch-disabled unless ENABLE_READER_ACCOUNTS=true).
 */

import { prisma } from './db';
import { featureFlags } from './features';
import type { Role } from '../src/types';

export interface SessionIdentity {
  userId: string;
  userName: string;
  role: Role;
}

export function allowedRoles(): Role[] {
  return featureFlags().readerAccounts ? ['Admin', 'Editor', 'Author', 'Reader'] : ['Admin', 'Editor', 'Author'];
}

export async function resolveSessionIdentity(sessionId: string | undefined): Promise<SessionIdentity | null> {
  if (!sessionId || sessionId.length > 200) return null;
  const session = await prisma.session.findUnique({ where: { id: sessionId }, include: { user: true } });
  if (!session || session.expiresAt.getTime() <= Date.now()) return null;
  if (!session.user || session.user.status !== 'active') return null;
  if (!allowedRoles().includes(session.user.role)) return null;
  return { userId: session.user.id, userName: session.user.name, role: session.user.role };
}
