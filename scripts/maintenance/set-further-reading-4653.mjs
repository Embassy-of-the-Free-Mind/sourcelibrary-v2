#!/usr/bin/env node
/**
 * PRIOR ART: `scripts/maintenance/` holds no writer for any authored collection
 * field — `curate-collection` (the skill) writes `highlighted_books` /
 * `expanded_description` through the admin API, and the closest scripts
 * (`create-proposed-collections-2026-08.mjs`, `import/create-slime-moulds-collection.mjs`)
 * create whole collection documents rather than editing one field of an existing
 * one, and neither verifies the book ids it writes. `scripts/lib/revalidate.mjs`
 * is REUSED here for the purge rather than hand-rolling the fetch, which is the
 * copy-paste bug that file was created to end.
 *
 * Populate `collections.further_reading` for forum-of-conscience (#4653).
 *
 * WHAT THIS WRITES AND WHAT IT DOES NOT
 * ------------------------------------
 * `further_reading` is an ADJACENCY list, not membership. These books are not
 * tagged into `collections`, so nothing here moves `book_count`,
 * `total_book_count`, the works grid, or the Supabase `books_catalog` (no book
 * document is touched at all — the only write is one `$set` on one collection
 * document). The script asserts both counters are unchanged afterwards.
 *
 * WHY EVERY ID IS RE-VERIFIED BEFORE THE WRITE
 * --------------------------------------------
 * An id in a proposal is a claim, not a fact — every batch of agent-proposed
 * book ids reviewed here has contained at least one that resolves to a
 * different book or to nothing, and `updateOne` would swallow the gap in
 * silence. So each entry carries the slug it is supposed to be, and the script
 * refuses to write unless the id resolves to a VISIBLE book whose slug matches.
 * Ids are `books.id`, never the Mongo `_id`.
 *
 * TWO OF THE TWENTY CANDIDATES ARE NOT WRITTEN
 * --------------------------------------------
 * #4653 excluded the `restitutio in integrum` law-faculty disputations as false
 * friends — a Roman-law remedy, not the moral duty of restitution. Two entries
 * on its own shortlist are the same false friend one word over, and reading the
 * scans says so outright:
 *
 *   - Cellarius, *Dissertatio iuridica de poenitentia in contractibus
 *     innominatis* (Halle 1699). Chapter I is *De origine contractuum
 *     innominatorum*; the text argues from the Pandects, the *actio de
 *     praescriptis verbis* and Gnaeus Flavius. This is the *ius poenitendi* —
 *     withdrawal from a contract — not penance.
 *   - Draing, *Disputatio iuridica inauguralis de poenitentia* (Strasbourg
 *     1671). Thesis III opens "Etymologiam insequitur Poenitentiae Homonymia,
 *     certissima errorum genitrix, **in Jure nostro civili** probe
 *     investiganda", then enumerates the three civil-law senses with Pandect
 *     citations. The volume is bound with eight other Strasbourg civil-law
 *     theses (*De collatione bonorum*, *De delegatione debitoris*, …).
 *
 * They stay in CANDIDATES with `verdict: 'exclude'` and the evidence attached,
 * so re-including one is a one-word edit and a re-run rather than a rediscovery.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/maintenance/set-further-reading-4653.mjs
 *   node --env-file=.env.production.local scripts/maintenance/set-further-reading-4653.mjs --apply
 *
 * Dry-run by default: it verifies everything and prints the document it would
 * write. `--apply` performs the write and the cache purge.
 *
 * Verify afterwards:
 *   node --env-file=.env.production.local scripts/audit/collection-page-live.mjs --slug forum-of-conscience
 */

import { MongoClient } from 'mongodb';
import { revalidateCollection } from '../lib/revalidate.mjs';

const SLUG = 'forum-of-conscience';
const APPLY = process.argv.includes('--apply');

/**
 * The 20 candidates from #4653, in the issue's order, each with the slug its id
 * must resolve to. `note` is drawn from the book's own title page — a genre
 * label, not a reading of the text.
 */
