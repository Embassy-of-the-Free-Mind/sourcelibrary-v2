#!/usr/bin/env node
/**
 * Repair the invalid author Wikidata anchors from #3800.
 *
 * The 2026-08-09 canon audit (author-anchor-validity.mjs) found 8 anchors ≥3
 * books that resolve to non-person entities — disambiguation pages, works, a
 * reference book — plus one below threshold (zhuangzi) by spot check. A
 * non-person anchor fails SILENTLY in the work resolver: P50 of a
 * disambiguation page returns nothing, indistinguishable from a clean empty
 * result, so ~155 books can never acquire work_ids until these are fixed.
 *
 * EVERY REPLACEMENT QID BELOW WAS VERIFIED LIVE on 2026-08-09 per the #3742
 * invariant (P31 person-class + P50 usage + identifier cross-check), never
 * from recall — and rightly so: the candidate QIDs suggested from recall in
 * the issue text were wrong in five of six cases. Strongest confirmations:
 *   - morienus: Q17493693 carries VIAF 12734759, exactly the viaf_id already
 *     on our doc — definitive same-person match.
 *   - paul-nagel: Q55936710 (d. 1621, astronomer/theologian/mathematician,
 *     GND 124670261) is the Torgau astrologer-chiliast our 1619-1624 imprints
 *     belong to, not the Swiss politician (Q16832467) or sculptor (Q2061424).
 *     Wikidata's "fl. 16th century" gloss undersells him; the claims fit.
 *   - macer: our six books are all *De viribus herbarum*; Wikidata attributes
 *     the herbal (Q15833282, the current WRONG anchor - a literary work) to
 *     Odo of Meung Q41617302 via P50. The person, not the poem.
 *
 * Besides the anchor swaps, two structural repairs from the same audit:
 *   - aelian held one Aelianus Tacticus book (a different 2nd-century person)
 *     under the Claudius Aelianus heading: mint aelianus-tacticus (Q380793)
 *     and re-point that one book, selected by its author string, not a
 *     hardcoded id.
 *   - zhuangzi-2 (unanchored duplicate of zhuangzi, 5 books): re-point its
 *     books to zhuangzi and tombstone the doc with merged_into, the
 *     convention the read-path resolver already follows.
 *
 * The script re-verifies every target QID against Wikidata (P31 through the
 * shared NEVER_AN_AUTHOR denylist) at run time and refuses to write on any
 * failure — the verification is in the code, not in a session's memory.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/repair-invalid-author-anchors-3800.mjs            # dry-run
 *   node scripts/maintenance/repair-invalid-author-anchors-3800.mjs --apply
 *   node scripts/maintenance/repair-invalid-author-anchors-3800.mjs --revert
 */
import { MongoClient } from 'mongodb';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { anchorProblem } from '../lib/author-anchor-classes.mjs';

const APPLY = process.argv.includes('--apply');
const REVERT = process.argv.includes('--revert');
const BACKUP = 'scripts/output/author-anchor-repair-3800-backup.json';
const UA = 'SourceLibrary-anchor-repair-3800/1.0 (https://sourcelibrary.org; team@sourcelibrary.org)';

// Verified 2026-08-09. from = the invalid anchor the audit found; the write
// guards on it so a doc corrected by hand since is never touched.
const ANCHOR_FIXES = [
  { slug: 'mao-yuanyi-compiler', from: 'Q2553722',   to: 'Q3287200',  name: 'Mao Yuanyi',            why: 'was the Wubei Zhi itself (written work); now the Ming strategist 1594-1640, VIAF 40317269' },
  { slug: 'albumazar',           from: 'Q112076367', to: 'Q11373',    name: "Abu Ma'shar al-Balkhi", why: 'was a disambiguation page; now the Persian astrologer 787-886, VIAF 17355947' },
  { slug: 'paul-nagel',          from: 'Q16874452',  to: 'Q55936710', name: 'Paul Nagel',            why: 'was a human-name disambiguation page; now the Torgau astrologer-chiliast d. 1621, GND 124670261' },
  { slug: 'aelian',              from: 'Q380785',    to: 'Q313782',   name: 'Claudius Aelianus',     why: 'was a disambiguation page; now the Roman author c.175-c.235, VIAF 100219416 (his Tacticus book splits off below)' },
  { slug: 'artemidorus',         from: 'Q450544',    to: 'Q445848',   name: 'Artemidorus Daldianus', why: 'was a human-name disambiguation page; now the 2nd-c. diviner, author of the Oneirocritica, VIAF 61683125' },
  { slug: 'morienus',            from: 'Q4257922',   to: 'Q17493693', name: 'Morienus',              why: 'was the Book of the Composition of Alchemy (reference work); now the alchemist — Wikidata VIAF 12734759 matches our doc viaf_id exactly' },
  { slug: 'macer',               from: 'Q15833282',  to: 'Q41617302', name: 'Odo of Meung',          why: 'was De virtutibus herbarum itself (literary work); now its author, the 11th-c. poet, P50-credited with 6 works' },
  { slug: 'columella',           from: 'Q452676',    to: 'Q318317',   name: 'Columella',             why: 'was a disambiguation page; now the Roman agricultural writer, VIAF 95243635' },
  { slug: 'zhuangzi',            from: 'Q9390899',   to: 'Q47739',    name: 'Zhuang Zhou',           why: 'was a disambiguation page; now the Taoist philosopher c.369-286 BC, P50-credited with 39 works' },
];

