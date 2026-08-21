#!/usr/bin/env node
/**
 * Recatalogue book 69dfdc934c23e88e070e65a1 — a misattributed import.
 *
 * The record says "Codex Magliabechiano / Unknown Aztec scribes / Nahuatl /
 * 1550" and sits in mesoamerican + americas + aztec-nahua as the Mesoamerican
 * collection's rank-1 highlighted work. Its IA item, `ilcodicemagliabe00code`,
 * is Karl Frey's 1892 edition of **Magl. Cl. XVII.17** — the *Florentine* art
 * treatise by the Anonimo Fiorentino, "notizie sopra l'arte degli antichi e
 * quella de' fiorentini da Cimabue a Michelangelo Buonarroti". Not the Aztec
 * codex, which is Magl. Cl. XIII.3 and is not in the library at all.
 *
 * Evidence (all three agree): the title page on p6; IA metadata (`language:
 * ['ita','ger']`, `subject: ['Art','Artists']`); and our own OCR — p120 lists
 * disciples of Polycletus, p400 discusses statues on the Florentine campanile.
 * The two works share a shelfmark family at the Biblioteca Nazionale Centrale
 * di Firenze and nothing else; a title match is what put it here.
 *
 * What this does NOT touch, deliberately:
 *   - The Zenodo DOI 10.5281/zenodo.21472238, published as "English Translation
 *     of Codex Magliabechiano" by "scribes, Unknown Aztec". A DOI is permanent
 *     and editing a published record is an outward-facing act — Derek's call.
 *   - `quality_assessment.ai_scores`, whose reasoning is confident prose about
 *     "Aztec cosmology and ritual calendars" generated from the title alone.
 *     Left in place as evidence; regenerating it is an enrichment-side fix.
 *   - The slug `codex-magliabechiano`, which stays so existing links resolve.
 *     Magl. Cl. XVII.17 genuinely is a codex called Magliabechiano; the slug is
 *     ambiguous, not wrong.
 *
 * Derived identity keys (work_id, edition_key, …) are UNSET rather than
 * hand-minted, so the standard minters recompute them from corrected metadata.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/maintenance/recatalogue-magliabechiano-4164.mjs
 *   node --env-file=.env.production.local scripts/maintenance/recatalogue-magliabechiano-4164.mjs --apply
 */
import { MongoClient, ObjectId } from 'mongodb';
import { computeIdentityFields } from '../lib/identity-fields.mjs';
import { recordSweepAction } from '../lib/sweep-log.mjs';

const APPLY = process.argv.includes('--apply');
const BOOK_ID = '69dfdc934c23e88e070e65a1';
const WRONG_COLLECTIONS = ['mesoamerican', 'americas', 'aztec-nahua'];
const RIGHT_COLLECTION = 'renaissance-art-architecture';

const CORRECTED = {
  title: "Il Codice Magliabechiano cl. XVII.17: notizie sopra l'arte degli antichi e quella de' fiorentini da Cimabue a Michelangelo Buonarroti",
  author: 'Anonimo Fiorentino; ed. Karl Frey',
  // `language` is the EDITION's language: Frey's edition prints the Italian
  // text with a German editorial apparatus. `original_language` is the work's.
  language: 'Italian / German',
  original_language: 'Italian',
  languages: ['Italian', 'German'],
  language_multi: true,
  published: '1892',
  year: 1892,
  publisher: "Berlin : G. Grote'sche Verlagsbuchhandlung",
};

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');
const books = db.collection('books');
const collections = db.collection('collections');

const before = await books.findOne({ _id: new ObjectId(BOOK_ID) });
if (!before) {
  console.error('Book not found:', BOOK_ID);
  process.exit(1);
}
// Guard: refuse to run twice, or against a book someone else already moved.
if (before.ia_identifier !== 'ilcodicemagliabe00code') {
  console.error(`Refusing: expected ia_identifier ilcodicemagliabe00code, found ${before.ia_identifier}`);
  process.exit(1);
}

