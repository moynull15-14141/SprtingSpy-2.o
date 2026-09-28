/**
 * PHASE C one-time media import: processes Media Library rows that point at
 * bundled files under /src/assets/images into stored originals + responsive
 * AVIF/WebP variants, and records their real dimensions and type. Row URLs
 * and every existing reference are left unchanged. Safe to re-run: rows
 * that already have a stored file are skipped.
 * Run: npm run media:import-legacy
 */
import 'dotenv/config';
import { prisma } from '../db';
import { importLegacyMedia } from '../media/service';

const result = await importLegacyMedia();
console.log(`[media:import-legacy] processed ${result.processed.length}: ${result.processed.join(', ') || '-'}`);
if (result.skipped.length) console.log(`[media:import-legacy] skipped: ${result.skipped.join('; ')}`);
await prisma.$disconnect();