// Aelianus Tacticus doc to mint if absent (verified live: Q5 human, 2nd-c.
// Greek military writer, P50 1 work). Same shape build-authors-collection
// writes, so downstream consumers see nothing unusual.
const TACTICUS_DOC = {
  _id: 'aelianus-tacticus',
  canonical_name: 'Aelianus Tacticus',
  slug: 'aelianus-tacticus',
  variants: ['Aelianus, Tacticus, active 2nd century', 'Aelianus Tacticus'],
  variant_slugs: ['aelianus-tacticus-active-2nd-century', 'aelianus-tacticus'],
  book_count: 1,
  viaf_id: '72639048',
  wikidata_id: 'Q380793',
  entity_ids: [],
  source: 'repair-invalid-author-anchors-3800',
  built_at: new Date(),
};

const mc = new MongoClient(process.env.MONGODB_URI);
await mc.connect();
const db = mc.db('bookstore');
const authors = db.collection('authors');
const books = db.collection('books');

// ── revert ───────────────────────────────────────────────────────────────────
if (REVERT) {
  if (!existsSync(BACKUP)) { console.error(`No backup at ${BACKUP} — nothing to revert.`); process.exit(1); }
  const saved = JSON.parse(readFileSync(BACKUP, 'utf8'));
  let n = 0;
  for (const row of saved.authors) {
    n += (await authors.updateOne({ _id: row._id }, { $set: row.before })).modifiedCount;
  }
  for (const row of saved.books) {
    n += (await books.updateOne({ _id: row._id_hex ? new (await import('mongodb')).ObjectId(row._id_hex) : row._id },
      { $set: { author_id: row.before_author_id } })).modifiedCount;
  }
  if (saved.minted_tacticus) {
    await authors.deleteOne({ _id: 'aelianus-tacticus', source: 'repair-invalid-author-anchors-3800' });
    console.log('Removed minted aelianus-tacticus doc.');
  }
  console.log(`Reverted ${n} writes from backup of ${saved.created_at}.`);
  await mc.close();
  process.exit(0);
}

// ── run-time verification: every target QID must pass the shared denylist ────
const targets = [...ANCHOR_FIXES.map(f => f.to), TACTICUS_DOC.wikidata_id];
const values = targets.map(q => `wd:${q}`).join(' ');
const query = `SELECT ?a ?type WHERE { VALUES ?a { ${values} } OPTIONAL { ?a wdt:P31 ?type } }`;
const r = await fetch('https://query.wikidata.org/sparql?' + new URLSearchParams({ query, format: 'json' }),
  { headers: { 'User-Agent': UA, Accept: 'application/sparql-results+json' }, signal: AbortSignal.timeout(60000) });
if (!r.ok) { console.error(`SPARQL ${r.status} — cannot verify targets, refusing to proceed.`); process.exit(2); }
const p31 = new Map();
for (const b of (await r.json()).results.bindings) {
  const a = b.a.value.split('/').pop();
  if (!p31.has(a)) p31.set(a, new Set());
  const t = b.type?.value?.split('/').pop();
  if (t) p31.get(a).add(t);
}
let verifyFailed = false;
for (const q of targets) {
  const problem = anchorProblem(p31.get(q));
  if (problem) { console.error(`TARGET ${q} FAILS VERIFICATION: ${problem}`); verifyFailed = true; }
}
if (verifyFailed) { console.error('Refusing to write any fix.'); process.exit(2); }
console.log(`All ${targets.length} target QIDs pass the anchor denylist (live P31 check).\n`);

// ── plan ─────────────────────────────────────────────────────────────────────
const authorWrites = [];   // { _id, before: {...}, set: {...}, why }
const bookWrites = [];     // { _id, title, before_author_id, to, why }
const skipped = [];

for (const f of ANCHOR_FIXES) {
  const doc = await authors.findOne({ _id: f.slug });
  if (!doc) { skipped.push(`${f.slug}: no doc`); continue; }
  if (doc.wikidata_id !== f.from) {
    skipped.push(`${f.slug}: wikidata_id is ${doc.wikidata_id}, not the verified-bad ${f.from} — corrected since? re-verify`);
    continue;
  }
  authorWrites.push({ _id: f.slug, before: { wikidata_id: doc.wikidata_id }, set: { wikidata_id: f.to }, why: f.why });
}

