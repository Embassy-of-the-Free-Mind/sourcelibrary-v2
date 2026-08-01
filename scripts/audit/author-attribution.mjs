#!/usr/bin/env node
/**
 * Standing audit: is `books.author` actually the person who wrote the book? (#3434)
 *
 * THE CLASS. A name that appears *inside* a book can be promoted to that book's
 * author. The originating run is visible in the data: 1,353 BSB books created on
 * 2026-03-14 whose `author` is not a name off the title page but the *search term*
 * that found the book — which is why the values include things nobody would write
 * as a name ("Albertus Secrets", "Fludd Medicina", "Iamblichus De Mysteriis") and
 * why the matched books are overwhelmingly bookseller and library CATALOGUES: a
 * full-text search for a title matches every catalogue that lists a copy of it.
 * Same mechanism, three surface forms — hence the three checks below.
 *
 * WHY THE EXISTING DETECTORS MISS IT.
 *   - `qa-author-date-anachronisms.mjs` tests the BIRTH side only (book predates
 *     birth). This class is the death side: Khunrath died 1605, the catalogue is
 *     1762. Invisible to a birth-only test by construction.
 *   - `quarantine-non-person-authors.mjs` fixes the `authors` THESAURUS (flags
 *     `is_person:false`) and never touches `books.author`, so a book keeps
 *     rendering "by Theatrum Chemicum" after its author doc is quarantined. Its
 *     safety interlock also, correctly, refuses to touch anchored real people —
 *     so the Khunrath case can never be caught there: he is a real person with a
 *     VIAF id who genuinely wrote other books we hold.
 *
 * Read-only. Prints a review queue; writes nothing. Exits 1 when anything is
 * flagged so it can gate CI, 0 when clean.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/audit/author-attribution.mjs
 *   node scripts/audit/author-attribution.mjs --json        # machine-readable
 *   node scripts/audit/author-attribution.mjs --margin=30   # death-window slack
 */
import { MongoClient, ObjectId } from 'mongodb';
import {
  parseWikidataYear,
  posthumousMisattributionLikely,
  isReferenceGenreTitle,
} from '../lib/author-date-window.mjs';

const JSON_OUT = process.argv.includes('--json');
const MARGIN = Number(
  (process.argv.find((a) => a.startsWith('--margin=')) || '--margin=50').split('=')[1],
);

const log = (...a) => { if (!JSON_OUT) console.log(...a); };
const findings = { posthumous_reference_genre: [], work_title_as_author: [], structural_garbage: [] };

const mc = new MongoClient(process.env.MONGODB_URI);
await mc.connect();
const db = mc.db('bookstore');
const books = db.collection('books');
const authors = db.collection('authors');
const entities = db.collection('entities');

// ───────────────────────────────────────────────────────────────────────────────
// CHECK 1 — a reference-genre book attributed to someone long dead.
// ───────────────────────────────────────────────────────────────────────────────
log('══ 1. Reference-genre books attributed to a long-dead author ══\n');

// Death years live on `entities`, reachable via authors.entity_ids. The `authors`
// collection itself carries no life dates at all (0 of 4,825 as of 2026-07-31) —
// only birth_place/death_place — so this join is the only route to a death year.
const persons = await authors
  .find({ is_person: { $ne: false }, 'entity_ids.0': { $exists: true } },
        { projection: { slug: 1, canonical_name: 1, entity_ids: 1 } })
  .toArray();
const entIds = [...new Set(persons.flatMap((p) => p.entity_ids))]
  .filter((s) => ObjectId.isValid(s))
  .map((s) => new ObjectId(s));
const entDocs = await entities
  .find({ _id: { $in: entIds } }, { projection: { wikidata_death_date: 1 } })
  .toArray();
const deathByEnt = new Map(entDocs.map((e) => [String(e._id), parseWikidataYear(e.wikidata_death_date)]));

const deathBySlug = new Map();
const nameBySlug = new Map();
for (const p of persons) {
  nameBySlug.set(p.slug, p.canonical_name);
  for (const e of p.entity_ids) {
    const y = deathByEnt.get(String(e));
    if (y != null) { deathBySlug.set(p.slug, y); break; }
  }
}
log(`author docs with a resolvable death year: ${deathBySlug.size} / ${persons.length} with entity links`);

