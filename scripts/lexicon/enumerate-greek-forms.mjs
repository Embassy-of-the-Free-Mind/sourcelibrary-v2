/**
 * Enumerate distinct Greek word forms across the corpus (#3823 Phase 3).
 *
 * Streams ocr.data for every visible Greek book's pages, tokenizes on Greek
 * script runs, NFC-normalizes, converts grave→acute (running-text accent →
 * lexical accent), strips length marks, and writes a frequency-sorted TSV
 * (form \t count) for the Morpheus bulk run. Betacode conversion happens in
 * the cruncher driver, not here — this file is the reusable corpus fact.
 *
 * Run: node --env-file=.env.production.local scripts/lexicon/enumerate-greek-forms.mjs
 * Output: scripts/lexicon/output/greek-forms.tsv (gitignored dir)
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';

const OUT = 'scripts/lexicon/output/greek-forms.tsv';
const GREEK_TOKEN = /[Ͱ-Ͽἀ-῿]+/gu;

function normalizeGreekForm(raw) {
  let s = raw.normalize('NFC');
  // grave → acute: final-syllable graves are a running-text sandhi artifact
  const GRAVE_TO_ACUTE = { 'ὰ': 'ά', 'ὲ': 'έ', 'ὴ': 'ή', 'ὶ': 'ί', 'ὸ': 'ό', 'ὺ': 'ύ', 'ὼ': 'ώ', 'ᾃ': 'ᾅ', 'ἃ': 'ἅ', 'ἓ': 'ἕ', 'ἳ': 'ἵ', 'ὃ': 'ὅ', 'ὓ': 'ὕ', 'ὣ': 'ὥ', 'ἂ': 'ἄ', 'ἒ': 'ἔ', 'ἲ': 'ἴ', 'ὂ': 'ὄ', 'ὒ': 'ὔ', 'ὢ': 'ὤ', 'ᾲ': 'ᾴ', 'ῂ': 'ῄ', 'ῲ': 'ῴ' };
  s = [...s].map((ch) => GRAVE_TO_ACUTE[ch] ?? ch).join('');
  return s;
}

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || 'bookstore');
  const books = await db
    .collection('books')
    .find({ visible: true, language: 'Greek', pages_ocr: { $gt: 0 } }, { projection: { id: 1 } })
    .toArray();
  console.log(`${books.length} Greek books`);

  const counts = new Map();
  let pagesSeen = 0;
  for (const [bi, b] of books.entries()) {
    const cursor = db.collection('pages').find(
      { book_id: b.id, 'ocr.data': { $type: 'string' } },
      { projection: { 'ocr.data': 1 } }
    );
    for await (const p of cursor) {
      pagesSeen++;
      const text = (p.ocr?.data ?? '').replace(/<[^<>]{1,60}>/g, ' ');
      for (const m of text.matchAll(GREEK_TOKEN)) {
        const form = normalizeGreekForm(m[0]);
        if (form.length < 2 || form.length > 40) continue;
        counts.set(form, (counts.get(form) ?? 0) + 1);
      }
    }
    if (bi % 50 === 0) console.log(`book ${bi}/${books.length}, pages ${pagesSeen}, distinct ${counts.size}`);
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  fs.writeFileSync(OUT, sorted.map(([f, c]) => `${f}\t${c}`).join('\n'));
  console.log(`DONE: ${sorted.length} distinct forms from ${pagesSeen} pages → ${OUT}`);
  await client.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