const CANDIDATES = [
  {
    verdict: 'include',
    book_id: '6a4f7563eeef22aafac6164b',
    slug: 'breve-directorium-ad-confessarii-et-confitentis-munus-recte-polanco',
    note: 'A Jesuit handbook for the office of confessor — and of the one confessing.',
  },
  {
    verdict: 'include',
    book_id: '6a4a53e7e4a335875e1d5319',
    slug: 'vel-necessaria-vel-valde-utilia-sunt-confessariis-in-primo-agostini',
    note: 'What a confessor needs to know, set out briefly.',
  },
  {
    verdict: 'include',
    book_id: '6a4cc200e11a1ca1e7c7c6f2',
    slug: 'industriae-pro-confessariis-maxime-monialium-ad-eas-in-sua-polacco',
    note: 'Practical guidance for confessors, especially those of nuns.',
  },
  {
    verdict: 'include',
    book_id: '6a500179e39653852101a3e7',
    slug: 'de-poenitentia-et-confessione-secreta-semper-in-ecclesia-eck',
    note: 'Johann Eck on private confession as an unbroken practice of the Church — the Catholic side of the Reformation quarrel over penance.',
  },
  {
    verdict: 'include',
    book_id: '6a4377ee9a1e0c918b6878fe',
    slug: 'de-poenitentia-et-de-justificatione-adhortatio-et-palladius',
    note: 'An exhortation on penance and justification from the Lutheran side of the same argument.',
  },
  {
    verdict: 'include',
    book_id: '6a4d6135e91798b676b43aa7',
    slug: 'speculum-curatorum-una-cum-confessionalia-ac-tractatu-de-fillon',
    note: 'A mirror for parish clergy, bound with a confessional manual.',
  },
  {
    verdict: 'include',
    book_id: '6a4f397872a0f5a8d3809f3c',
    slug: 'resolutiones-practicae-ex-universa-theologia-morali-quas-in-herterer',
    note: 'Practical resolutions drawn from the whole of moral theology.',
  },
  {
    verdict: 'include',
    book_id: '6a4c4c5942f9b6155899d269',
    slug: 'discursus-iuris-canonici-de-poenitentia-ecclesiastica-von-knorre',
    note: 'A canon-law discourse on ecclesiastical penance — the Kirchen-Buße of the title page, 1678.',
  },
  {
    verdict: 'include',
    book_id: '6a43b1433c91e2a63d4daf9e',
    slug: 'discursus-iuris-canonici-de-poenitentia-ecclesiastica-quem-muller',
    note: 'The same 1678 disputation in a second copy: Knorr wrote it, Peter Müller presided.',
  },
  {
    verdict: 'include',
    book_id: '6a4ccd51000086439953bcfc',
    slug: 'resolutiones-selectae-in-materia-de-restitutione-ad-puritanus',
    note: 'Restitution "ad dirigendam et pacandam conscientiam" — the moral duty to give back, not the Roman-law remedy of the same name.',
  },
  {
    verdict: 'include',
    book_id: '6a4b2a9c7c38d5e8eb9bebf1',
    slug: 'de-usuris-et-cambiis-tractatus-de-censuris-ecclesiasticis-cattaneus',
    note: 'Ecclesiastical censures, with an appendix on usury and exchange.',
  },
  {
    verdict: 'include',
    book_id: '6a4a6fcad1c07a59a7512497',
    slug: 'confessionale-contins-tractatum-decem-preceptorum-et-septem-kunhofer',
    note: 'An early confessional, opening with a treatise on the Ten Commandments.',
  },
  {
    verdict: 'include',
    book_id: '6a4bb61b241e69221d26e45c',
    slug: 'sancta-cathedra-confessionalis-in-s-scripturis-fundata-ab-polz',
    note: 'A defence of the confessional, grounded in Scripture.',
  },
  {
    verdict: 'include',
    book_id: '6a4bb84a241e69221d26e99b',
    slug: 'casus-conscientiae-an-christianus-judaeum-meta-mian-kai-senst',
    note: 'A single disputed case of conscience, in the scholastic casus form.',
  },
  {
    verdict: 'include',
    book_id: '6a4c9c624e20e918504f02b6',
    slug: 'impietas-jesuitica-in-probabilismo-morali-elucens-quam-harhoff',
    note: 'A polemic against Jesuit probabilism — the case against casuistry, from inside the same literature.',
  },
  {
    verdict: 'exclude',
    book_id: '6a4a4c83547be098cf67f38c',
    slug: 'disputatio-iuridica-inauguralis-de-poenitentia-quam-ex-draing',
    why: 'False friend. Thesis III: "Poenitentiae Homonymia … in Jure nostro civili probe investiganda", then the three civil-law senses with Pandect citations. Bound with eight other Strasbourg civil-law theses. Roman law, not penance.',
  },
  {
    verdict: 'exclude',
    book_id: '6a50db823c25d10492e21f58',
    slug: 'dissertatio-iuridica-de-poenitentia-in-contractibus-cellarius',
    why: 'False friend. Chapter I is "De origine contractuum innominatorum"; argues from the Pandects and the actio de praescriptis verbis. This is the ius poenitendi — withdrawal from a contract — not penance.',
  },
  {
    verdict: 'include',
    book_id: '6a4a493760cc4860acc5480d',
    slug: 'theses-theologicae-ex-praeceptis-decalogi-primae-tabulae-trinckhel',
    note: 'Theological theses on the precepts of the Decalogue, first table.',
  },
  {
    verdict: 'include',
    book_id: '6a4a5b694107674feb04d3be',
    slug: 'theses-ex-theologia-morali-de-eucharistiae-sacramento-quas-herschl',
    note: 'Moral-theology theses on the sacrament of the Eucharist.',
  },
  {
    verdict: 'include',
    book_id: '6a4ef16e451d36458a838649',
    slug: 'ex-theologia-morali-theses-de-materia-forma-intentione-et-keuslin',
    note: 'Moral-theology theses on matter, form and intention.',
  },
];

