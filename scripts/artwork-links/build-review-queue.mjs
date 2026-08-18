#!/usr/bin/env node
/**
 * Build the artwork -> book link review queue. READ-ONLY. Writes no DB fields.
 *
 * #4037. A resolved link renders to readers as "read the full text with
 * translation", so it is a public claim and must be reviewed before it exists
 * ("ingest is actuation", #3776). This script produces the thing a human reads.
 *
 *   node --env-file=.env.production.local scripts/artwork-links/build-review-queue.mjs
 *   ... --out scripts/output/artwork-links-queue.json
 *   ... --limit 500        (sample, for a fast look)
 *
 * Output: one row per (artwork, reference) candidate, plus a summary. Nothing
 * is written to Mongo — approving rows is a separate, deliberate step.
 */
import { MongoClient } from 'mongodb';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { buildIndex, resolveName, linkQuality } from '../lib/artwork-work-resolver.mjs';

const arg = (flag, dflt) => {
  const i = process.argv.indexOf(flag);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};
const OUT = arg('--out', 'scripts/output/artwork-links-queue.json');
const LIMIT = parseInt(arg('--limit', '0'), 10);

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db(process.env.MONGODB_DB || 'bookstore');
const books = db.collection('books');

// ── index every book that could be a link target ────────────────────────────
// Include books that are NOT currently readable: a reference to something we
// hold but have not processed is a *different* finding (a processing gap, not
// an acquisition gap) and the queue should surface it rather than hide it.
console.error('indexing candidate books…');
const targets = await books.find(
  { content_type: { $ne: 'artwork' } },
  { projection: { id: 1, slug: 1, title: 1, english_title: 1, author: 1, visible: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1, work_id: 1 } },
).toArray();
const index = buildIndex(targets);
console.error(`  ${targets.length} books indexed, ${index.byTitle.size} distinct titles, ${index.byAuthor.size} authors`);

// ── walk the artworks ───────────────────────────────────────────────────────
const cursor = books.find(
  { content_type: 'artwork', visible: true, 'enrichment.cross_references.0': { $exists: true } },
  { projection: { id: 1, slug: 1, title: 1, display_title: 1, source_book: 1, 'enrichment.cross_references': 1 } },
);

const rows = [];
const stats = { artworks: 0, withWorkLink: 0, withAuthorOnly: 0, unresolved: 0, refs: 0, alreadyHasSourceBook: 0 };
const unresolvedNames = new Map();

for await (const art of cursor) {
  if (LIMIT && stats.artworks >= LIMIT) break;
  stats.artworks++;
  if (art.source_book) stats.alreadyHasSourceBook++;
  let gotWork = false, gotAuthor = false;

  for (const ref of art.enrichment?.cross_references || []) {
    stats.refs++;
    const hit = resolveName(index, ref.text_or_author);
    if (!hit) {
      const key = String(ref.text_or_author || '').trim();
      if (key) unresolvedNames.set(key, (unresolvedNames.get(key) || 0) + 1);
      continue;
    }
    if (hit.kind === 'work') gotWork = true; else gotAuthor = true;

    const b = hit.book;
    rows.push({
      artwork: { id: art.id, slug: art.slug, title: art.display_title || art.title },
      reference: {
        name: ref.text_or_author,
        relationship: ref.relationship,
        confidence: ref.confidence,
      },
      target: {
        kind: hit.kind,                       // 'work' -> /book/<slug>, 'author' -> /author/
        how: hit.how,
        matched_on: hit.matched,
        book_id: b.id,
        slug: b.slug,
        title: b.title,
        author: b.author,
        visible: b.visible === true,
        pages_ocr: b.pages_ocr || 0,
        pages_translated: b.pages_translated || 0,
        // 0 = hidden (do not link), 1 = held but nothing to read, 2..3 = readable
        link_quality: linkQuality(b),
      },
    });
  }
  if (gotWork) stats.withWorkLink++;
  else if (gotAuthor) stats.withAuthorOnly++;
  else stats.unresolved++;
}
await client.close();

// ── summarise ───────────────────────────────────────────────────────────────
const workRows = rows.filter((r) => r.target.kind === 'work');
const readable = workRows.filter((r) => r.target.link_quality >= 2);
const heldNotReadable = workRows.filter((r) => r.target.link_quality === 1);
const hidden = workRows.filter((r) => r.target.link_quality === 0);

const summary = {
  generated_at: new Date().toISOString(),
  artworks_examined: stats.artworks,
  references_examined: stats.refs,
  artworks_with_a_book_link: stats.withWorkLink,
  artworks_with_only_an_author_link: stats.withAuthorOnly,
  artworks_unresolved: stats.unresolved,
  artworks_already_having_source_book: stats.alreadyHasSourceBook,
  candidate_links_total: rows.length,
  work_links: workRows.length,
  work_links_to_readable_books: readable.length,
  work_links_to_held_but_unprocessed: heldNotReadable.length,
  work_links_to_hidden_books_DO_NOT_SHIP: hidden.length,
  author_links: rows.length - workRows.length,
  distinct_unresolved_names: unresolvedNames.size,
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({
  summary,
  rows,
  unresolved_top: [...unresolvedNames.entries()].sort((a, b) => b[1] - a[1]).slice(0, 200)
    .map(([name, n]) => ({ name, references: n })),
}, null, 2));

console.log('\n=== artwork → book link review queue ===');
for (const [k, v] of Object.entries(summary)) console.log(`  ${k.padEnd(42)} ${v}`);
console.log(`\nwritten to ${OUT}`);
console.log('\nNOTHING was written to Mongo. Review the queue before any link is created.');

// Judge a link by the REFERENCE it came from, not the artwork's own title — the
// claim is "this reference names that book", and the artwork title is often
// unrelated to it ("Cupid Bound" tells you nothing about a Ficino reference).
console.log('\n--- 20 sample WORK links to readable books: REFERENCE → book ---');
for (const r of readable.slice(0, 20)) {
  console.log(`  ${String(r.reference.name).slice(0, 40).padEnd(42)} → ${String(r.target.title).slice(0, 38).padEnd(40)} [${r.target.how}]`);
}
console.log('\n--- 12 sample AUTHOR links (these go to /author/, not a book) ---');
for (const r of rows.filter((x) => x.target.kind === 'author').slice(0, 12)) {
  console.log(`  ${String(r.reference.name).slice(0, 40).padEnd(42)} → author "${String(r.target.author).slice(0, 34)}"`);
}
console.log('\n--- work links pointing at books we hold but have NOT processed ---');
for (const r of heldNotReadable.slice(0, 10)) {
  console.log(`  ${String(r.reference.name).slice(0, 34).padEnd(36)} → ${String(r.target.title).slice(0, 36).padEnd(38)} pages=${r.target.pages_ocr === 0 ? 'NO OCR' : r.target.pages_ocr}`);
}
