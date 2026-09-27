/**
 * SportingSpy In-Memory Rate Limiting
 * ====================================
 * PHASE 1 introduced a login-only limiter. PHASE 3 generalizes the same
 * fixed-window logic into a small reusable factory so comment submission
 * and sensitive staff operations can reuse it too, without duplicating the
 * bucket bookkeeping — the login limiter's behavior/thresholds are
 * unchanged from Phase 1.
 *
 * KNOWN LIMITATION (unchanged from Phase 1, applies to every limiter built
 * from this factory): this state lives in the Node process's memory only.
 *   - It resets whenever the server restarts.
 *   - It does NOT share state across multiple server instances/processes —
 *     if this app is ever horizontally scaled, each instance enforces its
 *     own independent limit, effectively multiplying the real allowance.
 * A production-grade multi-instance deployment should replace this with a
 * shared store (Redis, or a database table). This is intentionally
 * "keep it simple" for the current single-process local/dev architecture,
 * not a claim of distributed protection.
 */

interface Bucket {
  count: number;
  windowStart: number;
}

export interface RateLimiter {
  /** Returns whether `key` is currently blocked, and if so, how many seconds until the window resets. */
  check(key: string): { limited: boolean; retryAfterSeconds?: number };
  /** Call after a countable event (a failed login, a posted comment, a sensitive action) for `key`. */
  record(key: string): void;
  /** Call to reset `key`'s count immediately (e.g. after a successful login). */
  clear(key: string): void;
}

export function createRateLimiter(windowMs: number, maxAttempts: number): RateLimiter {
  const buckets = new Map<string, Bucket>();

  return {
    check(key: string) {
      const now = Date.now();
      const bucket = buckets.get(key);
      if (!bucket || now - bucket.windowStart > windowMs) {
        return { limited: false };
      }
      if (bucket.count >= maxAttempts) {
        const retryAfterSeconds = Math.ceil((bucket.windowStart + windowMs - now) / 1000);
        return { limited: true, retryAfterSeconds };
      }
      return { limited: false };
    },
    record(key: string) {
      const now = Date.now();
      const bucket = buckets.get(key);
      if (!bucket || now - bucket.windowStart > windowMs) {
        buckets.set(key, { count: 1, windowStart: now });
        return;
      }
      bucket.count += 1;
    },
    clear(key: string) {
      buckets.delete(key);
    },
  };
}

// ── Login (Phase 1 thresholds, unchanged: 8 attempts / 15 minutes, keyed by IP+email) ──
const loginLimiter = createRateLimiter(15 * 60 * 1000, 8);

function loginKey(ip: string, email: string): string {
  return `${ip}|${email.toLowerCase().trim()}`;
}

export function checkLoginRateLimit(ip: string, email: string): { limited: boolean; retryAfterSeconds?: number } {
  return loginLimiter.check(loginKey(ip, email));
}
export function recordFailedLogin(ip: string, email: string): void {
  loginLimiter.record(loginKey(ip, email));
}
export function clearLoginRateLimit(ip: string, email: string): void {
  loginLimiter.clear(loginKey(ip, email));
}

// ── Comments (PHASE 3): 5 submissions / 5 minutes per authenticated user ──
const commentLimiter = createRateLimiter(5 * 60 * 1000, 5);

export function checkCommentRateLimit(userId: string): { limited: boolean; retryAfterSeconds?: number } {
  return commentLimiter.check(userId);
}
export function recordComment(userId: string): void {
  commentLimiter.record(userId);
}

// ── Sensitive staff operations (PHASE 3): a generous sanity ceiling on
// staff-account creation, so a runaway script or compromised Admin session
// can't silently mass-create accounts. Not a hard security boundary —
// Admin already has full privileges — just an abuse-shape guard.
const staffCreationLimiter = createRateLimiter(60 * 60 * 1000, 20);

export function checkStaffCreationRateLimit(actingUserId: string): { limited: boolean; retryAfterSeconds?: number } {
  return staffCreationLimiter.check(actingUserId);
}
export function recordStaffCreation(actingUserId: string): void {
  staffCreationLimiter.record(actingUserId);
}