// zhuangzi merge: variants + tombstone (only if both docs are still as audited)
const z2 = await authors.findOne({ _id: 'zhuangzi-2' });
const z1 = await authors.findOne({ _id: 'zhuangzi' });
if (z2 && z1 && !z2.merged_into) {
  authorWrites.push({
    _id: 'zhuangzi',
    before: { variants: z1.variants, variant_slugs: z1.variant_slugs },
    set: {
      variants: [...new Set([...(z1.variants || []), ...(z2.variants || [])])],
      variant_slugs: [...new Set([...(z1.variant_slugs || []), ...(z2.variant_slugs || [])])],
    },
    why: 'absorb zhuangzi-2 variants',
  });
  authorWrites.push({
    _id: 'zhuangzi-2',
    before: { merged_into: z2.merged_into ?? null },
    set: { merged_into: 'zhuangzi' },
    why: 'tombstone duplicate; resolver follows merged_into',
  });
  for (const b of await books.find({ author_id: 'zhuangzi-2' }, { projection: { title: 1, author_id: 1 } }).toArray()) {
    bookWrites.push({ _id: b._id, title: b.title, before_author_id: 'zhuangzi-2', to: 'zhuangzi', why: 'zhuangzi-2 merged into zhuangzi' });
  }
} else if (z2?.merged_into) {
  skipped.push(`zhuangzi-2: already merged into ${z2.merged_into}`);
}

// Tacticus split: the book is selected by its author STRING under the aelian
// doc — self-limiting, and immune to id-format drift.
const tacticusBooks = await books.find(
  { author_id: 'aelian', author: /Tacticus/i },
  { projection: { title: 1, author: 1, author_id: 1 } }).toArray();
const needMint = !(await authors.findOne({ _id: 'aelianus-tacticus' }));
for (const b of tacticusBooks) {
  bookWrites.push({ _id: b._id, title: b.title, before_author_id: 'aelian', to: 'aelianus-tacticus', why: `author "${b.author}" is Aelianus Tacticus, not Claudius Aelianus` });
}

console.log(`Author-doc writes: ${authorWrites.length}`);
for (const w of authorWrites) console.log(`  ${w._id.padEnd(22)} ${JSON.stringify(w.before)} -> ${JSON.stringify(w.set).slice(0, 90)}\n${' '.repeat(25)}${w.why}`);
console.log(`\nBook re-points: ${bookWrites.length}`);
for (const w of bookWrites) console.log(`  ${String(w._id)}  ${w.before_author_id} -> ${w.to}  ${String(w.title).slice(0, 60)}`);
console.log(`\nMint aelianus-tacticus doc: ${needMint ? 'yes (Q380793, VIAF 72639048)' : 'no (exists)'}`);
if (skipped.length) { console.log(`\nSkipped:`); for (const s of skipped) console.log(`  ${s}`); }

if (!APPLY) {
  console.log('\nDRY-RUN. Re-run with --apply to write.');
  await mc.close();
  process.exit(0);
}

// ── backup (MERGE on id — earlier `before` wins; see author-identity.md) ─────
mkdirSync(dirname(BACKUP), { recursive: true });
const prior = existsSync(BACKUP) ? JSON.parse(readFileSync(BACKUP, 'utf8')) : { authors: [], books: [], minted_tacticus: false };
const priorAuthorIds = new Set(prior.authors.map(a => a._id));
const priorBookIds = new Set(prior.books.map(b => String(b._id_hex || b._id)));
for (const w of authorWrites) if (!priorAuthorIds.has(w._id)) prior.authors.push({ _id: w._id, before: w.before });
for (const w of bookWrites) if (!priorBookIds.has(String(w._id))) prior.books.push({ _id_hex: String(w._id), title: w.title, before_author_id: w.before_author_id });
prior.issue = 3800;
prior.created_at = prior.created_at || new Date().toISOString();
prior.last_run_at = new Date().toISOString();
prior.minted_tacticus = prior.minted_tacticus || needMint;
writeFileSync(BACKUP, JSON.stringify(prior, null, 2));
console.log(`\nBackup merged: ${BACKUP}`);

// ── write ────────────────────────────────────────────────────────────────────
if (needMint) {
  await authors.insertOne(TACTICUS_DOC);
  console.log('Minted authors/aelianus-tacticus.');
}
let na = 0;
for (const w of authorWrites) {
  na += (await authors.updateOne({ _id: w._id }, { $set: { ...w.set, anchor_repair_3800: { date: new Date(), why: w.why } } })).modifiedCount;
}
let nb = 0;
for (const w of bookWrites) {
  nb += (await books.updateOne(
    { _id: w._id, author_id: w.before_author_id },   // re-assert at write time
    { $set: {
        author_id: w.to,
        updated_at: new Date(),
        'field_provenance.author_id': {
          source: 'maintenance', script: 'repair-invalid-author-anchors-3800.mjs', issue: 3800,
          date: new Date(), previous_value: w.before_author_id, note: w.why,
        },
      } })).modifiedCount;
}
console.log(`APPLIED: ${na}/${authorWrites.length} author docs, ${nb}/${bookWrites.length} book re-points.`);
if (na !== authorWrites.length || nb !== bookWrites.length) {
  console.error('WARNING: write counts do not match the plan — re-run the dry-run before assuming success.');
}
console.log('\nNext: rerun scripts/audit/author-anchor-validity.mjs (also covers the 50-anchor SPARQL-429 tail),');
console.log('then the work resolver can pick these ~155 books up on its next pass.');
await mc.close();
