#!/usr/bin/env node
/**
 * Repair the Aristotle volumes whose titles advertise works the scans do not
 * contain (#3652 A), and record WHY each change was made.
 *
 *   node scripts/maintenance/repair-aristotle-contents.mjs            # dry run
 *   node scripts/maintenance/repair-aristotle-contents.mjs --apply
 *
 * ## The provenance rule this script exists to honour
 *
 * A catalogue title is somebody's claim. Overwriting one silently replaces a
 * claim of unknown origin with a claim of unknown origin — which is how the
 * corpus got into this state. So every write here:
 *
 *   - records `field_provenance.<field>` with the PREVIOUS value, the method,
 *     the evidence, and the date, matching the convention already used by
 *     /api/books/[id]/verify-metadata
 *   - stores the derived head evidence in `derived_contents` so the reasoning
 *     is inspectable afterwards, not just its conclusion
 *   - is reversible from the recorded previous_value alone
 *
 * ## What it will and will not change
 *
 * It only proposes a correction where the volume's OWN RUNNING HEADS contradict
 * its title, on enough pages to be certain. It does not rename a book because a
 * head is missing: a volume with no running heads cannot be judged this way, and
 * silence is not evidence of absence. Where the evidence is strong but the right
 * new title is a scholarly judgement, it FLAGS rather than rewrites — a wrong
 * confident title is exactly the disease.
 */
import { MongoClient } from 'mongodb';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const { deriveContainedWorks } = await import(
  join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'lib', 'contains-works.ts')
);

const APPLY = process.argv.includes('--apply');
const NOW = new Date();

/**
 * Each entry states what the scans show and what should happen. `action` is
 * either a concrete field change or 'flag' — the honest answer when the
 * evidence is strong but the correct replacement needs a person.
 */
const CASES = [
  {
    id: '69937973b0a84a5763964d43',
    note: 'Already retitled 2026-08-07. Recording the provenance retroactively — the change was made before this script existed and would otherwise have no trail.',
    action: 'provenance-only',
    previous: {
      title: 'Aristotelis Opera (Vol. 2)',
      display_title: 'Works of Aristotle (Vol. 2)',
      english_title: 'Works of Aristotle (Vol. 2)',
    },
  },
  {
    id: '69b21bbc429e087c6f8632bc',
    // I had this exactly backwards, and the dry run caught it before the write.
    //
    // The plan was to clear `english_title` ("Enquiry into Plants") as a stray
    // Theophrastus title on an Aristotle volume. The heads say otherwise:
    // ΘΕΟΦΡΆΣΤΟΥ across 196 pages, ΠΕΡῚ ΦΥΤΩ͂Ν, ΠΕΡῚ ΦΥΤΩ͂Ν ΑἸΤΙΩ͂Ν. The volume
    // IS Theophrastus's botanical works. `english_title` was the only accurate
    // field on the record, and clearing it would have destroyed the evidence
    // that the rest is wrong.
    //
    // This is why the reversal is written down rather than quietly corrected:
    // "the field that disagrees with the others is the wrong one" is a very
    // natural assumption and it was false here.
    note: 'Titled "Aristotelis Opera, Vol. 4 (Metaphysics, Ethics)" and attributed to Aristotle, but the heads are ΘΕΟΦΡΆΣΤΟΥ (196pp), ΠΕΡῚ ΦΥΤΩ͂Ν and ΠΕΡῚ ΦΥΤΩ͂Ν ΑἸΤΙΩ͂Ν. This is THEOPHRASTUS on plants. english_title ("Enquiry into Plants") is the one CORRECT field; title, slug and author are all wrong. Needs a person: changing an author and slug is not a cosmetic edit.',
    action: 'flag',
  },
  {
    id: '69ae633c5d11d232640c382c',
    note: 'Titled "Aristotelis Opera (Bekker Edition, Vol. 2): Metaphysica, Ethica, Politica, Rhetorica, Poetica". Every running head begins ΕΙΣ ("commentary on…") — Porphyry, David, Simplicius on the Categories. This is the SCHOLIA volume, and the title it carries belongs to a different record we hold.',
    action: 'flag',
  },
  { id: '6956953e8c9559f6c2db0b6d', note: 'Titled "The Rhetoric, Poetic, and Nicomachean Ethics"; the heads show ONE work.', action: 'flag' },
  { id: '69b220b356715b0e324732e1', note: 'Titled "Metaphysica (Aldine)"; the heads show Ethics and Politics.', action: 'flag' },
  { id: '69b21bc3429e087c6f863493', note: 'Titled "Vol. 5 (Rhetoric, Poetics, Politics)"; the heads show Problems, Mechanics and the Metaphysics.', action: 'flag' },
];

