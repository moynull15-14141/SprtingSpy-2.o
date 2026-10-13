/**
 * Image processing checks for a small instance: which sizes and formats an
 * upload produces, that one image is processed at a time on one thread, and
 * that a large upload stays within a fixed memory budget.
 * Generated images only: no database, no network, no storage.
 */
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { processUpload, UploadRejected, variantFormats } from '../media/processing';
import { toMediaAsset } from '../../src/lib/media';

let checks = 0;
const pass = (name: string) => { checks++; console.log(`PASS ${name}`); };
const noise = (width: number, height: number, channels: 3 | 4 = 3) => sharp({ create: { width, height, channels, background: { r: 90, g: 120, b: 60, alpha: 0.5 }, noise: { type: 'gaussian', mean: 128, sigma: 30 } } });
const widthsOf = (image: Awaited<ReturnType<typeof processUpload>>, format: string) => image.variants.filter((v) => v.format === format).map((v) => v.width);

// ── Settings ──
delete process.env.MEDIA_VARIANT_FORMATS;
assert.deepEqual(variantFormats(), ['webp']);
assert.deepEqual(variantFormats({ MEDIA_VARIANT_FORMATS: ' WebP , avif ' }), ['avif', 'webp']);
assert.deepEqual(variantFormats({ MEDIA_VARIANT_FORMATS: 'avif' }), ['avif']);
for (const bad of ['jpeg', 'webp,gif', ',']) assert.throws(() => variantFormats({ MEDIA_VARIANT_FORMATS: bad }), /MEDIA_VARIANT_FORMATS/);
assert.equal(sharp.concurrency(), 1);
assert.equal(sharp.cache().memory.max, 0);
pass('formats default to WebP, AVIF is opt-in (listed first), other values are refused; one image-library thread, no cache');

// ── Default output ──
const photo = await noise(1800, 1200).jpeg({ quality: 90 }).withExif({ IFD0: { Copyright: 'secret-owner' } }).toBuffer();
const jpg = await processUpload(photo, 'photo.jpg', 'image/jpeg');
assert.deepEqual([jpg.format, jpg.width, jpg.height], ['jpeg', 1800, 1200]);
assert.deepEqual(jpg.variants.map((v) => `${v.format} ${v.width}x${v.height}`), ['webp 400x267', 'webp 800x533', 'webp 1600x1067', 'webp 1800x1200']);
for (const v of jpg.variants) {
  const meta = await sharp(v.data).metadata();
  assert.deepEqual([meta.format, meta.width, meta.height], ['webp', v.width, v.height]);
}
assert.equal((await sharp(jpg.original).metadata()).exif, undefined);
pass('JPEG 1800×1200: same-size original without EXIF; WebP at 400/800/1600/1800, each decodable at its stated size');

const small = await processUpload(await noise(300, 200).png().toBuffer(), 'small.png', 'image/png');
assert.deepEqual(small.variants.map((v) => `${v.format} ${v.width}x${v.height}`), ['webp 300x200']);
const alpha = await processUpload(await noise(640, 400, 4).png().toBuffer(), 'alpha.png', 'image/png');
assert.equal((await sharp(alpha.variants[0].data).metadata()).hasAlpha, true);
assert.equal((await sharp(alpha.original).metadata()).hasAlpha, true);
pass('never upscaled (300px image → one 300px size); transparency kept in the original and the sizes');

const turned = await processUpload(await noise(900, 600).jpeg().withMetadata({ orientation: 6 }).toBuffer(), 'turned.jpg', 'image/jpeg');
assert.deepEqual([turned.width, turned.height], [600, 900]);
assert.deepEqual(turned.variants.map((v) => `${v.width}x${v.height}`), ['400x600', '600x900']);
pass('EXIF orientation applied before sizing');

