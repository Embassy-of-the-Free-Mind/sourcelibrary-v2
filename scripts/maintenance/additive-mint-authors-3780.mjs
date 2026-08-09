#!/usr/bin/env node
/**
 * Stage 3 of #3780 — ADDITIVE minting for classified author strings.
 *
 * Input: a classification file (one JSON object per line):
 *   {"string": "...", "verdict": "person"|"institution"|..., "canonical_name": "...", "note": "..."}
 * produced by the stage-2 review of enumerate-unmatched-author-strings.mjs
 * output (heuristic buckets + per-string classification by Claude agents, with
 * the person/institution calls being the only ones acted on here).
 *
 * WHY ADDITIVE, NOT A REBUILD. build-authors-collection.mjs over all books
 * would re-cluster the whole thesaurus and can silently relink live books
 * (#3780's stated non-goal). This script only ever:
 *   - APPENDS a variant to an existing doc when the string's cluster key
 *     (the builder's canonicalKey) already belongs to a canonical person —
 *     extending recall without reshaping anything; or
 *   - MINTS a new doc when the key matches nothing — a new person cannot
 *     reshape existing clusters by construction.
 * Institutions are minted with is_person: false (the read-path gate, #3483)
 * so they render as Organization, never as a portrait-slot person.
 *
 * Strings whose key lands on a QUARANTINED doc (is_person: false) or a
 * tombstone (merged_into) are skipped and reported — a person string keying
 * into a non-person cluster needs eyes, not automation.
 *
 * After applying, run:
 *   node scripts/maintenance/backfill-author-canonical-links.mjs --include-backlog --apply
 * which links books by exact NFD variant match to exactly one doc (its own
 * safety rules, provenance, and --undo).
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/maintenance/additive-mint-authors-3780.mjs --input <verdicts.jsonl>           # dry-run
 *   node --env-file=.env.production.local scripts/maintenance/additive-mint-authors-3780.mjs --input <verdicts.jsonl> --apply
 *   node --env-file=.env.production.local scripts/maintenance/additive-mint-authors-3780.mjs --revert   # remove minted docs + appended variants
 */
import { MongoClient } from 'mongodb';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const APPLY = process.argv.includes('--apply');
const REVERT = process.argv.includes('--revert');
const INPUT = (process.argv.find(a => a.startsWith('--input=')) || '').split('=')[1]
  || process.argv[process.argv.indexOf('--input') + 1];
const BACKUP = 'scripts/output/additive-mint-3780-backup.json';
const SOURCE = 'additive-mint-3780';

// The builder's clustering + slug rules — shared via scripts/lib/author-name-key.mjs.
import { norm, canonicalKey, authorSlug } from '../lib/author-name-key.mjs';

const mc = new MongoClient(process.env.MONGODB_URI);
await mc.connect();
const db = mc.db('bookstore');
const authors = db.collection('authors');

// ── revert ───────────────────────────────────────────────────────────────────
if (REVERT) {
  if (!existsSync(BACKUP)) { console.error(`No backup at ${BACKUP}.`); process.exit(1); }
  const saved = JSON.parse(readFileSync(BACKUP, 'utf8'));
  const del = await authors.deleteMany({ _id: { $in: saved.minted }, source: SOURCE });
  let pulls = 0;
  for (const ap of saved.appended) {
    const r = await authors.updateOne({ _id: ap.doc }, { $pull: { variants: ap.variant, variant_slugs: ap.variant_slug || '__none__' } });
    pulls += r.modifiedCount;
  }
  console.log(`Reverted: deleted ${del.deletedCount} minted docs, pulled variants from ${pulls} docs.`);
  console.log('NOTE: if the backfill already linked books to these, run its --undo too.');
  await mc.close();
  process.exit(0);
}

