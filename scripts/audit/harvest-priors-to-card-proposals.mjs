/**
 * Harvest citable priors[] evidence from the attempts ledger into Translation
 * Card PROPOSALS (#3881 / #4536 — the citation harvest of the FT demolition).
 *
 * The one durable organ of the retired book-grain machinery is its citations:
 * `first_translation_attempts.priors[]` (11,323 books at harvest time). This
 * script moves that evidence toward the card layer WITHOUT bypassing review:
 *
 *   - Works that already have a card are NEVER touched. Harvested entries not
 *     already on the card are emitted to the proposals file for human review
 *     (the reseed-clobber lesson, #3928: the ledger is append-only, cards are
 *     corrected — regeneration restores removed fabrications).
 *   - Works with NO card get a new card with status `under_review`, which
 *     cardLabel() renders as NOTHING (src/lib/first-translation/card.ts).
 *     Inserting one changes no reader-visible surface; a human review that
 *     flips the status is the actuation moment. This is card method rule 3
 *     enforced structurally, not procedurally.
 *   - Verdicts are NOT migrated. Only citations. `gemini_verifier` rows carry
 *     a measured ~20% false-found rate (#4525) — every entry records its
 *     source methods so a reviewer can weigh that.
 *
 * Entry hygiene = the seeder's rules (ft-work-registry-pilot.mjs, #3901,
 * card-rounds 1–4): no citation → no entry; placeholder screens on title,
 * translator and year; dedupe by translation event.
 *
 * Dry-run by default: writes the proposals JSONL + summary, no DB writes.
 * --apply additionally inserts the new under_review cards (insert-only) and
 * records one sweep_log row per insert.
 *
 * Usage (Hetzner, per import-cost invariant):
 *   node scripts/audit/harvest-priors-to-card-proposals.mjs
 *   node scripts/audit/harvest-priors-to-card-proposals.mjs --apply
 */

import { MongoClient } from 'mongodb';
import { createWriteStream, mkdirSync } from 'node:fs';
import { recordSweepAction } from '../lib/sweep-log.mjs';

const APPLY = process.argv.includes('--apply');
const NOW = new Date().toISOString();
const SWEEP = 'card-harvest-3881';
const OUT_DIR = 'scripts/output';
const OUT_JSONL = `${OUT_DIR}/card-harvest-3881.jsonl`;

const VERIFIED_METHODS = new Set(['tier2_agent', 'human', 'claude_subagent_verify']);

// Round-1 + round-2 hygiene: placeholder prose is extraction noise, not
// knowledge — on any of the three locating fields. Genuine 'anonymous'
// translators are preserved (round 2).
const TITLE_PLACEHOLDER = /^\s*(none\b|no |n\/a|unknown\b|partial translations? of|various\b)/i;
const NAME_PLACEHOLDER = /^\s*(various\b|not specified|n\/a$|unknown\b|none\b|unnamed\b|multiple\b)/i;

function cleanEntry(p, attempt) {
  const locatable = p.source_url || (p.translator && p.pub_year);
  if (!locatable) return null;
  if (TITLE_PLACEHOLDER.test(p.english_title ?? '')) return null;
  if (p.translator && NAME_PLACEHOLDER.test(p.translator)) return null;
  if (p.pub_year && !/\d/.test(String(p.pub_year))) return null;
  return {
    kind: 'english_translation',
    year: p.pub_year ?? null,
    translator: p.translator ?? null,
    title: p.english_title ?? null,
    publisher: p.publisher ?? null,
    completeness: p.completeness ?? 'unknown',
    relationship: p.relationship ?? null,
    citation_url: p.source_url ?? null,
    source_attempt_ids: [attempt.attempt_id],
    source_methods: [attempt.method ?? 'unknown'],
    evidence_grade: attempt.evidence_strength ?? null,
    verified: VERIFIED_METHODS.has(attempt.method),
  };
}

function eventKey(e) {
  return `${(e.translator ?? '').toLowerCase()}|${e.year ?? ''}|${(e.title ?? '').toLowerCase().slice(0, 40)}`;
}

const c = new MongoClient(process.env.MONGODB_URI);
await c.connect();
const db = c.db('bookstore');
const books = db.collection('books');
const attempts = db.collection('first_translation_attempts');
const registry = db.collection('work_translation_history');

console.log(`=== ${SWEEP} (${APPLY ? 'APPLY' : 'DRY-RUN'}) ${NOW} ===`);

// 1. Every attempt row carrying priors evidence.
const rows = await attempts
  .find(
    { result: 'found', 'priors.0': { $exists: true } },
    { projection: { attempt_id: 1, book_id: 1, method: 1, date: 1, priors: 1, evidence_strength: 1 } },
  )
  .toArray();
console.log(`priors[] attempt rows: ${rows.length}`);

// 2. Resolve books → works.
const bookIds = [...new Set(rows.map((r) => r.book_id))];
const bookDocs = await books
  .find(
    { id: { $in: bookIds } },
    { projection: { id: 1, work_id: 1, title: 1, author: 1, visible: 1 } },
  )
  .toArray();
const bookById = new Map(bookDocs.map((b) => [b.id, b]));

const stats = {
  rows: rows.length,
  books_with_priors: bookIds.length,
  books_not_found: 0,
  books_without_work_id: 0,
  raw_entries: 0,
  entries_rejected_hygiene: 0,
  works_total: 0,
  works_with_existing_card: 0,
  works_proposed_new_card: 0,
  new_cards_with_verified_entry: 0,
  proposals_for_existing_cards: 0,
  inserted: 0,
};