const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI not set'); process.exit(1); }
const c = new MongoClient(uri); await c.connect();
const db = c.db('bookstore');

let changed = 0;
for (const cs of CASES) {
  const book = await db.collection('books').findOne(
    { id: cs.id },
    { projection: { id: 1, title: 1, display_title: 1, english_title: 1, author: 1, slug: 1, pages_count: 1 } },
  );
  if (!book) { console.log(`\n${cs.id}  NOT FOUND`); continue; }

  const pages = await db.collection('pages')
    .find({ book_id: cs.id, 'ocr.data': /<header>/ }, { projection: { page_number: 1, 'ocr.data': 1 } })
    .sort({ page_number: 1 }).toArray();
  const headers = [];
  for (const p of pages) {
    const h = p.ocr?.data?.match(/<header>\s*([^<]{0,80}?)\s*<\/header>/)?.[1];
    if (h) headers.push([p.page_number, h.trim()]);
  }
  const works = deriveContainedWorks(headers, { author: book.author || '' });

  console.log(`\n─── ${book.id}  ${(book.title || '').slice(0, 56)}`);
  console.log(`    ${headers.length}/${book.pages_count} pages headed; derived ${works.length} work(s)`);
  console.log(`    ${cs.note}`);

  // Evidence is recorded for EVERY case, including the flagged ones — the
  // reasoning should survive whether or not a title changes today.
  const evidence = works.map((w) => ({
    header: w.header, first_page: w.first_page, last_page: w.last_page,
    page_count: w.page_count, density: w.density,
  }));
  const set = {
    derived_contents: {
      works: evidence,
      method: 'running-head grouping (src/lib/contains-works.ts)',
      headed_pages: headers.length,
      total_pages: book.pages_count ?? null,
      derived_at: NOW,
    },
  };

  if (cs.action === 'provenance-only') {
    for (const [f, prev] of Object.entries(cs.previous)) {
      set[`field_provenance.${f}`] = {
        source: 'running-head derivation',
        evidence: 'contains-works over the volume\'s own running heads; publisher "Georgium Reimerum" + published 1831 corroborate Bekker/Reimer',
        confidence: 0.95,
        previous_value: prev,
        date: NOW,
        note: 'retroactive record for the 2026-08-07 retitle',
      };
    }
    console.log('    → recording provenance for the earlier retitle');
  } else {
    set.metadata_review = {
      reason: cs.note,
      derived_work_count: works.length,
      flagged_at: NOW,
      issue: '#3652',
    };
    console.log('    → FLAGGED for human review; title left alone (the correct replacement is a scholarly judgement)');
  }

  for (const w of works.slice(0, 6)) {
    console.log(`        pp.${String(w.first_page).padStart(4)}-${String(w.last_page).padStart(4)} ${String(w.page_count).padStart(4)}pp d=${w.density}  ${w.header.slice(0, 40)}`);
  }

  if (APPLY) {
    const r = await db.collection('books').updateOne({ id: cs.id }, { $set: { ...set, updated_at: NOW } });
    changed += r.modifiedCount;
  }
}

console.log(APPLY ? `\napplied — ${changed} records modified` : '\nDRY RUN — nothing written. Pass --apply.');
console.log('Every write is reversible from field_provenance.<field>.previous_value.');
await c.close();