if (!INPUT || !existsSync(INPUT)) { console.error('Pass --input <verdicts.jsonl>'); process.exit(1); }
const verdicts = readFileSync(INPUT, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const actionable = verdicts.filter(v => (v.verdict === 'person' && v.canonical_name) || v.verdict === 'institution');
console.log(`${verdicts.length} verdicts; acting on ${actionable.length} (person-with-name + institution). Others (compound/editor/defect/placeholder/uncertain) untouched.`);

// ── index existing docs: normalized variant -> doc, cluster key -> doc ───────
const byVariant = new Map();
const byKey = new Map();
const usedIds = new Set();
for await (const a of authors.find({}, { projection: { canonical_name: 1, variants: 1, merged_into: 1, is_person: 1 } })) {
  usedIds.add(a._id);
  for (const v of new Set([...(a.variants || []), a.canonical_name].filter(Boolean))) {
    if (!byVariant.has(norm(v))) byVariant.set(norm(v), a);
    const k = canonicalKey(v);
    if (k && !byKey.has(k)) byKey.set(k, { ...a, viaVariant: v });
  }
}
console.log(`existing docs indexed: ${usedIds.size}`);

// Hand-reviewed exclusions (2026-08-09): key collisions that are NOT the same
// person. Each routes to the review report instead of writing.
const EXCLUDE_APPEND = new Set([
  'marbode-of-rennes|Pictorius, Georg',        // Pictorius EDITED Marbode's De lapidibus; doc carries a pre-existing conflated variant
  'saint-jerome|Osius, Hieronymus',            // Hieronymus Osius, 16th-c. Wittenberg poet — not Jerome
  'wang-gai|王珪 Wang Gui (Yuan)',              // Wang Gai (Mustard Seed Garden) ≠ Wang Gui
  'rhumelius-johann-conrad-ii|Rhumel, Johann Conrad', // Nuremberg physician father/son — conflation risk
]);

const mints = [];      // { _id, doc }
const appends = [];    // { doc, variant, variant_slug }
const skips = [];
const claimedKeys = new Map();  // key -> minted doc id, so same-person strings in one run converge

for (const v of actionable) {
  const s = v.string;
  if (byVariant.has(norm(s))) { skips.push({ s, why: 'already a variant (matched since enumeration)' }); continue; }
  const display = v.verdict === 'institution' ? s : v.canonical_name;
  const key = canonicalKey(s);
  const keyHit = byKey.get(key) || byKey.get(canonicalKey(display)) || (claimedKeys.has(key) ? { _id: claimedKeys.get(key), minted: true } : null);

  if (keyHit && !keyHit.minted) {
    if (keyHit.merged_into) { skips.push({ s, why: `key lands on tombstone ${keyHit._id} -> ${keyHit.merged_into}` }); continue; }
    if (keyHit.is_person === false) { skips.push({ s, why: `key lands on QUARANTINED doc ${keyHit._id} — needs eyes` }); continue; }
    if (v.verdict === 'institution') { skips.push({ s, why: `institution string keys onto person doc ${keyHit._id} — needs eyes` }); continue; }
    if (EXCLUDE_APPEND.has(`${keyHit._id}|${s}`)) { skips.push({ s, why: `hand-excluded: key collision with ${keyHit._id} is NOT the same person` }); continue; }
    appends.push({ doc: keyHit._id, variant: s, variant_slug: authorSlug(s) || null, via: keyHit.viaVariant });
    continue;
  }
  if (keyHit?.minted) {
    // same cluster key as a doc minted earlier THIS run — append there
    appends.push({ doc: keyHit._id, variant: s, variant_slug: authorSlug(s) || null });
    continue;
  }

  let id = authorSlug(display);
  if (!id) { skips.push({ s, why: 'canonical_name slugs to empty — needs a romanization' }); continue; }
  for (let n = 2; usedIds.has(id); n++) id = `${authorSlug(display)}-${n}`;
  usedIds.add(id);
  claimedKeys.set(key, id);
  const variants = [...new Set([s, display])];
  mints.push({
    _id: id,
    doc: {
      _id: id,
      canonical_name: display,
      slug: id,
      variants,
      variant_slugs: [...new Set(variants.map(authorSlug).filter(Boolean))],
      book_count: v.books ?? null,
      viaf_id: null,
      wikidata_id: null,
      entity_ids: [],
      ...(v.verdict === 'institution' ? { is_person: false } : {}),
      source: SOURCE,
      built_at: new Date(),
    },
  });
}

console.log(`\nPlan: mint ${mints.length} new docs (${mints.filter(m => m.doc.is_person === false).length} institutions), append ${appends.length} variants to existing docs, skip ${skips.length}.`);
console.log('\nSample mints:');
for (const m of mints.slice(0, 15)) console.log(`  ${m._id.padEnd(40)} "${m.doc.canonical_name}"${m.doc.is_person === false ? '  [institution]' : ''}`);
console.log('\nVariant appends:');
for (const a of appends) console.log(`  ${a.doc.padEnd(40)} += "${a.variant}"  [via "${a.via || 'same-run mint'}"]`);
if (skips.length) {
  console.log('\nSkips:');
  for (const s of skips.slice(0, 30)) console.log(`  "${s.s.slice(0, 50)}" — ${s.why}`);
}

if (!APPLY) { console.log('\nDRY-RUN. Re-run with --apply to write.'); await mc.close(); process.exit(0); }

// ── backup (merge on id — earlier entries win) then write ────────────────────
mkdirSync(dirname(BACKUP), { recursive: true });
const prior = existsSync(BACKUP) ? JSON.parse(readFileSync(BACKUP, 'utf8')) : { minted: [], appended: [] };
const havePrior = new Set(prior.minted);
const havePriorAppend = new Set(prior.appended.map(a => `${a.doc} ${a.variant}`));
for (const m of mints) if (!havePrior.has(m._id)) prior.minted.push(m._id);
for (const a of appends) if (!havePriorAppend.has(`${a.doc} ${a.variant}`)) prior.appended.push(a);
prior.issue = 3780;
prior.created_at = prior.created_at || new Date().toISOString();
prior.last_run_at = new Date().toISOString();
writeFileSync(BACKUP, JSON.stringify(prior, null, 2));

let minted = 0;
for (const m of mints) {
  try { await authors.insertOne(m.doc); minted++; }
  catch (e) { if (e.code === 11000) skips.push({ s: m._id, why: 'id collided at write time' }); else throw e; }
}
let appended = 0;
for (const a of appends) {
  const r = await authors.updateOne(
    { _id: a.doc, merged_into: { $exists: false } },
    { $addToSet: { variants: a.variant, ...(a.variant_slug ? { variant_slugs: a.variant_slug } : {}) } },
  );
  appended += r.modifiedCount;
}
console.log(`\nAPPLIED: minted ${minted}/${mints.length}, appended variants on ${appended}/${appends.length} docs. Backup: ${BACKUP}`);
console.log('\nNext: node scripts/maintenance/backfill-author-canonical-links.mjs --include-backlog --apply');
await mc.close();
