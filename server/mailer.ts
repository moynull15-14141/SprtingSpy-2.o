/**
 * PHASE U — Shared transactional e-mail delivery.
 *
 * A single place that talks to the Resend HTTP API via `fetch` (no new
 * dependency, exactly as the Phase R password-reset sender did). Password
 * reset (server/passwordReset.ts) and reader e-mail verification
 * (server/register.ts) both send through here, so the provider is configured
 * once and the "no provider → nothing sent" behaviour is identical.
 *
 * Secrets: RESEND_API_KEY and MAIL_FROM are read from the environment and are
 * NEVER logged. Message bodies contain one-time links/tokens and are likewise
 * never logged. Callers get back only a boolean (delivered or not).
 */

/** True when an e-mail provider is configured. */
export function mailConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return !!(env.RESEND_API_KEY && env.MAIL_FROM);
}

export interface MailMessage {
  to: string;
  subject: string;
  /** Plain-text body. HTML is intentionally not sent. */
  text: string;
}

/**
 * Sends one message. Returns false (never throws) when no provider is
 * configured or delivery fails, so a caller can record the outcome without the
 * request failing. The 10s timeout keeps a slow provider from hanging a route.
 */
export async function sendMail(message: MailMessage): Promise<boolean> {
  if (!mailConfigured()) return false;
  try {
    const response = await fetch(process.env.RESEND_API_URL || 'https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: process.env.MAIL_FROM, to: [message.to], subject: message.subject, text: message.text }),
      signal: AbortSignal.timeout(10_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}
