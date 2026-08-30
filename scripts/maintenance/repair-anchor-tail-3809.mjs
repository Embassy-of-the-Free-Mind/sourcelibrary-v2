#!/usr/bin/env node
/**
 * Repair the #3809 anchor tail — the 11 invalid author anchors below #3800's
 * book threshold, found by the 2026-08-09 full-corpus sweep. Same protocol as
 * repair-invalid-author-anchors-3800.mjs (#3742: every target QID verified
 * live, P31 through the shared denylist, refuse-on-failure), but this tail is
 * mixed-class, so four different treatments:
 *
 * RE-ANCHOR (verified live 2026-08-09):
 *   bossi-luigi        Q125197500 (dead item) -> Q3839378  Luigi Bossi Visconti
 *                      1758-1835, VIAF 32127973 — the Della istoria d'Italia author
 *   mantreshwara       Q7180226 (the Phaladeepika itself) -> Q6752212 Mantreswara,
 *                      Indian astrologer, VIAF 119812752
 *   honorius           Q4121506 (a literary work) -> Q10298139 Honorius of Thebes,
 *                      "possibly mythical" human — the legendary-author class the
 *                      denylist deliberately admits (Homer rule)
 *   abraham-the-jew-2  Q22257011 (a grimoire) -> Q330911 Abraham of Worms
 *                      1362-1458, VIAF 52496006; canonical_name updated to match.
 *                      (abraham-the-jew, unanchored, is the DIFFERENT legendary
 *                      figure from Flamel's Figures — correctly separate.)
 *
 * UNSET (no person item exists; an honest null beats a wrong anchor):
 *   suidas             Q216299 is the Suda lexicon; "Suidas" is the traditional
 *                      presumed author with no Wikidata person item
 *   dattila            Q5227769 is the Dattilam treatise; attributed author has
 *                      no item
 *   mr-foster          Q59195028 is a VIDEO GAME CHARACTER; the real author of
 *                      Hoplocrisma-spongus (William Foster, 1591-1643, English
 *                      clergyman) has no Wikidata item. canonical_name fixed
 *                      "Mr. Foster" -> "William Foster".
 *   anonymous-author   Q567620 deleted/redirected; a placeholder must carry no
 *                      anchor — also gets is_person: false (#3483 read path)
 *
 * MERGE: liezi-2 (1 English translation, unanchored dup) -> liezi, whose
 * existing anchor Q2984064 (Lie Yukou, human-disputed) was re-verified live.
 *
 * JUNK (minted from defect data; docs deleted, books unlinked):
 *   richard            variant "Richardus Anglicus; Braccesco; Geber; and
 *                      others" — a compound anthology string minted as a person
 *   wikidata-sandbox   minted from a VISIBLE production test book (title
 *                      "Test", author "Test", year 1498). The doc dies here;
 *                      the book is HIDDEN (hidden_reason) but NOT deleted —
 *                      deletion needs Derek per the data-protection rule.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/maintenance/repair-anchor-tail-3809.mjs            # dry-run
 *   node --env-file=.env.production.local scripts/maintenance/repair-anchor-tail-3809.mjs --apply
 *   node --env-file=.env.production.local scripts/maintenance/repair-anchor-tail-3809.mjs --revert
 */
import { MongoClient } from 'mongodb';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { anchorProblem } from '../lib/author-anchor-classes.mjs';

const APPLY = process.argv.includes('--apply');
const REVERT = process.argv.includes('--revert');
const BACKUP = 'scripts/output/anchor-tail-repair-3809-backup.json';
const UA = 'SourceLibrary-anchor-tail-3809/1.0 (https://sourcelibrary.org)';

const RE_ANCHOR = [
  { slug: 'bossi-luigi',       from: 'Q125197500', to: 'Q3839378',  why: 'dead item -> Luigi Bossi Visconti 1758-1835, VIAF 32127973' },
  { slug: 'mantreshwara',      from: 'Q7180226',   to: 'Q6752212',  why: 'was the Phaladeepika itself -> its astrologer author, VIAF 119812752' },
  { slug: 'honorius',          from: 'Q4121506',   to: 'Q10298139', why: 'was a literary work -> Honorius of Thebes (legendary author, Homer rule)' },
  { slug: 'abraham-the-jew-2', from: 'Q22257011',  to: 'Q330911',   why: 'was the Abramelin grimoire -> Abraham of Worms 1362-1458, VIAF 52496006', rename: 'Abraham of Worms' },
  // Found by the post-repair sweep rerun (was hiding in the originally-429'd range):
  { slug: 'garga-the-elder',   from: 'Q6116103',   to: 'Q139554417', why: 'was a disambiguation page -> Garga, sage in Hinduism (Q5), the Garga Muni of our Sanskrit book' },
];
const UNSET = [
  { slug: 'suidas',           from: 'Q216299',   why: 'the Suda lexicon; presumed author "Suidas" has no person item' },
  { slug: 'dattila',          from: 'Q5227769',  why: 'the Dattilam treatise; attributed author has no person item' },
  { slug: 'mr-foster',        from: 'Q59195028', why: 'a video game character; the 1631 clergyman has no item', rename: 'William Foster' },
  { slug: 'anonymous-author', from: 'Q567620',   why: 'deleted item; placeholders carry no anchor', nonPerson: true },
];
const JUNK_DOCS = ['richard', 'wikidata-sandbox'];

