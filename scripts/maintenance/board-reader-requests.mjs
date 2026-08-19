#!/usr/bin/env node
/**
 * Board reader-requested books at the head of the line (#3750, queue #3087).
 *
 * Gathers book ids from BOTH places reader translation requests live:
 *   (a) the manual checklist in GitHub issue #3087 (fetched via `gh issue
 *       view` at runtime — every open request carries a /book/<id> link), and
 *   (b) the Mongo `feedback` collection, matching the same translation-request
 *       classifier the /feedback triage uses (the reader widget writes
 *       "Translation requested for …" messages; see
 *       scripts/analytics/feedback-triage.mjs CLASSIFIERS).
 *
 * …then sets `processing_priority: 100` on those books.
 *
 * PRIORITY CONVENTION — `books.processing_priority`: a 0–100 number, HIGHER =
 * SOONER. This field already exists (scored by src/lib/processing-priority.ts,
 * viewable at /api/admin/processing-priority; imports seed 80 for fresh
 * batches; the orchestrator's dispatch sorts read it descending). Reader
 * requests get 100 — the ceiling — because a human asked for this specific
 * book; nothing algorithmic should outrank them. Written with $max so an
 * existing score is only ever raised, and provenance goes in
 * `processing_priority_breakdown.reader_request` (the breakdown-map convention
 * the import scripts use).
 *
 * Boarding ≠ spending: the budget dial (#3737) still gates dispatch; this only
 * decides who goes first when the dial allows.
 *
 * DRY-RUN BY DEFAULT — writes nothing without --apply. Logs every id it found,
 * where it came from, and whether it resolved to a book.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/board-reader-requests.mjs            # dry run
 *   node scripts/maintenance/board-reader-requests.mjs --apply
 *   node scripts/maintenance/board-reader-requests.mjs --skip-issue   # feedback only (no gh)
 */

import { execFileSync } from 'node:child_process';
import { MongoClient, ObjectId } from 'mongodb';

const APPLY = process.argv.includes('--apply');
const SKIP_ISSUE = process.argv.includes('--skip-issue');
const ISSUE = '3087';
const PRIORITY = 100;

// Same classifier the feedback triage uses (feedback-triage.mjs) — keep in sync.
const TRANSLATION_REQUEST_RE = /translation requested for|needs? translation|not (yet )?translated|please translate|translation\?/i;
const BOOK_ID_RE = /\/book\/([a-f0-9]{24})/g;

const toOid = (id) => { try { return new ObjectId(String(id)); } catch { return null; } };

// ── Source (a): the #3087 checklist ─────────────────────────────────────────
// id -> Set of provenance notes
const found = new Map();
const note = (id, src) => {
  if (!found.has(id)) found.set(id, new Set());
  found.get(id).add(src);
};

if (!SKIP_ISSUE) {
  try {
    const body = execFileSync('gh', ['issue', 'view', ISSUE, '--json', 'body', '-q', '.body'], { encoding: 'utf8' });
    let m; let n = 0;
    while ((m = BOOK_ID_RE.exec(body)) !== null) { note(m[1], `issue #${ISSUE}`); n++; }
    console.log(`Issue #${ISSUE}: ${n} /book/ links, ${found.size} unique book ids.`);
  } catch (err) {
    console.error(`WARN: could not fetch issue #${ISSUE} via gh (${err.message?.split('\n')[0]}). Continuing with feedback only; use --skip-issue to silence.`);
  }
}

// ── Source (b): the feedback collection ─────────────────────────────────────
const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
if (!uri) { console.error('Missing MONGODB_URI'); process.exit(1); }
const client = new MongoClient(uri);
await client.connect();
const db = client.db('bookstore');

const fbRows = await db.collection('feedback')
  .find({ message: TRANSLATION_REQUEST_RE }, { projection: { message: 1, page: 1, created_at: 1 } })
  .toArray();
let fbWithBook = 0;
for (const r of fbRows) {
  // The reader widget stores the page path (e.g. /book/<id>/page/7); the
  // message itself names the title, not the id — so the id comes from `page`.
  const hay = `${r.page || ''} ${r.message || ''}`;
  let m; let hit = false;
  BOOK_ID_RE.lastIndex = 0;
  while ((m = BOOK_ID_RE.exec(hay)) !== null) { note(m[1], `feedback ${String(r._id).slice(-6)}`); hit = true; }
  if (hit) fbWithBook++;
}
console.log(`Feedback: ${fbRows.length} translation-request rows, ${fbWithBook} with a resolvable /book/ id.`);
console.log(`\n${found.size} unique candidate book ids.\n`);

// ── Resolve + write ─────────────────────────────────────────────────────────
// Book URLs may carry either the string `id` field or the Mongo _id hex —
// resolve both (books `id` ≠ `_id` is a known trap).
let boarded = 0, already = 0, unresolved = 0;
for (const [rawId, sources] of [...found.entries()].sort()) {
  const or = [{ id: rawId }];
  const oid = toOid(rawId);
  if (oid) or.push({ _id: oid });
  const book = await db.collection('books').findOne({ $or: or }, {
    projection: { id: 1, title: 1, display_title: 1, processing_priority: 1, hidden_reason: 1 },
  });
  const src = [...sources].join(', ');
  if (!book) {
    unresolved++;
    console.log(`  UNRESOLVED ${rawId}  (${src})`);
    continue;
  }
  const label = `${rawId}  ${(book.display_title || book.title || '?').slice(0, 55)}`;
  if ((book.processing_priority ?? 0) >= PRIORITY) {
    already++;
    console.log(`  ALREADY ${PRIORITY} ${label}`);
    continue;
  }
  console.log(`  ${APPLY ? 'BOARD' : 'WOULD BOARD'} ${label}  (priority ${book.processing_priority ?? 'unset'} -> ${PRIORITY}; ${src})` +
    (book.hidden_reason ? '  [note: hidden_reason set — prioritized but hidden-book gates still apply]' : ''));
  boarded++;
  if (!APPLY) continue;
  await db.collection('books').updateOne(
    { _id: book._id },
    {
      $max: { processing_priority: PRIORITY },
      $set: {
        'processing_priority_breakdown.reader_request': `reader translation request (${src}) — boarded by board-reader-requests.mjs`,
        updated_at: new Date(),
      },
    },
  );
}

console.log(`\n=== SUMMARY ===  ${APPLY ? 'boarded' : 'would board'}: ${boarded}, already at ${PRIORITY}: ${already}, unresolved: ${unresolved}`);
if (!APPLY) console.log('DRY RUN — no writes. Re-run with --apply.');
await client.close();
process.exit(0);
