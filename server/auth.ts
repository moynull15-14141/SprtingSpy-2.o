/**
 * SportingSpy Server Authorization Boundary
 * =========================================
 * PHASE 2 — POSTGRESQL MIGRATION (identity resolution updated; see history).
 *
 * History:
 *   Phase 0.1 removed a critical vulnerability where the server trusted
 *   client-supplied `x-user-id`/`x-user-role` headers as identity proof, and
 *   replaced it with a server-operator-configured "development identity" —
 *   explicitly NOT real authentication, just a safe placeholder.
 *
 *   Phase 1 replaced that placeholder with REAL authentication: email+
 *   password login, server-side sessions (see server/session.ts), and real
 *   per-user identity resolved from an opaque session cookie. A narrow,
 *   explicitly-opt-in `DEV_LOGIN_BYPASS` remains for scripted/local testing
 *   convenience only; it never overrides a real session and is blocked
 *   outright from combining with AUTH_MODE=production.
 *
 *   Phase 2 (this file) changes ONLY how identity is looked up: instead of
 *   being handed full `users`/`sessions` arrays loaded from a JSON file,
 *   this file now calls a small async `AuthLookup` interface — a single
 *   indexed Postgres query per request (session id is the Session table's
 *   primary key), not a full-table load. server.ts implements that
 *   interface with two targeted Prisma queries. Nothing about the
 *   authorization LOGIC changed — same AuthContext shape, same
 *   requireAuth()/requireRole() contracts, same role matrix.
 *
 * Conceptual pipeline:
 *   Request -> getAuthContext() [this file] -> requireAuth()/requireRole() -> route handler
 */

import { Request, Response, NextFunction } from 'express';
import { Role } from '../src/types';
import { getSessionIdFromRequest } from './session';

export interface AuthContext {
  authenticated: boolean;
  /** 'anonymous' when unauthenticated. */
  userId: string;
  userName: string;
  /** Always 'Reader' when unauthenticated (least privilege). */
  role: Role;
  /** Where this identity came from. 'dev-bypass' only ever appears outside production, and only when explicitly enabled. */
  source: 'session' | 'dev-bypass' | 'anonymous';
}

declare module 'express-serve-static-core' {
  interface Request {
    authContext?: AuthContext;
  }
}

export interface ResolvedIdentity {
  userId: string;
  userName: string;
  role: Role;
}

/**
 * The only way this file reaches into persistence. server.ts implements
 * this with two targeted Prisma queries (Session.findUnique by id — the
 * table's primary key — joined to its User; and User.findUnique by id for
 * the dev bypass) instead of loading entire tables into memory.
 */
export interface AuthLookup {
  /** Resolves a session id to the identity it belongs to, or null if the session doesn't exist, is expired, or its user is inactive/deleted. */
  resolveSession(sessionId: string): Promise<ResolvedIdentity | null>;
  /** Resolves a specific user id for DEV_LOGIN_BYPASS only. */
  resolveBypassUser(userId: string): Promise<ResolvedIdentity | null>;
}

const ANONYMOUS: AuthContext = { authenticated: false, userId: 'anonymous', userName: 'Anonymous', role: 'Reader', source: 'anonymous' };

const DEV_LOGIN_BYPASS = process.env.DEV_LOGIN_BYPASS === 'true';
const DEV_BYPASS_USER_ID = process.env.DEV_BYPASS_USER_ID || '';

/**
 * Startup safety guard. DEV_LOGIN_BYPASS must never run alongside
 * AUTH_MODE=production — that combination would mean a "production" server
 * silently grants a fixed identity to any request with no session at all.
 */
export function assertSafeAuthBoot(): void {
  const authMode = process.env.AUTH_MODE || 'development';

  if ((authMode === 'production' || process.env.NODE_ENV === 'production') && DEV_LOGIN_BYPASS) {
    // eslint-disable-next-line no-console
    console.error(
      '[FATAL] DEV_LOGIN_BYPASS=true cannot be combined with AUTH_MODE=production. ' +
        'Refusing to start. Unset DEV_LOGIN_BYPASS to run in production mode.'
    );
    process.exit(1);
  }

  if (DEV_LOGIN_BYPASS) {
    // eslint-disable-next-line no-console
    console.warn(
      '[SportingSpy] DEV_LOGIN_BYPASS is enabled: any request with NO session cookie will be treated as ' +
        `${DEV_BYPASS_USER_ID ? `user '${DEV_BYPASS_USER_ID}'` : 'a default Reader'}. This exists purely for ` +
        'local/scripted testing convenience. It NEVER overrides a real logged-in session, and refuses to start ' +
        'at all under AUTH_MODE=production. Do not enable this anywhere reachable by the public internet.'
    );
  }
}

/**
 * Derives the AuthContext for a request from its session cookie via a
 * single targeted lookup. Falls back to the explicit, disabled-by-default
 * dev bypass only when there is no session cookie at all. Never reads any
 * client-supplied identity/role header.
 */
export async function getAuthContext(req: Request, lookup: AuthLookup): Promise<AuthContext> {
  const sessionId = getSessionIdFromRequest(req);

  if (sessionId) {
    const resolved = await lookup.resolveSession(sessionId);
    if (resolved) {
      return { authenticated: true, ...resolved, source: 'session' };
    }
    // Invalid, expired, or deactivated-user session: treat as anonymous.
    // The route handler that issued the cookie in the first place is
    // responsible for clearing it (see /api/auth/me in server.ts).
    return ANONYMOUS;
  }

  if (DEV_LOGIN_BYPASS && process.env.AUTH_MODE !== 'production' && process.env.NODE_ENV !== 'production') {
    const resolved = DEV_BYPASS_USER_ID ? await lookup.resolveBypassUser(DEV_BYPASS_USER_ID) : null;
    return {
      authenticated: true,
      userId: resolved?.userId || 'dev-bypass-user',
      userName: resolved?.userName || 'Local Dev Bypass',
      role: resolved?.role || 'Reader',
      source: 'dev-bypass',
    };
  }

  return ANONYMOUS;
}

export function attachAuthContext(getLookup: () => AuthLookup) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    req.authContext = await getAuthContext(req, getLookup());
    next();
  };
}

/** Rejects the request with 401 unless a valid session (or explicit dev bypass) is present. Does not check role. */
export function requireAuth(getLookup: () => AuthLookup) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = req.authContext || (await getAuthContext(req, getLookup()));
      req.authContext = ctx;
      if (!ctx.authenticated) {
        return res.status(401).json({ error: 'Authentication required. Please log in.' });
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** Rejects the request with 401 (no session) or 403 (wrong role) unless the caller's role is in allowedRoles. */
export function requireRole(getLookup: () => AuthLookup, allowedRoles: Role[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = req.authContext || (await getAuthContext(req, getLookup()));
      req.authContext = ctx;

      if (!ctx.authenticated) {
        return res.status(401).json({ error: 'Authentication required. Please log in.' });
      }
      if (!allowedRoles.includes(ctx.role)) {
        return res.status(403).json({
          error: `Forbidden: this action requires one of [${allowedRoles.join(', ')}]. Your role: '${ctx.role}'.`,
        });
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}
