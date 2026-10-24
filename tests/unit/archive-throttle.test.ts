/**
 * A quota refusal is not a page failure (#7228). archive-ocr.mjs skips a page for good once
 * `archive_metadata.failure_count` reaches 3, and it used to count every BSB 429 there: 11,533
 * pages in 1,654 BSB books were abandoned for a daily quota, against 12 real 404s (#7176).
 *
 * The helpers are tested on behaviour. The worker runs on import, so it is tested on shape: a
 * throttle goes to `throttled_count`, never `failure_count`, and does not fall back to a second URL.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
// @ts-expect-error — plain .mjs helper, no types
import { THROTTLE_STATUSES, throttledError, isQuotaPlaceholderSize, THROTTLED_FAILURE_REASON } from '../../scripts/lib/archive-failure-class.mjs';

describe('throttle helpers', () => {
  it('429 and 503 are throttles; 404 and 403 are not', () => {
    expect(THROTTLE_STATUSES).toContain(429);
    expect(THROTTLE_STATUSES).toContain(503);
    expect(THROTTLE_STATUSES).not.toContain(404);
    expect(THROTTLE_STATUSES).not.toContain(403);
  });

  it('throttledError is marked, and its message is what the page records', () => {
    const e = throttledError('HTTP 429');
    expect(e.throttled).toBe(true);
    expect(e.message).toBe('HTTP 429 (throttled)');
  });

  it('a 1×1 image is a placeholder; a page-sized one and an unknown size are not', async () => {
    const tiny = await sharp({ create: { width: 1, height: 1, channels: 3, background: '#fff' } }).jpeg().toBuffer();
    const meta = await sharp(tiny).metadata();
    expect(isQuotaPlaceholderSize(meta.width, meta.height)).toBe(true);
    expect(isQuotaPlaceholderSize(1200, 1800)).toBe(false);
    expect(isQuotaPlaceholderSize(8, 400)).toBe(false); // a thin strip is still an image of something
    expect(isQuotaPlaceholderSize(undefined, undefined)).toBe(false);
  });

  it('the re-queue matches throttle reasons, old and new, and never a 404', () => {
    for (const r of ['HTTP 429', 'HTTP 503', 'HTTP 429 (throttled)', 'over-quota placeholder image (throttled)']) {
      expect(THROTTLED_FAILURE_REASON.test(r)).toBe(true);
    }
    for (const r of ['HTTP 404', 'HTTP 403', 'HTTP 4290', 'fetch aborted: stalled 60000ms', 'no info.json — cannot determine native dimensions']) {
      expect(THROTTLED_FAILURE_REASON.test(r)).toBe(false);
    }
  });
});

describe('archive-ocr.mjs counts throttles apart from failures', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../scripts/workers/archive-ocr.mjs'), 'utf8');

  it('a 429/503 after its retries throws a throttled error, not a plain HTTP error', () => {
    const fn = src.slice(src.indexOf('async function downloadImage('), src.indexOf('async function uploadToR2('));
    expect(fn).toMatch(/if \(THROTTLE_STATUSES\.includes\(res\.status\)\) \{[\s\S]{0,300}throw throttledError\(`HTTP \$\{res\.status\}`\);/);
    expect(fn).toMatch(/if \(await isQuotaPlaceholder\(buffer\)\) throw throttledError\(/);
    expect(fn).toMatch(/catch \(err\) \{\s*if \(err\.throttled\) throw err;/);
  });

  it('a throttle increments throttled_count, never failure_count, and skips the fallback URL', () => {
    const fn = src.slice(src.indexOf('async function archivePage('), src.indexOf('async function main('));
    expect(fn).toMatch(/\$inc: \{ \[err\.throttled \? 'archive_metadata\.throttled_count' : 'archive_metadata\.failure_count'\]: 1 \}/);
    expect(fn).toMatch(/if \(u !== originalUrl && !err\.throttled\)/);
  });
});