// ── Delivery: images stored before and after the change ──
const row = (formats: string[]) => ({ id: 'm', url: '/media/2026/10/x/original.jpg', storageKey: '2026/10/x/original.jpg', width: 1800, height: 1200, altText: 'alt', variants: [400, 800].flatMap((width) => formats.map((format) => ({ width, height: 1, format, key: `2026/10/x/w${width}.${format}`, bytes: 1 }))) });
assert.deepEqual(toMediaAsset(row(['webp'])).sources.map((s) => s.type), ['image/webp']);
assert.deepEqual(toMediaAsset(row(['avif', 'webp'])).sources.map((s) => s.type), ['image/avif', 'image/webp']);
assert.match(toMediaAsset(row(['webp'])).sources[0].srcSet, /w400.webp 400w, .*w800.webp 800w$/);
pass('delivery: a WebP-only image gets one <source>; an image stored earlier with AVIF keeps both');

// ── AVIF opt-in ──
process.env.MEDIA_VARIANT_FORMATS = 'avif,webp';
const both = await processUpload(await noise(900, 600).webp().toBuffer(), 'both.webp', 'image/webp');
assert.deepEqual(both.variants.map((v) => `${v.format} ${v.width}`), ['avif 400', 'webp 400', 'avif 800', 'webp 800', 'avif 900', 'webp 900']);
assert.equal((await sharp(both.variants[0].data).metadata()).format, 'heif');
delete process.env.MEDIA_VARIANT_FORMATS;
pass('MEDIA_VARIANT_FORMATS="avif,webp" adds an AVIF file for every size');

// ── A large upload ──
const big = await sharp(await noise(1500, 1000).png().toBuffer()).resize(6000, 4000).jpeg({ quality: 85 }).toBuffer();
global.gc?.();
const before = process.memoryUsage().rss;
let peak = before;
const sampler = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss); }, 5);
const cpu = process.cpuUsage();
const large = await processUpload(big, 'big.jpg', 'image/jpeg');
clearInterval(sampler);
const cpuSeconds = (process.cpuUsage(cpu).user + process.cpuUsage(cpu).system) / 1e6;
const extraMb = (Math.max(peak, process.memoryUsage().rss) - before) / 1048576;
assert.deepEqual([large.width, large.height], [2560, 1707]);
assert.deepEqual(widthsOf(large, 'webp'), [400, 800, 1600, 2560]);
assert(extraMb < 200, `a 24-megapixel upload added ${extraMb.toFixed(0)} MB (limit 200)`);
pass(`24-megapixel JPEG: original capped at 2560px, 4 WebP sizes, +${extraMb.toFixed(0)} MB, ${cpuSeconds.toFixed(1)} CPU-seconds`);

// ── One at a time ──
let busiest = 0;
const sources = await Promise.all([1500, 1400, 1300].map((w) => noise(w, 1000).jpeg().toBuffer()));
const watcher = setInterval(() => { busiest = Math.max(busiest, sharp.counters().process + sharp.counters().queue); }, 1);
const results = await Promise.allSettled([
  processUpload(sources[0], 'a.jpg', 'image/jpeg'),
  processUpload(Buffer.alloc(0), 'empty.jpg', 'image/jpeg'),
  processUpload(sources[1], 'b.jpg', 'image/jpeg'),
  processUpload(sources[2], 'c.png', 'image/jpeg'),
  processUpload(sources[2], 'c.jpg', 'image/jpeg'),
]);
clearInterval(watcher);
assert.deepEqual(results.map((r) => r.status), ['fulfilled', 'rejected', 'fulfilled', 'rejected', 'fulfilled']);
assert(results[1].status === 'rejected' && results[1].reason instanceof UploadRejected && results[3].status === 'rejected' && results[3].reason instanceof UploadRejected);
assert.deepEqual(results.flatMap((r) => (r.status === 'fulfilled' ? [r.value.width] : [])), [1500, 1400, 1300]);
assert(busiest <= 1, `${busiest} image operations ran at once`);
pass('five uploads sent together: processed one at a time, in order; a refused upload does not block the next');

console.log(`
Media processing verification passed: ${checks} checks.`);
