#!/usr/bin/env node
/**
 * Repoint `pages.image_thumb` from a provider's server to the R2 thumbnail we
 * already hold.
 *
 * WHY (#4163)
 * -----------
 * `image_thumb` is the FIRST candidate the thumb tier of `getPageImageUrl`
 * considers, so a provider URL there wins over an R2 variant sitting in
 * `thumbnail_blob` — even though we archived the page and hold the bytes.
 * That is precisely how 2,506 Florentine Codex pages rendered nothing: Getty
 * was missing from `CSP_IMG_HOSTS`, every browser refused the URL, and the
 * working R2 thumbnail one field away was never reached.
 *
 * Serving our own bytes removes the whole class:
 *   - no dependency on a provider's uptime, rate limits or URL scheme
 *   - no allowlist entry to maintain in TWO places (CSP + the image proxy),
 *     where a miss is silent and total
 *   - R2 egress is free; we are already paying to store these objects
 *
 * SAFETY
 * ------
 * - Only touches pages whose `thumbnail_blob` is already an R2 URL. Never
 *   invents a key, never derives one — see the #3362 rule that a page key must
 *   contain its own book_id; this script copies an existing verified value and
 *   asserts book scope before writing.
 * - HEAD-checks a sample of the R2 targets before any write, so we cannot
 *   repoint at a 404. `--verify-all` checks every one.
 * - Preserves the old value in `field_provenance.image_thumb.previous` so the
 *   change is reversible.
 * - Records one `sweep_log` ROW per book, not a new column (field-sprawl rule).
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/maintenance/repoint-provider-thumbs-to-r2.mjs
 *   node --env-file=.env.production.local scripts/maintenance/repoint-provider-thumbs-to-r2.mjs --verify-all
 *   node --env-file=.env.production.local scripts/maintenance/repoint-provider-thumbs-to-r2.mjs --apply
 */
import { MongoClient } from 'mongodb';
import { recordSweepAction } from '../lib/sweep-log.mjs';

const APPLY = process.argv.includes('--apply');
const VERIFY_ALL = process.argv.includes('--verify-all');
const SAMPLE = Number((process.argv.find(a => a.startsWith('--sample=')) || '').split('=')[1] || 40);
const R2_HOST = 'images.sourcelibrary.org';
const R2_RE = /^https:\/\/images\.sourcelibrary\.org\//;

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');
const books = db.collection('books');
const pages = db.collection('pages');

const liveIds = (await books
  .find({ visible: true, pages_count: { $gt: 0 } }, { projection: { _id: 1 }, maxTimeMS: 300000 })
  .toArray()).map(b => b._id.toString());

const candidates = await pages.find(
  {
    book_id: { $in: liveIds },
    page_number: { $gte: 0 },
    image_thumb: { $type: 'string', $ne: '' },
    thumbnail_blob: { $regex: `^https://${R2_HOST.replace(/\./g, '\\.')}/` },
    $expr: { $not: { $regexMatch: { input: '$image_thumb', regex: R2_HOST.replace(/\./g, '\\.') } } },
  },
  { projection: { book_id: 1, page_number: 1, image_thumb: 1, thumbnail_blob: 1 }, maxTimeMS: 900000 },
).toArray();

console.log(`candidates: ${candidates.length} pages`);
if (!candidates.length) { await client.close(); process.exit(0); }

// A page key must contain its own book_id (#3362). The value we are copying was
// written by the archiver, but assert it rather than trust it.
const misscoped = candidates.filter(p => !p.thumbnail_blob.includes(p.book_id));
if (misscoped.length) {
  console.error(`REFUSING: ${misscoped.length} thumbnail_blob values are not scoped to their own book_id.`);
  console.error(misscoped.slice(0, 5).map(p => `  ${p.book_id} -> ${p.thumbnail_blob}`).join('\n'));
  process.exit(1);
}

