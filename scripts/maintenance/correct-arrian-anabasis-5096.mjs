#!/usr/bin/env node
/**
 * Correct 69b2f42e: catalogued as Arrian's Periplus, but the volume is the
 * Anabasis (Estienne 1575, Vulcanius's Latin) — #5096.
 *
 *   node --env-file=.env.production.local scripts/maintenance/correct-arrian-anabasis-5096.mjs           # dry run
 *   node --env-file=.env.production.local scripts/maintenance/correct-arrian-anabasis-5096.mjs --apply
 *
 * PRIOR ART: scripts/maintenance/correct-aristotle-titles.mjs — same shape
 * (two witnesses, field_provenance, slug untouched); it is a fixed list for
 * #3652 and does not touch work_id or the identity keys, which this one must.
 *
 * ## Two independent witnesses
 *
 *   - The title page (p.5), read by eye 2026-10-13: "ΑΡΡΙΑΝΟΥ ΠΕΡΙ ΑΝΑΒΑΣΕΩΣ
 *     Ἀλεξάνδρου … ARRIANI (qui alter Xenophon vocatus fuit) DE EXPEDIT. ALEX.
 *     MAGNI, Historiarum Libri VIII. Ex Bonavent. Vulcanii Brug. noua
 *     interpretatione … Alexandri vita, ex Plut. … Anno M.D.LXXV, Excudebat
 *     Henr. Stephanus". Running heads (pp.170–176) read DE EXPEDIT. ALEX. LIB. VII.
 *   - The Internet Archive record it was imported from, bub_gb_oJPK6z3ibL8C,
 *     carries the same title. "Periplus" appears in neither.
 *
 * ## What is NOT changed
 *
 *   - `slug`. It is in every existing link; a wrong slug is a nuisance, a dead
 *     link is data loss.
 *   - `author`, `published`, `description` — already right for the Anabasis.
 *
 * `work_id` moves from the single-book local mint `local:a:arrian:hanno-periplus`
 * (which wrongly made this a Periplus witness) to the existing Anabasis work.
 * Identity keys are recomputed with the canonical helper from the new title.
 * Every write records `field_provenance.<field>.previous_value`, so the change
 * is reversible from the record alone.
 */
import { MongoClient } from 'mongodb';
import { computeIdentityFields } from '../lib/identity-fields.mjs';

const APPLY = process.argv.includes('--apply');
const NOW = new Date();
const ID = '69b2f42e0e2f024dfbfbbb30';
const EXPECTED_WRONG_TITLE = 'Arriani et Hannonis Periplus';

const EVIDENCE = 'Title page p.5 (read by eye 2026-10-13) and IA record bub_gb_oJPK6z3ibL8C both read "Arriani (qui alter Xenophon vocatus fuit) De Expedit. Alex. Magni Historiarum Libri VIII", Vulcanius tr., H. Estienne 1575; running heads DE EXPEDIT. ALEX. No Periplus in the volume.';

const SET = {
  title: 'Arriani De Expeditione Alexandri Magni Historiarum Libri VIII',
  display_title: 'Arrian, The Anabasis of Alexander (Greek–Latin, tr. Vulcanius, Estienne 1575)',
  english_title: 'The Anabasis of Alexander',
  work_id: 'local:n:arrian:alexander-anabasis',
  work_title: 'The Anabasis of Alexander',
  work_slug: 'arrian-the-anabasis-of-alexander',
};

const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI not set'); process.exit(1); }
const c = new MongoClient(uri); await c.connect();
const books = c.db('bookstore').collection('books');

const book = await books.findOne({ id: ID });
if (!book) { console.error(`${ID} NOT FOUND`); process.exit(1); }
if (book.title !== EXPECTED_WRONG_TITLE && book.title !== SET.title) {
  console.error(`${ID} title is now ${JSON.stringify(book.title)} — someone else changed it; refusing.`);
  process.exit(1);
}
const target = await books.countDocuments({ work_id: SET.work_id });
if (!target) { console.error(`work ${SET.work_id} has no books — refusing to mint a work by accident.`); process.exit(1); }

const identity = computeIdentityFields({ ...book, title: SET.title });
const next = { ...SET, ...identity };

const set = {};
for (const [field, value] of Object.entries(next)) {
  if (book[field] === value) { console.log(`  ${field}: already correct`); continue; }
  console.log(`  ${field}:\n    was ${JSON.stringify(book[field])}\n    now ${JSON.stringify(value)}`);
  set[field] = value;
  set[`field_provenance.${field}`] = {
    source: Object.hasOwn(identity, field) ? 'computeIdentityFields after title correction' : 'title page by eye + Internet Archive record',
    ia_identifier: 'bub_gb_oJPK6z3ibL8C',
    evidence: EVIDENCE,
    previous_value: book[field] ?? null,
    date: NOW,
    issue: '#5096',
  };
}
if (set.work_id) { set.work_id_source = 'work-merge:hand-adjudicated'; set.work_id_confidence = 'high'; }
console.log(`  slug unchanged: ${book.slug}`);

if (APPLY && Object.keys(set).length) {
  const r = await books.updateOne({ id: ID, title: book.title }, { $set: { ...set, updated_at: NOW } });
  console.log(`\napplied — ${r.modifiedCount} record modified`);
} else {
  console.log(APPLY ? '\nnothing to change' : '\nDRY RUN — nothing written. Pass --apply.');
}
await c.close();
