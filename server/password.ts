/**
 * SportingSpy Password Hashing
 * ============================
 * PHASE 1 — AUTHENTICATION & STAFF IDENTITY.
 *
 * Uses Node's built-in `crypto.scrypt` (no new dependency — scrypt is a
 * well-established, memory-hard password hashing function, standardized in
 * RFC 7914, and has shipped in Node's standard library since v10). Every
 * password gets its own random 16-byte salt; verification uses a
 * constant-time comparison to avoid leaking timing information about how
 * much of the hash matched.
 *
 * Stored format: "scrypt:<saltHex>:<hashHex>" — self-describing so the
 * scheme can be changed later (e.g. to argon2) without breaking existing
 * hashes; verifyPassword() would just dispatch on the scheme prefix.
 */

import crypto from 'crypto';

const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
const SCHEME = 'scrypt';

export function hashPassword(plainTextPassword: string): string {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const derivedKey = crypto.scryptSync(plainTextPassword, salt, KEY_LENGTH);
  return `${SCHEME}:${salt.toString('hex')}:${derivedKey.toString('hex')}`;
}

export function verifyPassword(plainTextPassword: string, storedHash: string | undefined | null): boolean {
  if (!storedHash) return false;
  const parts = storedHash.split(':');
  if (parts.length !== 3 || parts[0] !== SCHEME) return false;

  try {
    const salt = Buffer.from(parts[1], 'hex');
    const expected = Buffer.from(parts[2], 'hex');
    const actual = crypto.scryptSync(plainTextPassword, salt, expected.length);
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/**
 * Minimal password policy: length only. Deliberately not requiring a mix of
 * character classes — length is a stronger real-world signal of strength
 * than complexity rules, and simple rules are easier for staff to satisfy
 * without resorting to predictable substitutions ("Password1!").
 */
export function validatePasswordStrength(password: unknown): { valid: boolean; error?: string } {
  if (typeof password !== 'string') {
    return { valid: false, error: 'password must be a string.' };
  }
  if (password.length < 8) {
    return { valid: false, error: 'password must be at least 8 characters.' };
  }
  if (password.length > 200) {
    return { valid: false, error: 'password is too long.' };
  }
  return { valid: true };
}