const live = await books
  .find({ visible: true, author_id: { $exists: true, $ne: null }, year: { $type: 'number' } },
        { projection: { id: 1, title: 1, author: 1, author_id: 1, year: 1 } })
  .toArray();
log(`visible books with author_id + numeric year: ${live.length}`);

for (const b of live) {
  const deathYear = deathBySlug.get(b.author_id);
  const verdict = posthumousMisattributionLikely({ bookYear: b.year, deathYear, title: b.title, margin: MARGIN });
  if (verdict.suspect) {
    findings.posthumous_reference_genre.push({
      book_id: b.id, title: b.title, year: b.year,
      author: b.author, author_id: b.author_id, death_year: deathYear, reason: verdict.reason,
    });
  }
}
findings.posthumous_reference_genre.sort((a, b) => a.author_id.localeCompare(b.author_id) || a.year - b.year);
log(`\nFLAGGED: ${findings.posthumous_reference_genre.length} books (margin ${MARGIN}y)\n`);
{
  const byAuthor = new Map();
  for (const f of findings.posthumous_reference_genre) {
    if (!byAuthor.has(f.author_id)) byAuthor.set(f.author_id, []);
    byAuthor.get(f.author_id).push(f);
  }
  for (const [slug, items] of [...byAuthor].sort((a, b) => b[1].length - a[1].length)) {
    log(`  ${nameBySlug.get(slug) ?? slug} (d. ${items[0].death_year}) — ${items.length} book(s)`);
    for (const f of items) log(`     ${f.book_id}  ${f.year}  ${String(f.title).slice(0, 66)}`);
  }
  log('\n  NOTE: a genuine posthumous collected edition can look like this');
  log('  (Diodorus Siculus\' own Bibliotheca Historica; Bibliotheca Fratrum');
  log('  Polonorum). Review each — do not auto-write from this list.');
}

// ───────────────────────────────────────────────────────────────────────────────
// CHECK 2 — the author string is a work title, not a person.
// ───────────────────────────────────────────────────────────────────────────────
log('\n\n══ 2. Work titles sitting in books.author ══\n');

// Signal: the author doc carries NO authority record (no VIAF, no Wikidata) AND
// books whose *title* begins with that same string exist. A real person can share
// a string with a title ("William Blake" names both a man and monographs about
// him), but a real person of any note carries an authority id — so requiring the
// absence of one is what keeps this from flagging every author in the corpus.
const unanchored = await authors
  .find({
    $and: [
      { $or: [{ viaf_id: { $in: [null, ''] } }, { viaf_id: { $exists: false } }] },
      { $or: [{ wikidata_id: { $in: [null, ''] } }, { wikidata_id: { $exists: false } }] },
    ],
  }, { projection: { _id: 1, slug: 1, canonical_name: 1, is_person: 1, book_count: 1 } })
  .toArray();

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
let skippedSelfTitled = 0;
for (const a of unanchored) {
  const name = a.canonical_name || a._id;
  const n = norm(name);
  if (n.split(' ').length < 2) continue;   // single tokens are too noisy to judge

  // Books that CARRY this string as their author…
  const carrying = await books
    .find({ $or: [{ author: name }, { author_id: a._id }] },
          { projection: { id: 1, title: 1, year: 1, visible: 1 } })
    .toArray();
  if (!carrying.length) continue;

  // …versus books whose TITLE starts with it (evidence the string names a work).
  const titlePrefix = new RegExp('^' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '[^a-z0-9]+'));
  const asTitle = await books.countDocuments({ normalized_title: titlePrefix });
  if (asTitle === 0) continue;   // no evidence it names a work — nothing to say

  // THE SIGNATURE. The string names a work in the corpus, but the books wearing
  // it as their author are DIFFERENT works. That mismatch is what separates a
  // misattribution from an author whose surname simply heads their own book.
  //
  // Without this test the check flags real people who legitimately compiled
  // reference works — Guanzelli, who compiled the *Index librorum expurgandorum*;
  // Bernardus de Lutzemburgo, who wrote *Catalogus haereticorum*. A person CAN be
  // the author of a catalogue, so catalogue-genre alone proves nothing; it is only
  // evidence when the author is also long dead, which is check 1's job.
  const selfTitled = carrying.filter((b) => titlePrefix.test(norm(b.title))).length;
  if (selfTitled >= carrying.length / 2) { skippedSelfTitled++; continue; }

  findings.work_title_as_author.push({
    author_slug: a._id,
    author_name: name,
    quarantined: a.is_person === false,
    books_carrying: carrying.length,
    books_visible: carrying.filter((b) => b.visible).length,
    titles_starting_with_it: asTitle,
    carrying_reference_genre: carrying.filter((b) => isReferenceGenreTitle(b.title)).length,
    sample: carrying.slice(0, 4).map((b) => ({ id: b.id, year: b.year, title: b.title })),
  });
}
findings.work_title_as_author.sort((a, b) => b.books_visible - a.books_visible);
log(`FLAGGED: ${findings.work_title_as_author.length} author strings`);
log(`(skipped ${skippedSelfTitled} where the carriers ARE the work the string names — an author heading their own book)\n`);
for (const f of findings.work_title_as_author) {
  log(`  "${f.author_name}"  [${f.quarantined ? 'thesaurus quarantined' : 'NOT QUARANTINED'}]`);
  log(`     ${f.books_visible} visible / ${f.books_carrying} carrying · ${f.titles_starting_with_it} titles start with it · ${f.carrying_reference_genre} of the carriers are catalogues`);
  for (const s of f.sample) log(`     e.g. ${s.id}  ${s.year ?? '----'}  ${String(s.title).slice(0, 62)}`);
}