const mc = new MongoClient(process.env.MONGODB_URI);
await mc.connect();
const db = mc.db('bookstore');
const authors = db.collection('authors');
const books = db.collection('books');

if (REVERT) {
  if (!existsSync(BACKUP)) { console.error(`No backup at ${BACKUP}.`); process.exit(1); }
  const saved = JSON.parse(readFileSync(BACKUP, 'utf8'));
  let n = 0;
  for (const row of saved.authors) {
    if (row.deleted_doc) { await authors.insertOne(row.deleted_doc).catch(() => {}); n++; continue; }
    n += (await authors.updateOne({ _id: row._id }, { $set: row.before })).modifiedCount;
  }
  for (const row of saved.books) {
    n += (await books.updateOne({ id: row.id }, { $set: row.before })).modifiedCount;
  }
  console.log(`Reverted ${n} writes from ${saved.created_at}. (The Test book stays hidden unless its backup row says otherwise.)`);
  await mc.close();
  process.exit(0);
}

// live verification of every RE_ANCHOR target through the shared denylist
const targets = RE_ANCHOR.map(f => f.to);
const query = `SELECT ?a ?type WHERE { VALUES ?a { ${targets.map(q => `wd:${q}`).join(' ')} } OPTIONAL { ?a wdt:P31 ?type } }`;
const r = await fetch('https://query.wikidata.org/sparql?' + new URLSearchParams({ query, format: 'json' }),
  { headers: { 'User-Agent': UA, Accept: 'application/sparql-results+json' }, signal: AbortSignal.timeout(60000) });
if (!r.ok) { console.error(`SPARQL ${r.status} — cannot verify targets, refusing to proceed.`); process.exit(2); }
const p31 = new Map();
for (const b of (await r.json()).results.bindings) {
  const a = b.a.value.split('/').pop();
  if (!p31.has(a)) p31.set(a, new Set());
  if (b.type) p31.get(a).add(b.type.value.split('/').pop());
}
let bad = false;
for (const q of targets) {
  const problem = anchorProblem(p31.get(q));
  if (problem) { console.error(`TARGET ${q} FAILS: ${problem}`); bad = true; }
}
if (bad) { console.error('Refusing to write.'); process.exit(2); }
console.log(`All ${targets.length} re-anchor targets pass the denylist (live P31).\n`);

const authorWrites = [];   // { _id, before, set }
const bookWrites = [];     // { id, before, set }
const docDeletes = [];     // full docs
const skips = [];

for (const f of RE_ANCHOR) {
  const doc = await authors.findOne({ _id: f.slug });
  if (!doc) { skips.push(`${f.slug}: no doc`); continue; }
  if (doc.wikidata_id !== f.from) { skips.push(`${f.slug}: wikidata_id now ${doc.wikidata_id} — changed since audit, re-verify`); continue; }
  const set = { wikidata_id: f.to, anchor_repair_3809: { date: new Date(), why: f.why } };
  const before = { wikidata_id: doc.wikidata_id };
  if (f.rename) { set.canonical_name = f.rename; before.canonical_name = doc.canonical_name; set.variants = [...new Set([...(doc.variants || []), f.rename])]; before.variants = doc.variants; }
  authorWrites.push({ _id: f.slug, before, set, why: f.why });
}
for (const f of UNSET) {
  const doc = await authors.findOne({ _id: f.slug });
  if (!doc) { skips.push(`${f.slug}: no doc`); continue; }
  if (doc.wikidata_id !== f.from) { skips.push(`${f.slug}: wikidata_id now ${doc.wikidata_id} — changed since audit, re-verify`); continue; }
  const set = { wikidata_id: null, anchor_repair_3809: { date: new Date(), why: f.why } };
  const before = { wikidata_id: doc.wikidata_id };
  if (f.rename) { set.canonical_name = f.rename; before.canonical_name = doc.canonical_name; set.variants = [...new Set([...(doc.variants || []), f.rename])]; before.variants = doc.variants; }
  if (f.nonPerson) { set.is_person = false; before.is_person = doc.is_person ?? null; }
  authorWrites.push({ _id: f.slug, before, set, why: f.why });
}

