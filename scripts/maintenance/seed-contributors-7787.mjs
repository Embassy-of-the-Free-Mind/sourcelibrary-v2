#!/usr/bin/env node
/**
 * Write `books.contributors[]` for books whose author string safely splits
 * into thesaurus people with roles (#7787 step 3).
 *
 * PRIOR ART: scripts/audit/contributors-seed-report.mjs — the same proposal,
 * report-only; this applies its two SAFE buckets through the one writer,
 * `writeContributors` (scripts/lib/contributors.mjs).
 *
 * Safe means every entry names exactly one thesaurus doc (no write can mint a
 * person), the doc's life dates allow it to have made the book, and the book
 * has no list yet. `author` and `author_id` are never changed. Each write logs
 * a sweep_log row with the before values.
 *
 * What reads the field: nothing in src/ yet. The author page, bylines and
 * schema.org read it in a later step, so this write changes nothing a reader
 * sees today.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/maintenance/seed-contributors-7787.mjs            # dry run
 *   node --env-file=.env.production.local scripts/maintenance/seed-contributors-7787.mjs --apply
 *   --all   every text book, not only live ones
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { MongoClient } from 'mongodb';
import { bookYear, loadAuthorIndex, proposeContributors, SAFE_BUCKETS, toStored, writeContributors } from '../lib/contributors.mjs';

const SWEEP = 'contributors-seed-7787';
const APPLY = process.argv.includes('--apply');
const ALL = process.argv.includes('--all');

const mc = new MongoClient(process.env.MONGODB_URI);
await mc.connect();
const db = mc.db('bookstore');
const index = await loadAuthorIndex(db);
const scope = ALL
  ? { content_type: { $ne: 'artwork' } }
  : { visible: true, pages_count: { $gt: 0 }, content_type: { $ne: 'artwork' } };

const counts = {}; let planned = 0; let written = 0; let filledAuthorId = 0;
const samples = []; const all = [];
for await (const b of db.collection('books').find(
  { ...scope, author: { $type: 'string', $nin: ['', null] }, contributors: { $exists: false } },
  { projection: { author: 1, author_id: 1, published: 1, year: 1, date: 1 } }).batchSize(2000)) {
  const { bucket, proposed } = proposeContributors(b.author, b.author_id, index, bookYear(b.published ?? b.year ?? b.date));
  counts[bucket] = (counts[bucket] || 0) + 1;
  if (!SAFE_BUCKETS.has(bucket)) continue;
  const list = toStored(proposed);
  // The list and the existing link name different people: one of them is
  // wrong, and writing would be drift on day one. Left for review.
  if (b.author_id && !list.some((c) => c.author_id === b.author_id)) { counts.author_id_disagrees = (counts.author_id_disagrees || 0) + 1; continue; }
  planned++;
  if (!b.author_id) filledAuthorId++;
  const line = `${b.author}  =>  ${list.map((c) => `${c.role}:${c.author_id}`).join(', ')}`;
  if (samples.length < 15) samples.push(line);
  all.push({ book_id: String(b._id), year: bookYear(b.published ?? b.year ?? b.date), line });
  if (APPLY) written += await writeContributors(db, b, list, { sweep: SWEEP });
}
await mc.close();
mkdirSync('scripts/output', { recursive: true });
writeFileSync('scripts/output/seed-contributors-7787.json', JSON.stringify(all, null, 2));

console.log(`buckets: ${JSON.stringify(counts)}`);
console.log(`safe to write: ${planned} books (${filledAuthorId} have no author_id; left unfilled until the author page shows roles)`);
for (const s of samples) console.log(`  ${s}`);
console.log(APPLY ? `\nWROTE contributors on ${written} books (sweep ${SWEEP})` : '\nDry run. Re-run with --apply.');
