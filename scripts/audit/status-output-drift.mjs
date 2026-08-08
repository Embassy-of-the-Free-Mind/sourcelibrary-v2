#!/usr/bin/env node
/**
 * Status-output drift: books whose pipeline status claims work that was never done.
 *
 * `pipeline_auto.status` is what every phase selects on. When a status is written ahead
 * of its output, the book is permanently "past" the phase that would have filled it in —
 * nothing errors, nothing retries, and it never appears in any queue again. This counts
 * that population (#3740).
 *
 * The predicates here are deliberately the same ones enforced by `statusOutputViolation`
 * in `scripts/workers/pipeline-orchestrator.mjs`. If you change one, change both, or the
 * guard and the audit will disagree about what "done" means.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/audit/status-output-drift.mjs
 *   node --env-file=.env.production.local scripts/audit/status-output-drift.mjs --samples
 *
 * TWO FILTERS ARE LOAD-BEARING — omit them and the numbers are fiction:
 *  1. `resource_type` absent. Artwork records have no pages and are CORRECTLY `complete`.
 *     Counting them gave 25,244 "broken" books on the first pass; the true figure was 349.
 *  2. A recorded skip counts as satisfied. A book under 10 pages has no chapters because
 *     it should not have any. Treating absence as failure would condemn ~28K books to
 *     permanent retry — a worse outage than the bug.
 */
import { MongoClient } from 'mongodb';

const SAMPLES = process.argv.includes('--samples');

/** Text books only — see filter (1) above. */
const TEXT = { resource_type: { $exists: false }, pages_count: { $gt: 20 } };

const AFTER_ENRICH = ['summary_indexed', 'enriched', 'chapters_complete', 'images_submitted', 'images_complete', 'cover_selected', 'complete'];
const AFTER_CHAPTERS = ['chapters_complete', 'images_submitted', 'images_complete', 'cover_selected', 'complete'];

const missing = (field) => ({ $or: [{ [field]: { $exists: false } }, { [field]: null }, { [field]: '' }] });
const noSkip = (field) => ({ [`pipeline_auto.${field}`]: { $in: [null, ''] } });

const CHECKS = [
  { name: 'past enrichment, no summary',        filter: { 'pipeline_auto.status': { $in: AFTER_ENRICH }, ...missing('summary'), ...noSkip('summary_skipped_reason') } },
  { name: 'past chapters, no chapters',         filter: { 'pipeline_auto.status': { $in: AFTER_CHAPTERS }, $or: [{ chapters: { $exists: false } }, { chapters: { $size: 0 } }], ...noSkip('chapters_skipped_reason') } },
  { name: 'complete/cover_selected, no cover',  filter: { 'pipeline_auto.status': { $in: ['cover_selected', 'complete'] }, cover_page: { $exists: false }, ...noSkip('cover_skipped_reason') } },
  { name: 'complete, zero OCR pages',           filter: { 'pipeline_auto.status': 'complete', $or: [{ pages_ocr: 0 }, { pages_ocr: { $exists: false } }], ...noSkip('ocr_skipped_reason') } },
  { name: 'archive_complete, zero archived',    filter: { 'pipeline_auto.status': 'archive_complete', $or: [{ pages_archived: 0 }, { pages_archived: { $exists: false } }], ...noSkip('archive_skipped_reason') } },
];

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const B = client.db('bookstore').collection('books');

const withStatus = await B.countDocuments({ ...TEXT, 'pipeline_auto.status': { $exists: true } });
console.log(`text books carrying a pipeline status: ${withStatus}\n`);
console.log('STATUS CLAIMS OUTPUT THE BOOK DOES NOT HAVE (and no skip was recorded)\n');

for (const check of CHECKS) {
  const all = await B.countDocuments({ ...TEXT, ...check.filter });
  const vis = await B.countDocuments({ ...TEXT, ...check.filter, visible: true });
  console.log(`${String(all).padStart(6)}  ${check.name.padEnd(38)} (${vis} visible)`);
  if (SAMPLES && all > 0) {
    const s = await B.find({ ...TEXT, ...check.filter }).project({ id: 1, title: 1, pages_count: 1, pages_ocr: 1, visible: 1 }).limit(3).toArray();
    s.forEach(b => console.log(`          ${b.id} ${b.visible ? 'PUB' : 'hid'} ${b.pages_ocr || 0}/${b.pages_count}pp ${String(b.title).slice(0, 46)}`));
  }
}

// Books the guard has already flagged in observe mode — this should grow to zero once the
// skip reasons are recorded at their decision points and the backlog is repaired.
const flagged = await B.countDocuments({ 'pipeline_auto.output_missing': { $exists: true } });
console.log(`\nflagged live by the status guard (observe mode): ${flagged}`);

await client.close();
