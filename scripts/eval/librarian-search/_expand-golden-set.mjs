#!/usr/bin/env node
/**
 * Expansion pass for the Librarian search eval golden set.
 *
 * Adds candidates to the THIN categories (cross-lingual, verbatim-quote,
 * broad-theme, bibliographic, niche-passage) that the first eval flagged as
 * noisy (only 1-3 queries each). Resolves flexible query_book/author terms to
 * REAL slugs in Mongo so we never hard-code a wrong slug, then prints entries
 * to merge into golden-set.json after review.
 *
 *   set -a; source ../../../../.env.production.local; set +a
 *   node scripts/eval/librarian-search/_expand-golden-set.mjs
 *
 * Mirrors the resolver in _seed-golden-set.mjs. Review stderr, then merge the
 * stdout JSON entries into golden-set.json.
 */

import { MongoClient } from 'mongodb';

const CANDIDATES = [
  // ── cross-lingual (English query → non-English originals/translations) ──
  { id: 'zohar-sefirot', query: 'Kabbalah on the ten sefirot and divine emanation',
    category: 'cross-lingual', query_book: 'zohar', author_contains: null },
  { id: 'sefer-yetzirah-creation', query: 'Hebrew letters and the creation of the world',
    category: 'cross-lingual', query_book: 'yetzirah', author_contains: null },
  { id: 'ibn-arabi-unity', query: 'Sufi metaphysics of the unity of being and divine names',
    category: 'cross-lingual', query_book: 'arabi|futuhat|fusus', author_contains: 'arabi' },
  { id: 'suhrawardi-illumination', query: 'philosophy of illumination and the world of light',
    category: 'cross-lingual', query_book: 'illumination|ishraq|hikmat', author_contains: 'suhrawardi' },

  // ── verbatim-quote (famous line tied to a specific work) ──────────────
  { id: 'rosicrucian-fama', query: 'Fama Fraternitatis and the discovery of the tomb of Christian Rosenkreutz',
    category: 'verbatim-quote', query_book: 'fama|fraternitatis|rosenkreutz', author_contains: null },
  { id: 'chymical-wedding', query: 'the chymical wedding of Christian Rosenkreutz',
    category: 'verbatim-quote', query_book: 'chymical wedding|chymische hochzeit', author_contains: null },
  { id: 'maier-atalanta-motto', query: 'Atalanta Fugiens emblem the wind carried him in his belly',
    category: 'verbatim-quote', query_book: 'atalanta', author_contains: 'maier' },

  // ── broad-theme ───────────────────────────────────────────────────────
  { id: 'coniunctio-opposites', query: 'the marriage and union of opposites in alchemy',
    category: 'broad-theme', query_book: 'rosarium', author_contains: null },
  { id: 'rosicrucian-reformation', query: 'the universal reformation of the whole wide world',
    category: 'broad-theme', query_book: 'confessio|reformation', author_contains: null },
  { id: 'neoplatonic-ascent', query: 'the ascent of the soul to the One',
    category: 'broad-theme', query_book: 'enneads|plotinus', author_contains: 'plotinus' },

  // ── bibliographic (find a SET of books, not one passage) ──────────────
  { id: 'alchemical-emblem-books', query: 'alchemical emblem books with engraved plates',
    category: 'bibliographic', query_book: 'mutus liber|splendor solis|atalanta', author_contains: null },
  { id: 'corpus-hermeticum-editions', query: 'editions of the Corpus Hermeticum',
    category: 'bibliographic', query_book: 'hermeticum|pimander|pymander', author_contains: null },
  { id: 'paracelsus-medicine', query: 'works of Paracelsus on medicine and chemistry',
    category: 'bibliographic', query_book: null, author_contains: 'paracelsus' },

  // ── niche-passage (specific topic inside a known book) ────────────────
  { id: 'paracelsus-homunculus', query: 'the artificial generation of a homunculus',
    category: 'niche-passage', query_book: 'natura rerum|de generatione', author_contains: 'paracelsus' },
  { id: 'ripley-green-lion', query: 'the green lion devouring the sun in alchemy',
    category: 'niche-passage', query_book: 'ripley|rosarium', author_contains: null },
];

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) { console.error('MONGODB_URI not set; source .env.production.local'); process.exit(1); }
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || 'bookstore');

  const queries = [];
  for (const c of CANDIDATES) {
    const filter = { hidden: { $ne: true }, tenantId: { $in: [null, undefined] }, pages_count: { $gt: 0 } };
    const orClauses = [];
    if (c.query_book) {
      const re = new RegExp(c.query_book.replace(/\s+/g, '.*'), 'i');
      orClauses.push({ title: re }, { display_title: re }, { english_title: re });
    }
    if (orClauses.length) filter.$or = orClauses;
    if (c.author_contains) filter.author = new RegExp(c.author_contains, 'i');

    const docs = await db.collection('books')
      .find(filter)
      .project({ slug: 1, title: 1, display_title: 1, author: 1, pages_count: 1, pages_translated: 1, year: 1 })
      .limit(6).toArray();

    process.stderr.write(`\n${c.id} [${c.category}] → ${docs.length} match(es)\n`);
    for (const d of docs) {
      process.stderr.write(`    ${d.slug}  "${d.display_title || d.title}" by ${d.author || '?'} (${d.pages_translated || 0}/${d.pages_count} tr)\n`);
    }

    queries.push({
      id: c.id, query: c.query, category: c.category,
      confidence: docs.length ? 'medium' : 'low',
      expected: docs.slice(0, 5).map(d => ({ book_slug: d.slug })),
      notes: docs.length
        ? `Resolved ${docs.length} candidate(s); review before trusting.`
        : `NO MATCH for ${c.query_book || c.query}; verify collection coverage.`,
    });
  }

  await client.close();
  console.log(JSON.stringify({ new_entries: queries }, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });
