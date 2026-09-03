#!/usr/bin/env node
/**
 * Repair sweep for #4580 — Greek stored as LaTeX math in page text.
 *
 * Reported from a live page of the 1616 *Fama Remissa*, where
 * `$\dot{\alpha}\pi\text{o}\tau\epsilon\lambda\acute{\epsilon}\sigma\mu\alpha\tau\text{o}\varsigma$`
 * stands where ἀποτελέσματος should. Probing the public search index for one
 * token (`varsigma`) returned 19 hits in 19 distinct live books — *Palaeographia
 * Graeca*, Diophantus, Heron, Ptolemy, Aeschylus, *Koptisch-gnostische
 * Schriften* — and the markup survives INTO the English translations.
 *
 * The decoder is `scripts/lib/tex-greek.mjs`, the same function the collector
 * now runs at write time, so a page repaired here and a page written tomorrow
 * end up with identical text. One implementation, two callers.
 *
 * WHAT IT WILL NOT TOUCH
 * A math span is rewritten only when EVERY token in it decodes to a Greek
 * letter, an accent or plain text. Heron and Diophantus carry real equations
 * next to TeX-spelled Greek words, sometimes in the same paragraph; corrupting
 * genuine mathematics to fix vocabulary would be the worse defect. Spans with
 * superscripts, fractions, integrals or unknown commands pass through untouched.
 *
 * Human-edited text is never rewritten (#3749): if a person has corrected a
 * page, a script does not get to second-guess them.
 *
 * Every change is recorded in `page_revisions` with the pre-repair text, so the
 * decoder's judgement stays auditable and reversible rather than being a silent
 * overwrite of the only copy.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/maintenance/repair-tex-greek-4580.mjs
 *   node --env-file=.env.production.local scripts/maintenance/repair-tex-greek-4580.mjs --apply
 *   node --env-file=.env.production.local scripts/maintenance/repair-tex-greek-4580.mjs --apply --limit=200
 */

import { MongoClient } from 'mongodb';
import { repairTexGreek } from '../lib/tex-greek.mjs';

const APPLY = process.argv.includes('--apply');
const LIMIT = parseInt((process.argv.find(a => a.startsWith('--limit=')) || '').split('=')[1] || '0', 10);
const SWEEP = 'tex-greek-repair-4580';

const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI not set.'); process.exit(1); }

// Any TeX Greek-letter command. Deliberately letters only — matching on \acute
// or \tilde alone would sweep in real mathematics that happens to use accents.
const TEX_GREEK = '\\\\\\\\(alpha|beta|gamma|delta|epsilon|varepsilon|zeta|eta|theta|vartheta|iota|kappa|lambda|mu|nu|xi|omicron|pi|rho|sigma|varsigma|tau|upsilon|phi|varphi|chi|psi|omega)';

const client = new MongoClient(uri);
await client.connect();
const db = client.db('bookstore');
const pages = db.collection('pages');
const books = db.collection('books');

console.log(`=== #4580 TeX-Greek repair — ${APPLY ? 'APPLY' : 'REPORT ONLY (pass --apply to write)'} ===\n`);

const stats = {
  ocr: { scanned: 0, repairable: 0, spans: 0, untouched: 0, written: 0 },
  translation: { scanned: 0, repairable: 0, spans: 0, untouched: 0, written: 0 },
};
const affectedBooks = new Set();
const samples = [];

for (const field of ['ocr', 'translation']) {
  const path = `${field}.data`;
  const query = { [path]: { $regex: TEX_GREEK } };
  const cursor = pages.find(query, {
    projection: { id: 1, book_id: 1, page_number: 1, [path]: 1, [`${field}.human_edited`]: 1 },
  });

  for await (const p of cursor) {
    const s = stats[field];
    s.scanned++;
    if (LIMIT && s.scanned > LIMIT) break;

    if (p[field]?.human_edited) continue; // #3749 — a person's text is theirs
    const before = p[field]?.data;
    if (typeof before !== 'string') continue;

    const { text: after, replacements } = repairTexGreek(before);
    if (replacements === 0 || after === before) { s.untouched++; continue; }

    s.repairable++;
    s.spans += replacements;
    affectedBooks.add(String(p.book_id));

    if (samples.length < 8) {
      const at = before.search(/\$[^$]*\\\\/);
      samples.push({
        field, pageId: p.id, bookId: p.book_id, page: p.page_number,
        before: before.slice(Math.max(0, at - 40), at + 150).replace(/\s+/g, ' '),
        after: after.slice(Math.max(0, at - 40), at + 110).replace(/\s+/g, ' '),
      });
    }

    if (!APPLY) continue;

    // Keep the pre-repair text. A decoder that is 99% right still needs the 1%
    // to be recoverable, and an overwrite with no copy is not auditable.
    await db.collection('page_revisions').insertOne({
      page_id: p.id,
      book_id: p.book_id,
      field,
      text: before,
      source: SWEEP,
      reason: 'tex_greek_markup',
      spans_decoded: replacements,
      created_at: new Date(),
    });
    const res = await pages.updateOne(
      { id: p.id },
      { $set: { [path]: after, [`${field}.tex_greek_repaired_at`]: new Date() } },
    );
    if (res.modifiedCount === 1) s.written++;
  }
}

for (const [field, s] of Object.entries(stats)) {
  console.log(`${field}:`);
  console.log(`  pages containing TeX Greek commands: ${s.scanned}`);
  console.log(`  decodable (would change):            ${s.repairable}   spans: ${s.spans}`);
  console.log(`  left alone (real maths / no change): ${s.untouched}`);
  if (APPLY) console.log(`  WRITTEN:                             ${s.written}`);
}
console.log(`\ndistinct books affected: ${affectedBooks.size}`);

if (affectedBooks.size) {
  const ids = [...affectedBooks];
  const live = await books.countDocuments({ id: { $in: ids }, visible: true });
  console.log(`  ...of which live and publicly readable: ${live}`);
  const titles = await books.find({ id: { $in: ids } }, { projection: { id: 1, slug: 1, title: 1, visible: 1 } }).limit(30).toArray();
  console.log('\nbooks:');
  for (const b of titles) console.log(`  ${b.visible ? '[LIVE]' : '      '} ${b.slug || b.id}  ${String(b.title).slice(0, 58)}`);
}

console.log('\nsamples:');
for (const s of samples) {
  console.log(`\n  ${s.field} page ${s.page} of ${s.bookId}`);
  console.log(`    before: …${s.before}…`);
  console.log(`    after : …${s.after}…`);
}

if (APPLY && affectedBooks.size) {
  console.log('\n=== FOLLOW-UP ===');
  console.log('Page text feeds search, quotes and embeddings. Repaired pages need');
  console.log('their search index and embeddings refreshed before the corrected Greek');
  console.log('is findable — the Mongo write alone only fixes what the reader sees.');
}

await client.close();
