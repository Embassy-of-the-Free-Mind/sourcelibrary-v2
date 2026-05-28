#!/usr/bin/env node
/**
 * Helper script to verify candidate book slugs exist in the collection.
 * Run this when adding new golden-set entries to make sure the book_slug
 * actually resolves to a tenant-visible book.
 *
 *   set -a; source ../../../../.env.production.local; set +a
 *   node scripts/eval/librarian-search/_seed-golden-set.mjs
 *
 * Outputs JSON to stdout; redirect to golden-set.json after manual review.
 */

import { MongoClient } from 'mongodb';

// Candidate (query, expected) pairs. Each `query_book` is a flexible search
// term we use to FIND the canonical slug in Mongo (we then put the actual
// slug in expected.book_slug). This avoids me hard-coding wrong slugs.
const CANDIDATES = [
  // ── Well-known-concept ─────────────────────────────────────────────
  { id: 'agrippa-occult-philosophy', query: 'Agrippa on natural magic and planetary correspondences',
    category: 'well-known-concept', query_book: 'Three Books of Occult Philosophy', author_contains: 'agrippa' },
  { id: 'bruno-infinite-worlds', query: 'Giordano Bruno on the infinite universe and plurality of worlds',
    category: 'well-known-concept', query_book: 'infinite universe', author_contains: 'bruno' },
  { id: 'ficino-de-vita', query: 'Ficino on drawing down celestial spirits with talismans',
    category: 'well-known-concept', query_book: 'de vita', author_contains: 'ficino' },
  { id: 'kepler-harmonices', query: 'Kepler on the harmony of the spheres and planetary music',
    category: 'well-known-concept', query_book: 'harmonices mundi', author_contains: 'kepler' },
  { id: 'fludd-utriusque', query: 'Robert Fludd on the macrocosm and microcosm',
    category: 'well-known-concept', query_book: 'utriusque cosmi', author_contains: 'fludd' },
  { id: 'paracelsus-archidoxes', query: 'Paracelsus on the spagyric preparation of metals',
    category: 'well-known-concept', query_book: 'archidoxes', author_contains: 'paracelsus' },

  // ── Niche-passage (specific topic inside a famous book) ────────────
  { id: 'kircher-magnetism', query: 'magnetic experiments with iron and lodestone',
    category: 'niche-passage', query_book: 'magnete', author_contains: 'kircher' },
  { id: 'vesalius-anatomy-skull', query: 'anatomy of the human skull and cranial sutures',
    category: 'niche-passage', query_book: 'fabrica', author_contains: 'vesalius' },
  { id: 'boehme-seven-properties', query: 'the seven fountain spirits or properties of nature',
    category: 'niche-passage', query_book: 'aurora', author_contains: 'boehme' },

  // ── Verbatim-quote / formula ───────────────────────────────────────
  { id: 'emerald-tablet-as-above', query: 'as above so below tabula smaragdina',
    category: 'verbatim-quote', query_book: 'emerald', author_contains: null },
  { id: 'rosicrucian-fama', query: 'Fama Fraternitatis brothers of the Rose Cross',
    category: 'verbatim-quote', query_book: 'fama fraternitatis', author_contains: null },

  // ── Cross-lingual (search English, book is non-English) ────────────
  { id: 'sanskrit-rasa-alchemy', query: 'Indian alchemy mercury rasa preparation',
    category: 'cross-lingual', query_book: 'rasa', author_contains: null },
  { id: 'tibetan-bardo', query: 'Tibetan teachings on the intermediate state after death',
    category: 'cross-lingual', query_book: 'bardo', author_contains: null },

  // ── Broad-theme (multiple books should match) ──────────────────────
  { id: 'sympathetic-magic', query: 'sympathetic magic and occult virtues in nature',
    category: 'broad-theme', query_book: null, author_contains: null },
  { id: 'dream-interpretation-antiquity', query: 'dream interpretation in the ancient world',
    category: 'broad-theme', query_book: null, author_contains: null },

  // ── Bibliographic (find books, not passages) ───────────────────────
  { id: 'books-on-geomancy', query: 'books about geomancy and divination by points',
    category: 'bibliographic', query_book: 'geomancy', author_contains: null },
  { id: 'books-on-cabala', query: 'Christian cabala in the Renaissance',
    category: 'bibliographic', query_book: 'cabala', author_contains: null },
];

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI not set; source .env.production.local');
    process.exit(1);
  }
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || 'bookstore');

  const queries = [];
  for (const c of CANDIDATES) {
    const filter = {
      hidden: { $ne: true },
      tenantId: { $in: [null, undefined] },
      pages_count: { $gt: 0 },
    };
    const orClauses = [];
    if (c.query_book) {
      const re = new RegExp(c.query_book.replace(/\s+/g, '.*'), 'i');
      orClauses.push({ title: re }, { display_title: re }, { english_title: re });
    }
    if (orClauses.length) filter.$or = orClauses;
    if (c.author_contains) filter.author = new RegExp(c.author_contains, 'i');

    const docs = await db.collection('books')
      .find(filter)
      .project({ id: 1, slug: 1, title: 1, display_title: 1, author: 1, pages_count: 1, pages_translated: 1, year: 1 })
      .limit(5)
      .toArray();

    process.stderr.write(`${c.id} → ${docs.length} match(es)\n`);
    for (const d of docs) {
      process.stderr.write(`    ${d.slug}  "${d.display_title || d.title}" by ${d.author || '?'} (${d.pages_translated || 0}/${d.pages_count} translated)\n`);
    }

    // Take the top match with translation; fall back to first
    const best = docs.find(d => (d.pages_translated || 0) > 10) || docs[0];

    queries.push({
      id: c.id,
      query: c.query,
      category: c.category,
      confidence: best ? 'medium' : 'low',
      expected: best ? [{
        book_slug: best.slug,
        // No page range yet — that needs manual validation
      }] : [],
      notes: best
        ? `Candidate book: "${best.display_title || best.title}" by ${best.author || '?'} (${best.pages_translated || 0} pages translated)`
        : `NO MATCH FOUND for ${c.query_book || c.query}; verify the collection has this`,
    });
  }

  await client.close();

  console.log(JSON.stringify({
    description: 'Librarian search eval — golden set. Generated by _seed-golden-set.mjs, then hand-validated.',
    generated_at: new Date().toISOString(),
    queries,
  }, null, 2));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
