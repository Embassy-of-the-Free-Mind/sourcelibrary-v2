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
 * RESUMABLE BY DESIGN. The first version streamed a Mongo cursor across the
 * per-page writes and was killed three times, losing everything each time — the
 * documented trap: never hold a cursor open across slow work. It now enumerates
 * the candidate page ids FIRST (fast, one pass), checkpoints them to disk, and
 * processes from that list, appending each finished id. A kill costs only the
 * page in flight; re-running skips what is already done.
 *
 * Checkpoint files live beside the log, keyed by --state (default
 * /tmp/tex-greek-4580). Delete them to start over.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/maintenance/repair-tex-greek-4580.mjs
 *   node --env-file=.env.production.local scripts/maintenance/repair-tex-greek-4580.mjs --apply
 *   node --env-file=.env.production.local scripts/maintenance/repair-tex-greek-4580.mjs --apply --limit=200
 */

import { MongoClient } from 'mongodb';
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { repairTexGreek } from '../lib/tex-greek.mjs';
import { saveRevisionBeforeOverwrite } from '../lib/page-revisions.mjs';

const APPLY = process.argv.includes('--apply');
const LIMIT = parseInt((process.argv.find(a => a.startsWith('--limit=')) || '').split('=')[1] || '0', 10);
const SWEEP = 'tex-greek-repair-4580';

const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI not set.'); process.exit(1); }

// Any TeX Greek-letter command. Deliberately letters only — matching on \acute
// or \tilde alone would sweep in real mathematics that happens to use accents.
const TEX_GREEK = '\\\\(alpha|beta|gamma|delta|epsilon|varepsilon|zeta|eta|theta|vartheta|iota|kappa|lambda|mu|nu|xi|omicron|pi|rho|sigma|varsigma|tau|upsilon|phi|varphi|chi|psi|omega)';

const client = new MongoClient(uri);
await client.connect();
const db = client.db('bookstore');
const pages = db.collection('pages');
const books = db.collection('books');

console.log(`=== #4580 TeX-Greek repair — ${APPLY ? 'APPLY' : 'REPORT ONLY (pass --apply to write)'} ===\n`);

// Positive control, against a LITERAL fixture rather than a live row.
//
// The first version looked up the reported page and asserted the pattern
// matched it. That worked exactly once: the sweep repaired that page, the TeX
// was gone, and the control then failed and blocked every subsequent run. A
// control drawn from the mutable population invalidates itself on success —
// it was measuring "has this page been fixed yet", not "does the probe work".
//
// The fixture is the text as originally reported in #4580, frozen here. It
// cannot be repaired out from under the check, and it fails loudly if anyone
// edits the pattern into uselessness (which already happened once: eight
// backslashes matched a DOUBLE backslash and found almost nothing).
const CONTROL_TEXT =
  'Huc pertinet communicatio idiomatum verbalis: officii: ' +
  '$\\dot{\\alpha}\\pi\\text{o}\\tau\\epsilon\\lambda\\acute{\\epsilon}\\sigma\\mu\\alpha\\tau\\text{o}\\varsigma$.';

if (!new RegExp(TEX_GREEK).test(CONTROL_TEXT)) {
  console.error('FATAL: the candidate pattern does not match the reported defect.');
  console.error('The probe is broken, not the corpus. Refusing to report a count.');
  await client.close();
  process.exit(2);
}
{
  const probe = repairTexGreek(CONTROL_TEXT);
  if (probe.replacements !== 1 || !probe.text.includes('\u1f00\u03c0\u03bf\u03c4\u03b5\u03bb\u03ad\u03c3\u03bc\u03b1\u03c4\u03bf\u03c2')) {
    console.error(`FATAL: the decoder no longer produces the expected reading.`);
    console.error(`  got: ${JSON.stringify(probe.text)}`);
    await client.close();
    process.exit(2);
  }
}
console.log('positive control OK — pattern matches and decodes the reported defect\n');

const stats = {
  ocr: { scanned: 0, repairable: 0, spans: 0, untouched: 0, written: 0 },
  translation: { scanned: 0, repairable: 0, spans: 0, untouched: 0, written: 0 },
};
const affectedBooks = new Set();
const samples = [];

const STATE = (process.argv.find(a => a.startsWith('--state=')) || '').split('=')[1] || '/tmp/tex-greek-4580';