const byBook = new Map();
for (const p of candidates) {
  const host = (() => { try { return new URL(p.image_thumb).hostname; } catch { return '(malformed)'; } })();
  if (!byBook.has(p.book_id)) byBook.set(p.book_id, { pages: 0, hosts: new Set() });
  const e = byBook.get(p.book_id);
  e.pages++; e.hosts.add(host);
}
console.log(`across ${byBook.size} books\n`);
const hostTotals = {};
for (const p of candidates) {
  const h = (() => { try { return new URL(p.image_thumb).hostname; } catch { return '(malformed)'; } })();
  hostTotals[h] = (hostTotals[h] || 0) + 1;
}
for (const [h, n] of Object.entries(hostTotals).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${h.padEnd(26)} ${String(n).padStart(6)} pages`);
}

// --- verify the R2 targets actually exist before repointing at them --------
const toCheck = VERIFY_ALL
  ? candidates
  : candidates.filter((_, i) => i % Math.max(1, Math.floor(candidates.length / SAMPLE)) === 0).slice(0, SAMPLE);
console.log(`\nHEAD-checking ${toCheck.length} R2 target(s)${VERIFY_ALL ? ' (all)' : ' (sample)'}…`);
// Bounded concurrency + progress. Serially and silently, --verify-all looks
// indistinguishable from a hang for several minutes, which is how the first
// run of this script got killed before it printed anything.
let bad = 0, done = 0;
const CONCURRENCY = 16;
async function headWorker(queue) {
  while (queue.length) {
    const p = queue.pop();
    const res = await fetch(p.thumbnail_blob, { method: 'HEAD' }).catch(() => null);
    if (!res || !res.ok) { bad++; console.error(`  MISSING ${res?.status ?? 'ERR'}  ${p.thumbnail_blob}`); }
    if (++done % 250 === 0 || done === toCheck.length) {
      console.log(`  ${done}/${toCheck.length} checked, ${bad} missing`);
    }
  }
}
{
  const queue = [...toCheck];
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, () => headWorker(queue)));
}
if (bad) {
  console.error(`\nREFUSING: ${bad}/${toCheck.length} R2 targets did not return 200.`);
  console.error('Repointing at a 404 would turn a blocked image into a missing one.');
  process.exit(1);
}
console.log(`  all ${toCheck.length} returned 200`);

if (!APPLY) {
  console.log('\nDRY RUN — pass --apply to write. Nothing changed.');
  console.log('Old values are preserved in field_provenance.image_thumb.previous when applied.');
  await client.close();
  process.exit(0);
}

let written = 0;
const BATCH = 500;
for (let i = 0; i < candidates.length; i += BATCH) {
  const slice = candidates.slice(i, i + BATCH);
  const ops = slice.map(p => ({
    updateOne: {
      filter: { _id: p._id },
      update: {
        $set: {
          image_thumb: p.thumbnail_blob,
          'field_provenance.image_thumb': {
            source: 'repoint-provider-thumbs-to-r2',
            method: 'copy-verified-thumbnail_blob',
            previous: p.image_thumb,
            date: new Date().toISOString(),
          },
        },
      },
    },
  }));
  const res = await pages.bulkWrite(ops, { ordered: false });
  written += res.modifiedCount;
  console.log(`  ${Math.min(i + BATCH, candidates.length)}/${candidates.length} — modified ${written}`);
}

for (const [bookId, e] of byBook) {
  await recordSweepAction(db, {
    sweep: 'repoint-provider-thumbs-to-r2',
    book_id: bookId,
    action: 'repointed-thumbs',
    detail: { pages: e.pages, from_hosts: [...e.hosts], to: R2_HOST },
  });
}

const left = await pages.countDocuments({
  book_id: { $in: liveIds }, page_number: { $gte: 0 },
  image_thumb: { $type: 'string', $ne: '' },
  $expr: { $not: { $regexMatch: { input: '$image_thumb', regex: R2_HOST.replace(/\./g, '\\.') } } },
});
console.log(`\nmodified ${written} pages. Provider-hosted thumbs still on live books: ${left}`);
console.log('(any remainder has no R2 alternative and needs archiving first)');
await client.close();
