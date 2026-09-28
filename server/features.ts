/**
 * Launch feature flags (Spec v1.1 §2.2 "Not required at launch").
 *
 * Reader accounts and comments are fully implemented but switched OFF for
 * launch. Their code and stored data are preserved; set the env var to
 * "true" to re-enable. Flags are read from the server environment only —
 * the copy sent to the browser is for display, never for authorization.
 *
 *   ENABLE_READER_ACCOUNTS  Reader-role logins, the Reader role in staff
 *                           management, and the account-area language switch.
 *   ENABLE_COMMENTS         Public comment display/submission and moderation.
 */

import type { FeatureFlags } from '../src/types';

function flag(name: string): boolean {
  return (process.env[name] || '').trim().toLowerCase() === 'true';
}

export function featureFlags(): FeatureFlags {
  return {
    readerAccounts: flag('ENABLE_READER_ACCOUNTS'),
    comments: flag('ENABLE_COMMENTS'),
  };
}