for (const field of ['ocr', 'translation']) {
  const path = `${field}.data`;
  const query = { [path]: { $regex: TEX_GREEK } };

  // ── checkpoint: enumerate ids first, then work from the list ──────────────
  const idFile = `${STATE}.${field}.ids`;
  const doneMarker = `${STATE}.${field}.ids.complete`;
  const doneFile = `${STATE}.${field}.done`;

  // Enumeration is itself resumable and RANGE-BASED. Two reasons:
  //
  //  1. A partial id file must never be mistaken for a complete one. An earlier
  //     version read whatever was on disk and proceeded, so a run killed during
  //     enumeration would have swept a fraction of the corpus and reported
  //     "done" — a silent partial, the worst kind of wrong. Completion is now
  //     recorded by a separate marker file written only after the cursor drains.
  //
  //  2. Sorting by id and resuming from the last one seen means each run makes
  //     forward progress even if it dies, instead of restarting from zero.
  let ids = existsSync(idFile)
    ? readFileSync(idFile, 'utf8').split('\n').filter(Boolean)
    : [];

  if (existsSync(doneMarker)) {
    console.log(`[${field}] candidate list complete: ${ids.length} pages`);
  } else {
    let last = ids.length ? ids[ids.length - 1] : '';
    if (ids.length) console.log(`[${field}] resuming enumeration after ${ids.length} ids`);
    let added = 0;
    for (;;) {
      const batch = await pages
        .find(last ? { ...query, id: { $gt: last } } : query, { projection: { id: 1, _id: 0 } })
        .sort({ id: 1 })
        .limit(5000)
        .toArray();
      if (!batch.length) break;
      const chunk = batch.map(r => String(r.id)).filter(Boolean);
      appendFileSync(idFile, chunk.join('\n') + '\n');
      ids.push(...chunk);
      last = chunk[chunk.length - 1];
      added += chunk.length;
      console.log(`[${field}] enumerated ${ids.length} (+${chunk.length})`);
    }
    writeFileSync(doneMarker, new Date().toISOString());
    console.log(`[${field}] enumeration COMPLETE: ${ids.length} candidates (+${added} this run)`);
  }

  const done = existsSync(doneFile)
    ? new Set(readFileSync(doneFile, 'utf8').split('\n').filter(Boolean))
    : new Set();
  if (done.size) console.log(`[${field}] ${done.size} already processed, skipping those`);

  const todo = ids.filter(id => !done.has(id));
  console.log(`[${field}] ${todo.length} to process`);

  for (const pageId of todo) {
    const p = await pages.findOne(
      { id: pageId },
      { projection: { id: 1, book_id: 1, page_number: 1, [path]: 1, [`${field}.human_edited`]: 1 } },
    );
    if (!p) { appendFileSync(doneFile, pageId + '\n'); continue; }
    const s = stats[field];
    s.scanned++;
    if (LIMIT && s.scanned > LIMIT) break;
    // Progress as it goes. A silent hour-long scan is indistinguishable from a
    // hung one, and this one is long: the regex is unindexed over ~20M docs.
    if (s.scanned % 200 === 0) {
      console.log(`  [${field}] scanned=${s.scanned} decodable=${s.repairable} left-alone=${s.untouched}`);
    }

    if (p[field]?.human_edited) { if (APPLY) appendFileSync(doneFile, String(p.id) + '\n'); continue; } // #3749
    const before = p[field]?.data;
    if (typeof before !== 'string') continue;

    const { text: after, replacements } = repairTexGreek(before);
    if (replacements === 0 || after === before) { s.untouched++; if (APPLY) appendFileSync(doneFile, String(p.id) + '\n'); continue; }

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
    //
    // Via the shared helper, NOT a hand-rolled insertOne: page_revisions carries
    // a unique `id` index and a field shape (data/source/model/language/…) that
    // the measurement stack segments on. My first version wrote {text, source}
    // with no id and died on a duplicate-key collision against id:null — which
    // at least failed closed, before any page was touched.
    const saved = await saveRevisionBeforeOverwrite(db, p.id, field, { reason: 'tex_greek_markup' });
    if (!saved) {
      console.warn(`  skipped ${p.id}: could not save a revision, refusing to overwrite`);
      continue;
    }
    const res = await pages.updateOne(
      { id: p.id },
      { $set: { [path]: after, [`${field}.tex_greek_repaired_at`]: new Date() } },
    );
    if (res.modifiedCount === 1) s.written++;
    appendFileSync(doneFile, String(p.id) + '\n');
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
