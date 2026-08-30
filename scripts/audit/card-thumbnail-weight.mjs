#!/usr/bin/env node
/**
 * Detector: card-tier book images must be card-weight — issue #4337.
 *
 * The class this guards against: a sweep or import leaves a book's DISPLAY-tier
 * field (`image_display`/`thumbnail`) pointing at a full-resolution scan. Cards
 * read that tier (getBookThumbnailUrl 'display'), the #1727 no-op image loader
 * serves the stored URL at every width, and a book page ships tens of MB — the
 * March 2026 ETCSL batch put 13–27 MB "thumbnails" on 386 books and a real
 * user reported "Super slow on this page". A doc did not prevent it; this
 * check runs against production data.
 *
 * Samples N visible books (default 300), resolves the same URL a card would,
 * HEADs it, and flags anything over the byte budget. Exits 1 when flagged —
 * cron-friendly (see scripts/audit/ siblings for the issue-filing pattern).
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/audit/card-thumbnail-weight.mjs [--sample=300] [--budget-kb=300]
 */
import { MongoClient } from 'mongodb';

const SAMPLE = Number((process.argv.find(a => a.startsWith('--sample=')) || '').split('=')[1]) || 300;
// Default budget is 2000 KB, NOT the ~100 KB a card should cost: measured
// 2026-08-29, ~57% of visible books serve a 300 KB–4 MB object at the display
// tier (the pages/{id}/{NNNN}.jpg "display variants" of several eras are
// full-res). Until that corpus-wide backfill lands (issue #4342), a 300 KB
// budget would be red every run — an alarm that cannot fall reports nothing.
// 2 MB catches the catastrophic class (#4337 was 13–27 MB). Lower this to
// ~300 after the backfill.
const BUDGET_KB = Number((process.argv.find(a => a.startsWith('--budget-kb=')) || '').split('=')[1]) || 2000;
const CONCURRENCY = 12;

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');

// Deterministic ratchet, independent of sampling: the flat `thumbnails/{id}.jpg`
// form IS the #4337 bug (a book-level field pointing at the raw full-res
// object; no small variant derivable from the URL). Repaired to 0 on
// 2026-08-29 — any nonzero count here means the class recurred.
const flatFat = await db.collection('books').countDocuments({
  $or: [
    { thumbnail: { $regex: '//images\\.sourcelibrary\\.org/thumbnails/[a-f0-9]{24}\\.jpg$' } },
    { image_display: { $regex: '//images\\.sourcelibrary\\.org/thumbnails/[a-f0-9]{24}\\.jpg$' } },
  ],
});
console.log(`Books with flat thumbnails/{id}.jpg at the display tier: ${flatFat} (must be 0 — #4337)`);

const books = await db.collection('books').aggregate([
  { $match: { visible: true, pages_count: { $gt: 0 } } },
  { $sample: { size: SAMPLE } },
  { $project: { title: 1, thumbnail: 1, image_display: 1, thumbnail_blob: 1 } },
]).toArray();

// Mirror getBookThumbnailUrl('display'): same field preference AND the same
// legacy-path rewrites (src/lib/utils.ts) — a stored `archived/{id}/{n}.jpg`
// is served as `pages/{id}/{0n}.jpg`, so the raw URL is NOT what cards load.
// First detector draft skipped the rewrites and flagged 70% of the corpus.
function cardUrl(raw) {
  let m = raw.match(/\/thumbnails\/([^/]+)\/(\d+)\.jpg$/);
  if (m) return `https://images.sourcelibrary.org/pages/${m[1]}/${m[2].padStart(4, '0')}.jpg`;
  m = raw.match(/\/archived\/([^/]+)\/(\d+)\.jpg$/);
  if (m) return `https://images.sourcelibrary.org/pages/${m[1]}/${m[2].padStart(4, '0')}.jpg`;
  return raw;
}
const targets = books
  .map(b => ({ id: b._id.toString(), title: b.title, url: cardUrl((b.image_display || b.thumbnail || b.thumbnail_blob || '').trim()) }))
  .filter(t => t.url.startsWith('https://images.sourcelibrary.org/'));

let idx = 0, checked = 0, unreachable = 0;
const flagged = [];
async function worker() {
  while (idx < targets.length) {
    const t = targets[idx++];
    try {
      const res = await fetch(t.url, { method: 'HEAD', signal: AbortSignal.timeout(15000) });
      if (!res.ok) { unreachable++; continue; }
      checked++;
      const kb = Math.round(parseInt(res.headers.get('content-length') || '0') / 1024);
      if (kb > BUDGET_KB) flagged.push({ ...t, kb });
    } catch {
      unreachable++;
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

// A probe needs a positive control: if nothing was checkable, the sample is
// broken, not clean (lesson_probe_needs_a_positive_control).
if (checked === 0) {
  console.error(`BROKEN PROBE: 0 of ${targets.length} card URLs were checkable (${unreachable} unreachable) — cannot assert anything.`);
  await client.close();
  process.exit(2);
}

flagged.sort((a, b) => b.kb - a.kb);
console.log(`Checked ${checked}/${targets.length} sampled visible books (${unreachable} unreachable); budget ${BUDGET_KB} KB.`);
console.log(`Over budget: ${flagged.length}`);
for (const f of flagged.slice(0, 20)) {
  console.log(`  ${(f.kb + ' KB').padStart(9)}  ${f.id}  "${(f.title || '').slice(0, 50)}"  ${f.url}`);
}

await client.close();
process.exit(flagged.length > 0 || flatFat > 0 ? 1 : 0);
