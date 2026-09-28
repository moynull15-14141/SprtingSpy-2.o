/**
 * Sets a user's password from the command line (PHASE G). Intended for
 * replacing the documented seed default before launch, or for recovering an
 * Admin account. Non-destructive: it changes one user's password hash,
 * signs that user out everywhere and writes an audit-log entry.
 *
 *   npm run users:set-password -- someone@example.com
 *
 * The new password is read from standard input (typed without echo in a
 * terminal, or piped), never from the command line, so it does not end up
 * in shell history or process listings.
 */
import 'dotenv/config';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { prisma } from '../db';
import { hashPassword, validatePasswordStrength } from '../password';
import { LEGACY_SEED_DEFAULT_PASSWORD } from '../jsonSchema';

async function readSecret(prompt: string): Promise<string> {
  if (!process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks).toString('utf8').split(/\r?\n/)[0];
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const write = (rl as unknown as { _writeToOutput: (s: string) => void });
  process.stdout.write(prompt);
  write._writeToOutput = () => { /* hide typed characters */ };
  const answer = await new Promise<string>((resolve) => rl.question('', resolve));
  rl.close();
  process.stdout.write('\n');
  return answer;
}

const email = (process.argv[2] || '').trim().toLowerCase();
if (!email) { console.error('Usage: npm run users:set-password -- <email>'); process.exit(2); }

try {
  const user = await prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } }, select: { id: true, role: true } });
  if (!user) { console.error('No user with that e-mail address.'); process.exit(1); }
  const password = await readSecret('New password: ');
  const strength = validatePasswordStrength(password);
  if (!strength.valid) { console.error(strength.error); process.exit(1); }
  if (password === LEGACY_SEED_DEFAULT_PASSWORD) { console.error('That is the documented default password; choose another.'); process.exit(1); }
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { passwordHash: hashPassword(password), updatedAt: new Date() } }),
    prisma.session.deleteMany({ where: { userId: user.id } }),
    prisma.auditLog.create({ data: { id: `log-${crypto.randomUUID()}`, userId: user.id, userName: 'CLI', action: 'Password Set (CLI)', entityType: 'User', entityId: user.id, timestamp: new Date(), details: `Password set from the command line for a ${user.role} account; existing sessions were signed out.` } }),
  ]);
  console.log(`Password updated for the ${user.role} account; its sessions were signed out.`);
} finally {
  await prisma.$disconnect();
}