// liezi-2 -> liezi merge (anchor of the survivor re-verified above by the sweep;
// belt: refuse if liezi lost its anchor since)
const l1 = await authors.findOne({ _id: 'liezi' });
const l2 = await authors.findOne({ _id: 'liezi-2' });
if (l1 && l2 && !l2.merged_into) {
  if (l1.wikidata_id !== 'Q2984064') { skips.push(`liezi: anchor now ${l1.wikidata_id}, expected Q2984064 — re-verify before merging`); }
  else {
    authorWrites.push({ _id: 'liezi', before: { variants: l1.variants }, set: { variants: [...new Set([...(l1.variants || []), ...(l2.variants || [])])] }, why: 'absorb liezi-2 variants' });
    authorWrites.push({ _id: 'liezi-2', before: { merged_into: l2.merged_into ?? null }, set: { merged_into: 'liezi' }, why: 'tombstone duplicate' });
    for (const b of await books.find({ author_id: 'liezi-2' }, { projection: { id: 1, title: 1 } }).toArray()) {
      bookWrites.push({ id: b.id, title: b.title, before: { author_id: 'liezi-2' }, set: { author_id: 'liezi' }, why: 'liezi-2 merged into liezi' });
    }
  }
} else if (l2?.merged_into) skips.push(`liezi-2: already merged`);

// junk docs: unlink their books, delete the docs
for (const slug of JUNK_DOCS) {
  const doc = await authors.findOne({ _id: slug });
  if (!doc) { skips.push(`${slug}: no doc`); continue; }
  docDeletes.push(doc);
  for (const b of await books.find({ author_id: slug }, { projection: { id: 1, title: 1, visible: 1 } }).toArray()) {
    bookWrites.push({ id: b.id, title: b.title, before: { author_id: slug }, set: { author_id: null }, unsetAuthorId: true, why: `unlink from junk doc ${slug}` });
  }
}

// the visible Test book: hide, never delete (Derek's call to delete)
const testBook = await books.findOne({ author: 'Test', title: 'Test', visible: true }, { projection: { id: 1, title: 1, visible: 1, hidden: 1 } });
if (testBook) {
  bookWrites.push({ id: testBook.id, title: 'Test', before: { visible: true, hidden: testBook.hidden ?? null, hidden_reason: null }, set: { visible: false, hidden: true, hidden_reason: 'test-record: title/author "Test", flagged in #3809 — delete needs human confirmation' }, why: 'visible production test record' });
}

console.log(`Author-doc writes: ${authorWrites.length}`);
for (const w of authorWrites) console.log(`  ${w._id.padEnd(20)} ${JSON.stringify(w.before).slice(0, 70)} -> ${JSON.stringify(w.set).slice(0, 90)}`);
console.log(`\nDoc deletions: ${docDeletes.map(d => d._id).join(', ') || 'none'}`);
console.log(`\nBook writes: ${bookWrites.length}`);
for (const w of bookWrites) console.log(`  ${w.id}  ${JSON.stringify(w.set).slice(0, 80)}  ${String(w.title).slice(0, 40)}`);
if (skips.length) { console.log('\nSkips:'); for (const s of skips) console.log(`  ${s}`); }

if (!APPLY) { console.log('\nDRY-RUN. --apply to write.'); await mc.close(); process.exit(0); }

mkdirSync(dirname(BACKUP), { recursive: true });
const prior = existsSync(BACKUP) ? JSON.parse(readFileSync(BACKUP, 'utf8')) : { authors: [], books: [] };
const haveA = new Set(prior.authors.map(a => a._id));
const haveB = new Set(prior.books.map(b => b.id));
for (const w of authorWrites) if (!haveA.has(w._id)) prior.authors.push({ _id: w._id, before: w.before });
for (const d of docDeletes) if (!haveA.has(d._id)) prior.authors.push({ _id: d._id, deleted_doc: d });
for (const w of bookWrites) if (!haveB.has(w.id)) prior.books.push({ id: w.id, before: w.before });
prior.issue = 3809;
prior.created_at = prior.created_at || new Date().toISOString();
prior.last_run_at = new Date().toISOString();
writeFileSync(BACKUP, JSON.stringify(prior, null, 2));

let na = 0, nb = 0, nd = 0;
for (const w of authorWrites) na += (await authors.updateOne({ _id: w._id }, { $set: w.set })).modifiedCount;
for (const d of docDeletes) nd += (await authors.deleteOne({ _id: d._id })).deletedCount;
for (const w of bookWrites) {
  const update = w.unsetAuthorId
    ? { $unset: { author_id: '' }, $set: { updated_at: new Date() } }
    : { $set: { ...w.set, updated_at: new Date() } };
  nb += (await books.updateOne({ id: w.id }, update)).modifiedCount;
}
console.log(`\nAPPLIED: ${na}/${authorWrites.length} author docs, ${nd}/${docDeletes.length} docs deleted, ${nb}/${bookWrites.length} book writes. Backup: ${BACKUP}`);
console.log('The hidden Test book needs the Supabase catalog sync + Derek\'s confirmation to delete.');
console.log('Rerun scripts/audit/author-anchor-validity.mjs to confirm a clean sweep (and cover any 429 tail).');
await mc.close();