const keptCollections = (before.collections || []).filter(s => !WRONG_COLLECTIONS.includes(s));
const nextCollections = [...new Set([...keptCollections, RIGHT_COLLECTION])];
const identity = computeIdentityFields({ ...before, ...CORRECTED });

const set = {
  ...CORRECTED,
  ...identity,
  collections: nextCollections,
  updated_at: new Date(),
  'field_provenance.recatalogued': {
    source: 'manual',
    method: 'title-page + IA metadata + OCR of pp.120,400',
    date: new Date().toISOString(),
    confidence: 'high',
    script: 'recatalogue-magliabechiano-4164.mjs',
    note: 'Was catalogued as the Aztec Codex Magliabechiano; is Magl. Cl. XVII.17, ed. Frey 1892.',
  },
};
// Identity keys minted from the wrong metadata — drop them so the standard
// minters (mint-local-work-ids.mjs and the edition-key sweep) recompute.
const unset = {
  work_id: '', work_slug: '', work_title: '', work_id_source: '', work_id_confidence: '',
  source_language_screen: '',
};
for (const slug of WRONG_COLLECTIONS) {
  unset[`collection_relevance.${slug}`] = '';
  unset[`book_collection_rank.${slug}`] = '';
}

console.log('BOOK');
for (const k of Object.keys(CORRECTED)) {
  console.log(`  ${k}:  ${JSON.stringify(before[k])}  ->  ${JSON.stringify(CORRECTED[k])}`);
}
console.log(`  collections:  ${JSON.stringify(before.collections)}  ->  ${JSON.stringify(nextCollections)}`);
console.log(`  edition_key:  ${JSON.stringify(before.edition_key)}  ->  ${JSON.stringify(identity.edition_key)}`);
console.log(`  unset: ${Object.keys(unset).join(', ')}`);

console.log('\nCOLLECTIONS — removing it from highlighted_books where present');
const highlighting = await collections
  .find({ 'highlighted_books.book_id': BOOK_ID }, { projection: { slug: 1 } })
  .toArray();
console.log('  ', highlighting.map(c => c.slug).join(', ') || '(none)');

if (!APPLY) {
  console.log('\nDRY RUN — pass --apply to write.');
  await client.close();
  process.exit(0);
}

const res = await books.updateOne({ _id: new ObjectId(BOOK_ID) }, { $set: set, $unset: unset });
console.log('\nbook: matched', res.matchedCount, 'modified', res.modifiedCount);

const pull = await collections.updateMany(
  { 'highlighted_books.book_id': BOOK_ID },
  { $pull: { highlighted_books: { book_id: BOOK_ID } }, $set: { updated_at: new Date() } },
);
console.log('highlighted_books: matched', pull.matchedCount, 'modified', pull.modifiedCount);

// Recount the affected collections so the card counts match what their pages render.
for (const slug of [...WRONG_COLLECTIONS, RIGHT_COLLECTION]) {
  const n = await books.countDocuments({ collections: slug, visible: true });
  const r = await collections.updateOne({ slug }, { $set: { book_count: n, updated_at: new Date() } });
  console.log(`book_count ${slug} -> ${n} (modified ${r.modifiedCount})`);
}

await recordSweepAction(db, {
  sweep: 'recatalogue-magliabechiano-4164',
  book_id: BOOK_ID,
  action: 'recatalogued',
  detail: {
    from: { title: before.title, author: before.author, language: before.language, collections: before.collections },
    to: { title: CORRECTED.title, author: CORRECTED.author, language: CORRECTED.language, collections: nextCollections },
    evidence: 'title page p6; IA ilcodicemagliabe00code (ita/ger, subject Art); OCR pp.120,400',
  },
});

const after = await books.findOne({ _id: new ObjectId(BOOK_ID) }, { projection: { title: 1, author: 1, language: 1, collections: 1, edition_key: 1, work_id: 1 } });
console.log('\nafter:', JSON.stringify(after, null, 1));
await client.close();