function die(msg) {
  console.error(`\nREFUSING TO WRITE: ${msg}`);
  process.exit(1);
}

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');

const collection = await db.collection('collections').findOne({ slug: SLUG });
if (!collection) die(`collection "${SLUG}" not found`);

const before = {
  book_count: collection.book_count,
  total_book_count: collection.total_book_count,
  artwork_count: collection.artwork_count,
  further_reading: collection.further_reading,
};
console.log(`Collection "${SLUG}"`);
console.log(`  book_count=${before.book_count} total_book_count=${before.total_book_count}`);
console.log(`  further_reading currently: ${before.further_reading ? `${before.further_reading.length} entries` : 'absent'}`);
console.log(`  reading_list_gaps: ${(collection.reading_list_gaps || []).length} entries (rendered by the same band, unchanged here)\n`);

const wanted = CANDIDATES.filter(c => c.verdict === 'include');
const excluded = CANDIDATES.filter(c => c.verdict === 'exclude');

// --- Verify every id resolves to the book it claims to be -------------------
const problems = [];
const members = [];
for (const c of wanted) {
  const book = await db.collection('books').findOne(
    { id: c.book_id },
    { projection: { id: 1, slug: 1, title: 1, display_title: 1, author: 1, visible: 1, collections: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1 } },
  );
  if (!book) { problems.push(`${c.book_id} — no book with this id`); continue; }
  if (book.slug !== c.slug) { problems.push(`${c.book_id} — slug is "${book.slug}", expected "${c.slug}"`); continue; }
  if (book.visible !== true) { problems.push(`${c.book_id} — not visible (${JSON.stringify(book.visible)})`); continue; }
  // Membership would double-count: the band must not restate the works grid.
  if ((book.collections || []).includes(SLUG)) {
    problems.push(`${c.book_id} — already tagged into ${SLUG}; it belongs in the grid, not the band`);
    continue;
  }
  members.push({ c, book });
}

if (problems.length) {
  console.error('Verification failed:');
  for (const p of problems) console.error(`  ✗ ${p}`);
  die(`${problems.length} of ${wanted.length} entries did not verify`);
}

for (const { book } of members) {
  const readable = (book.pages_translated || 0) > 0 ? `${book.pages_translated} translated` : 'not yet translated';
  console.log(`  ✓ ${book.slug}\n      ${(book.display_title || book.title || '').slice(0, 70)} — ${book.author} · ${book.pages_count}pp · ${readable}`);
}
console.log(`\n  ${members.length} verified.`);
for (const e of excluded) console.log(`  – excluded ${e.slug}\n      ${e.why}`);

const further_reading = members.map(({ c }) => ({ book_id: c.book_id, note: c.note }));

if (!APPLY) {
  console.log(`\nDRY RUN — would $set further_reading (${further_reading.length} entries) and bump updated_at.`);
  console.log('Re-run with --apply to write.');
  await client.close();
  process.exit(0);
}

// --- Write ------------------------------------------------------------------
const res = await db.collection('collections').updateOne(
  { slug: SLUG },
  { $set: { further_reading, updated_at: new Date() } },
);
console.log(`\nmatched=${res.matchedCount} modified=${res.modifiedCount}`);
if (res.matchedCount !== 1) die('update did not match exactly one collection');

// --- Read back and assert ---------------------------------------------------
const after = await db.collection('collections').findOne({ slug: SLUG });
if (!Array.isArray(after.further_reading) || after.further_reading.length !== further_reading.length) {
  die(`read-back has ${after.further_reading?.length} entries, expected ${further_reading.length}`);
}
const writtenIds = after.further_reading.map(e => e.book_id).join(',');
const expectedIds = further_reading.map(e => e.book_id).join(',');
if (writtenIds !== expectedIds) die('read-back order or ids differ from what was written');

// The whole point of the field: it must not have moved a counter.
if (after.book_count !== before.book_count || after.total_book_count !== before.total_book_count) {
  die(`counters moved — book_count ${before.book_count}→${after.book_count}, total_book_count ${before.total_book_count}→${after.total_book_count}`);
}
console.log(`Verified: ${after.further_reading.length} entries, order preserved, book_count=${after.book_count} total_book_count=${after.total_book_count} (unchanged).`);

await client.close();

// --- Purge ------------------------------------------------------------------
// A write that changes what a page should show is not finished until the cache
// is told; revalidateCollection throws if the server revalidates nothing.
await revalidateCollection(SLUG);
console.log('\nDone. Verify the reader gets it:');
console.log('  node --env-file=.env.production.local scripts/audit/collection-page-live.mjs --slug forum-of-conscience');