// 3. Group cleaned entries by work.
const byWork = new Map();
const orphanBooks = [];
for (const row of rows) {
  const book = bookById.get(row.book_id);
  if (!book) { stats.books_not_found++; continue; }
  if (!book.work_id) { orphanBooks.push(row.book_id); continue; }
  let w = byWork.get(book.work_id);
  if (!w) {
    w = { work_id: book.work_id, title: book.title, author: book.author ?? null, book_ids: new Set(), entries: new Map() };
    byWork.set(book.work_id, w);
  }
  w.book_ids.add(book.id);
  for (const p of row.priors ?? []) {
    stats.raw_entries++;
    const e = cleanEntry(p, row);
    if (!e) { stats.entries_rejected_hygiene++; continue; }
    const key = eventKey(e);
    const prev = w.entries.get(key);
    if (prev) {
      // Same translation event seen by another attempt — merge provenance.
      if (!prev.source_attempt_ids.includes(e.source_attempt_ids[0])) prev.source_attempt_ids.push(e.source_attempt_ids[0]);
      if (!prev.source_methods.includes(e.source_methods[0])) prev.source_methods.push(e.source_methods[0]);
      prev.verified = prev.verified || e.verified;
      prev.citation_url = prev.citation_url ?? e.citation_url;
    } else {
      w.entries.set(key, e);
    }
  }
}
stats.books_without_work_id = new Set(orphanBooks).size;
stats.works_total = byWork.size;

// 4. Partition: existing card vs new card.
const workIds = [...byWork.keys()];
const existing = new Set(
  (await registry.find({ _id: { $in: workIds } }, { projection: { _id: 1 } }).toArray()).map((d) => d._id),
);

mkdirSync(OUT_DIR, { recursive: true });
const out = createWriteStream(OUT_JSONL);
const newCards = [];

for (const w of byWork.values()) {
  const entries = [...w.entries.values()];
  if (!entries.length) continue;
  if (existing.has(w.work_id)) {
    stats.works_with_existing_card++;
    stats.proposals_for_existing_cards += entries.length;
    out.write(`${JSON.stringify({ type: 'proposal_for_existing_card', work_id: w.work_id, title: w.title, entries })}\n`);
    continue;
  }
  // Reader-facing search record across ALL attempts on this work's books.
  const allAttempts = await attempts
    .find({ book_id: { $in: [...w.book_ids] } }, { projection: { sources_checked: 1, date: 1 } })
    .toArray();
  const sourceSet = new Set();
  let lastSearched = null;
  for (const a of allAttempts) {
    for (const s of a.sources_checked ?? []) if (s) sourceSet.add(String(s));
    if (a.date && (!lastSearched || String(a.date) > String(lastSearched))) lastSearched = a.date;
  }
  const card = {
    _id: w.work_id,
    work_id: w.work_id,
    work_title: w.title,
    author: w.author,
    // NEVER a rendering status: under_review is silent in cardLabel().
    // A reviewer flips it — that flip is the actuation moment.
    status: 'under_review',
    entries,
    search: {
      summary: 'Citations harvested from the attempts ledger (#4536); status pending human review.',
      sources: [...sourceSet].sort(),
      attempt_count: allAttempts.length,
      last_searched: lastSearched,
    },
    review_note: `${SWEEP} (unreviewed) ${NOW.slice(0, 10)}`,
    seeded_from: SWEEP,
    seeded_at: NOW,
  };
  newCards.push(card);
  stats.works_proposed_new_card++;
  if (entries.some((e) => e.verified)) stats.new_cards_with_verified_entry++;
  out.write(`${JSON.stringify({ type: 'new_card', ...card })}\n`);
}
await new Promise((res) => out.end(res));

// 5. Apply: insert-only. Existing _ids are untouched by construction, and
// insertMany(ordered:false) tolerates a card created between scan and write.
if (APPLY && newCards.length) {
  for (let i = 0; i < newCards.length; i += 500) {
    const chunk = newCards.slice(i, i + 500);
    try {
      const r = await registry.insertMany(chunk, { ordered: false });
      stats.inserted += r.insertedCount;
    } catch (err) {
      stats.inserted += err.result?.insertedCount ?? 0;
      const dupes = (err.writeErrors ?? []).filter((e) => e.code === 11000).length;
      if (dupes !== (err.writeErrors ?? []).length) throw err;
      console.log(`  chunk ${i / 500}: ${dupes} duplicate _id(s) skipped (card created concurrently)`);
    }
  }
  for (const card of newCards) {
    const primaryBook = card.entries[0]?.source_attempt_ids?.[0] ?? null;
    await recordSweepAction(db, {
      sweep: SWEEP,
      book_id: [...byWork.get(card.work_id).book_ids][0],
      action: 'card-proposed-under-review',
      detail: { work_id: card.work_id, entries: card.entries.length, basis_attempt: primaryBook },
    });
  }
}

console.log(JSON.stringify(stats, null, 2));
console.log(`proposals written: ${OUT_JSONL}`);
if (APPLY) {
  console.log(`inserted ${stats.inserted} under_review card(s) — reader-invisible until reviewed.`);
  // Post-write verification (round-4 rule): what does the collection actually hold?
  const check = await registry.countDocuments({ seeded_from: SWEEP });
  console.log(`post-write check: ${check} card(s) in work_translation_history with seeded_from=${SWEEP}`);
  if (check !== stats.inserted) console.log('WARNING: post-write count differs from insert count — investigate before trusting.');
} else {
  console.log('DRY-RUN — no DB writes. Re-run with --apply to insert the under_review cards.');
}
await c.close();