// ───────────────────────────────────────────────────────────────────────────────
// CHECK 3 — structural garbage: a value no writer should ever have stored.
// ───────────────────────────────────────────────────────────────────────────────
log('\n\n══ 3. Structurally invalid author values ══\n');
const GARBAGE = [
  { tag: 'object-stringified', filter: { author: '[object Object]' } },
  { tag: 'concatenated-placeholder', filter: { author: /^(Anonymous|Unknown)(Unknown|Anonymous)/i } },
  { tag: 'non-string', filter: { author: { $type: ['object', 'array'] } } },
  { tag: 'model-reasoning', filter: { author: /\b(wait|I will use|must be exactly one)\b/i } },
  { tag: 'over-long', filter: { $expr: { $gt: [{ $strLenCP: { $ifNull: ['$author', ''] } }, 200] } } },
];
for (const g of GARBAGE) {
  const total = await books.countDocuments(g.filter);
  if (!total) { log(`  ${g.tag}: clean`); continue; }
  const visible = await books.countDocuments({ ...g.filter, visible: true });
  const sample = await books
    .find({ ...g.filter, visible: true }, { projection: { id: 1, author: 1, title: 1 } })
    .limit(4).toArray();
  findings.structural_garbage.push({ tag: g.tag, total, visible, sample: sample.map((s) => ({ id: s.id, author: String(s.author).slice(0, 80), title: s.title })) });
  log(`  ${g.tag}: ${total} books (${visible} VISIBLE)`);
  for (const s of sample) log(`     ${s.id}  author=${JSON.stringify(String(s.author).slice(0, 46))}  ${String(s.title).slice(0, 42)}`);
}

// ───────────────────────────────────────────────────────────────────────────────
const totalFlagged =
  findings.posthumous_reference_genre.length +
  findings.work_title_as_author.length +
  findings.structural_garbage.reduce((s, g) => s + g.visible, 0);

if (JSON_OUT) {
  console.log(JSON.stringify({ margin: MARGIN, total_flagged: totalFlagged, findings }, null, 2));
} else {
  log('\n\n══ SUMMARY ══');
  log(`  posthumous reference-genre attributions : ${findings.posthumous_reference_genre.length} books`);
  log(`  work titles used as author              : ${findings.work_title_as_author.length} strings`);
  log(`  structurally invalid author values      : ${findings.structural_garbage.reduce((s, g) => s + g.visible, 0)} visible books`);
  log(`\n  ${totalFlagged === 0 ? 'CLEAN' : `${totalFlagged} findings — review before writing anything`}`);
}

await mc.close();
process.exit(totalFlagged === 0 ? 0 : 1);
