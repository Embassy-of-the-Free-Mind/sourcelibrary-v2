#!/usr/bin/env node
/**
 * Seed draft transcriptions for the 1852 Shaker Sacred Repository
 * (issue #3161). Upserts into `music_transcriptions` keyed on
 * (book_id, title) — safe to re-run.
 *
 * These two seeds were read by hand from the scans (letteral notation:
 * pitch = printed letter, duration = letter case/underline, octave = line
 * relative to the medium note — see .claude/docs/shaker-letteral-notation.md).
 * They are status:"draft": pitch sequences follow the printed letters, but
 * rhythm and octave placement are approximate pending the Phase 0/1
 * verification pass. Do NOT mark verified without checking against the scan.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/music/seed-shaker-transcriptions.mjs
 */
import { MongoClient } from 'mongodb';

const IA_ID = 'sacpository00cant';

// page_number here is the reader's page_number for this book (IA leaf n = page_number - 1)
const SEEDS = [
  {
    page_number: 21,
    title: 'The Faithful Witness (opening)',
    notes:
      'Opening phrases of the first anthem (scan image 21). Pitch letters read from the print; rhythm/octaves approximate — draft pending verification.',
    abc: `X:1
T:The Faithful Witness (opening)
C:Shaker anthem, Canterbury, N.H. (1852)
M:C
L:1/8
Q:1/4=92
K:C
G2 | C2 C2 C2 D2 | E2 (ED) D2 (EF) | G2 (GA) G2 (EF) | G6 :|
w:These things saith the Son of God, who hath his eyes like un-to_ a flame of fi-re;`,
  },
  {
    page_number: 181,
    title: 'Holy Ascension (opening)',
    notes:
      'Opening of the anthem on p.161 (scan image 181). Pitch letters read from the print; rhythm/octaves approximate — draft pending verification.',
    abc: `X:1
T:Holy Ascension (opening)
C:Shaker anthem, Canterbury, N.H. (1852)
M:C
L:1/4
Q:1/4=88
K:C
G,2 A,2 | E D C E | (D/C/) D E2 | G G G F | E (D/C/) C C |
w:Come come, all ye ho-ly, ho-ly_ an-gels, ye se-raphs bright, ye_ saints of the`,
  },
];

const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI not set'); process.exit(1); }
const client = new MongoClient(uri);
await client.connect();
const db = client.db('bookstore');

const book = await db.collection('books').findOne({ ia_identifier: IA_ID }, { projection: { id: 1, title: 1 } });
if (!book) { console.error(`book ${IA_ID} not found`); process.exit(1); }

for (const seed of SEEDS) {
  const page = await db.collection('pages').findOne(
    { book_id: book.id, page_number: seed.page_number },
    { projection: { id: 1 } },
  );
  if (!page) { console.error(`  SKIP ${seed.title} — page_number ${seed.page_number} not found`); continue; }
  const doc = {
    book_id: book.id,
    page_id: page.id,
    spans_pages: [page.id],
    title: seed.title,
    abc: seed.abc,
    status: 'draft',
    transcriber: 'claude-fable-5 (hand-read from scan, 2026-07-16)',
    notes: seed.notes,
    updated_at: new Date(),
  };
  const r = await db.collection('music_transcriptions').updateOne(
    { book_id: book.id, title: seed.title },
    { $set: doc, $setOnInsert: { created_at: new Date() } },
    { upsert: true },
  );
  console.log(`  ${r.upsertedCount ? 'INSERTED' : 'UPDATED'} ${seed.title} -> page ${page.id}`);
}

await client.close();
console.log('done');
