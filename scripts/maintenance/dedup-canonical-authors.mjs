#!/usr/bin/env node
/**
 * Clean the canonical `authors` thesaurus (GitHub #2250, §5 follow-ups):
 *   1. SELF-DEDUP — fold same-person split docs into one canonical doc.
 *   2. TITLE-CONTAMINATION — fold "<Surname> <WorkTitle>" docs into the real
 *      anchored author (e.g. "Kircher Mundus" -> athanasius-kircher).
 *   3. QUARANTINE MISSES — flag institutions / works as `is_person:false`.
 *   4. RECOMPUTE `book_count` — replace the stale build snapshot with the live count.
 *
 * MERGE PRECISION (under-merge over mis-merge — the #2218/#2250 stance):
 *   - STRONG: two docs share an `entity_id` → the build already judged them one
 *     person. Always safe.
 *   - SAFE-VARIANT: docs collide on a name string AND there is exactly ONE anchored
 *     (viaf/wikidata) doc in the cluster AND every other doc only contributes
 *     compound co-author strings ("A|B", "A; B") or the primary's own name forms.
 *     This folds co-author-compound docs (e.g. "Bacon, Roger|Alexander") without
 *     merging genuinely distinct people. Anything else (two distinct anchors;
 *     a non-compound foreign name like "D.P. Pers" under "Persius"; a generic
 *     single name like "Alfonso") is SKIPPED and reported for human review.
 *
 * MECHANICS (additive + reversible, NO deletes):
 *   - Primary absorbs union(variants, variant_slugs, entity_ids) + the secondary's
 *     own slug into variant_slugs (so the old URL 301s), and fills viaf/wikidata if
 *     missing. `merged_from[]` on the primary stores each secondary's original
 *     fields for reversal.
 *   - Secondary becomes a tombstone: `{ merged_into: <primarySlug>, is_person:false }`.
 *     The read-path resolver follows `merged_into` to the primary and 301s.
 *
 * USAGE:
 *   node scripts/maintenance/dedup-canonical-authors.mjs            # dry run
 *   node scripts/maintenance/dedup-canonical-authors.mjs --apply
 *   node scripts/maintenance/dedup-canonical-authors.mjs --undo --apply
 */
import { MongoClient, ObjectId } from 'mongodb';

const RUN_ID = 'dedup-2250';
const APPLY = process.argv.includes('--apply');
const UNDO = process.argv.includes('--undo');
const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const isCompound = (s) => /[|;&]/.test(s || '');
// surname-key: last meaningful token, latinized — mirrors build-canonical-authors.mjs intent
const PARTICLES = new Set(['de','del','della','di','da','la','le','van','von','der','den','du','des','el','al','ibn','ben','of','the','don','st','saint','y','e','dos']);

const mc = new MongoClient(process.env.MONGODB_URI);
await mc.connect();
const db = mc.db('bookstore');
const authors = db.collection('authors');
const books = db.collection('books');

if (UNDO) {
  const tombstones = await authors.find({ 'merged_into': { $exists: true }, 'merge_run': RUN_ID }).toArray();
  console.log(`[undo] ${tombstones.length} tombstones from ${RUN_ID}.`);
  if (APPLY) {
    for (const t of tombstones) {
      await authors.updateOne({ _id: t._id }, { $unset: { merged_into: '', merge_run: '' }, $set: { is_person: true } });
    }
    // pull merged_from records and leave primaries' absorbed arrays (harmless supersets);
    // a clean rebuild is build-canonical-authors.mjs if exactness is needed.
    await authors.updateMany({ 'merged_from.run': RUN_ID }, { $pull: { merged_from: { run: RUN_ID } } });
    console.log('[undo] restored tombstones to is_person:true; pulled merged_from records.');
  } else console.log('[undo] dry run — add --apply.');
  await mc.close();
  process.exit(0);
}

const all = await authors.find({}, { projection: { slug: 1, canonical_name: 1, variants: 1, variant_slugs: 1, entity_ids: 1, viaf_id: 1, wikidata_id: 1, book_count: 1, is_person: 1 } }).toArray();
const persons = all.filter((a) => a.is_person !== false);
const byId = new Map(all.map((a) => [a.slug, a]));
const anchored = (d) => !!(d.viaf_id || d.wikidata_id);

// ---- cluster: strong (shared entity) then weak (shared variant) ----
const parent = new Map(persons.map((a) => [a.slug, a.slug]));
const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
const uni = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
const linkBy = new Map(); // slug-pair -> 'entity' | 'variant'
const entB = new Map(), varB = new Map();
for (const a of persons) {
  for (const e of (a.entity_ids || [])) { const k = String(e); (entB.get(k) || entB.set(k, []).get(k)).push(a.slug); }
  const seen = new Set();
  for (const v of [a.canonical_name, ...(a.variants || [])]) { if (!v) continue; const k = norm(v); if (seen.has(k)) continue; seen.add(k); (varB.get(k) || varB.set(k, []).get(k)).push(a.slug); }
}
const strongPairs = new Set();
for (const arr of entB.values()) for (let j = 1; j < arr.length; j++) { uni(arr[0], arr[j]); strongPairs.add([arr[0], arr[j]].sort().join('|')); }
for (const arr of varB.values()) for (let j = 1; j < arr.length; j++) uni(arr[0], arr[j]);

const clusters = new Map();
for (const a of persons) { const r = find(a.slug); (clusters.get(r) || clusters.set(r, []).get(r)).push(a.slug); }
const multi = [...clusters.values()].filter((c) => c.length > 1);

// ---- decide each cluster ----
const merges = [];   // { primary, secondaries:[], reason }
const review = [];   // { slugs, reason }
for (const c of multi) {
  const docs = c.map((s) => byId.get(s));
  const anchoredDocs = docs.filter(anchored);
  const distinctAnchors = new Set(docs.map((d) => d.viaf_id || d.wikidata_id).filter(Boolean));
  // shared-entity cluster? (any pair was strong)
  const hasStrong = c.some((s1, i) => c.slice(i + 1).some((s2) => strongPairs.has([s1, s2].sort().join('|'))));

  if (distinctAnchors.size > 1) { review.push({ slugs: c, reason: 'multiple distinct anchors (possibly distinct people)' }); continue; }

  const primary = docs.slice().sort((a, b) => (anchored(b) - anchored(a)) || ((b.book_count || 0) - (a.book_count || 0)) || a.slug.length - b.slug.length)[0];
  const secondaries = docs.filter((d) => d.slug !== primary.slug);

  if (hasStrong) { merges.push({ primary, secondaries, reason: 'shared entity_id' }); continue; }

  // weak (variant-only): require unique anchored primary + every secondary variant is
  // compound or a name form already on the primary.
  if (anchoredDocs.length === 1 && anchored(primary)) {
    const primForms = new Set([norm(primary.canonical_name), ...(primary.variants || []).map(norm)]);
    const ok = secondaries.every((s) => (s.variants || []).concat(s.canonical_name).every((v) => !v || isCompound(v) || primForms.has(norm(v))));
    if (ok) { merges.push({ primary, secondaries, reason: 'co-author compound / name-form fold' }); continue; }
  }
  review.push({ slugs: c, reason: 'variant-only collision, not a safe fold' });
}

// ---- title-contamination: EXPLICIT allowlist only.
// A general surname-key heuristic was tried and rejected — it mis-merged distinct
// same-surname people (e.g. "George Washington" -> "Washington Matthews",
// "Karl Müller" -> "F. Max Müller"). Author-title disambiguation is not safely
// automatable here; only known-safe, work-title-contaminated docs are folded, and
// each is confirmed to fold into a uniquely-matching ANCHORED person. Everything
// else is reported (see §5 follow-up) for human/Scholar-in-Residence review.
const TITLE_FOLD_ALLOWLIST = {
  'kircher-mundus': 'athanasius-kircher',
  'kircher-oedipus': 'athanasius-kircher',
  'kircher-musurgia': 'athanasius-kircher',
  'kircher-magneticum': 'athanasius-kircher',
};
const mergedAway = new Set(merges.flatMap((m) => m.secondaries.map((s) => s.slug)));
const titleFolds = [];
for (const [secSlug, primSlug] of Object.entries(TITLE_FOLD_ALLOWLIST)) {
  const sec = byId.get(secSlug), prim = byId.get(primSlug);
  if (!sec || !prim) { console.log(`   (allowlist skip: ${secSlug} or ${primSlug} not found)`); continue; }
  if (!anchored(prim)) { console.log(`   (allowlist skip: primary ${primSlug} is not anchored)`); continue; }
  if (mergedAway.has(secSlug)) continue;
  titleFolds.push({ primary: prim, secondaries: [sec], reason: 'title-contaminated (allowlist)' });
}

// ---- quarantine misses: institutions / works typed as persons ----
const NONPERSON = /\b(bibliothek|staatsib?liothek|universit|school|gesellschaft|verlag|press|druck|officina|imprimerie|collection|monastery|temple|abbey|society|fraternitatis|rosenkreutz|confessio)\b/i;
const quarantine = persons.filter((a) => !mergedAway.has(a.slug) && !anchored(a) && NONPERSON.test(a.canonical_name || ''));

// ---- REPORT ----
console.log('=== dedup-canonical-authors (#2250) ===');
console.log(`mode: ${APPLY ? 'APPLY' : 'DRY RUN'}\n`);
console.log(`SELF-DEDUP merges: ${merges.length} clusters, ${merges.reduce((s, m) => s + m.secondaries.length, 0)} docs folded`);
for (const m of merges) console.log(`   [${m.reason}] ${m.secondaries.map((s) => s.slug).join(', ')}  ->  ${m.primary.slug}`);
console.log(`\nTITLE-CONTAMINATION folds: ${titleFolds.length}`);
for (const m of titleFolds) console.log(`   "${m.secondaries[0].canonical_name}" (${m.secondaries[0].slug})  ->  ${m.primary.slug} "${m.primary.canonical_name}"`);
console.log(`\nQUARANTINE (is_person:false): ${quarantine.length}`);
for (const q of quarantine) console.log(`   ${q.slug}  "${q.canonical_name}"`);
console.log(`\nSKIPPED for human review: ${review.length}`);
for (const r of review) console.log(`   [${r.reason}] ${r.slugs.join(', ')}`);

if (!APPLY) { console.log('\nDry run — add --apply. Reversible via --undo --apply.'); await mc.close(); process.exit(0); }

// ---- APPLY ----
const liveCount = async (doc) => {
  const or = [{ author_id: doc.slug }];
  if ((doc.entity_ids || []).length) or.push({ author_entity_id: { $in: doc.entity_ids } });
  if ((doc.variants || []).length) or.push({ author: { $in: doc.variants } });
  return books.countDocuments({ visible: true, $or: or });
};
const stamp = new Date().toISOString();
let foldedDocs = 0;
// Group every fold by primary slug so multiple clusters targeting the SAME primary
// (e.g. the four Kircher title-folds) accumulate in one write instead of clobbering.
const byPrimary = new Map();
for (const m of [...merges, ...titleFolds]) {
  if (!byPrimary.has(m.primary.slug)) byPrimary.set(m.primary.slug, { primary: m.primary, secondaries: [] });
  byPrimary.get(m.primary.slug).secondaries.push(...m.secondaries);
}
for (const m of byPrimary.values()) {
  const p = m.primary;
  const addVariants = new Set(p.variants || []);
  const addSlugs = new Set(p.variant_slugs || []);
  const addEnts = new Set((p.entity_ids || []).map(String));
  const mergedFrom = [];
  const patch = {};
  for (const s of m.secondaries) {
    (s.variants || []).forEach((v) => addVariants.add(v));
    (s.variant_slugs || []).forEach((v) => addSlugs.add(v));
    addSlugs.add(s.slug);
    (s.entity_ids || []).forEach((e) => addEnts.add(String(e)));
    if (!p.viaf_id && s.viaf_id && !patch.viaf_id) patch.viaf_id = s.viaf_id;
    if (!p.wikidata_id && s.wikidata_id && !patch.wikidata_id) patch.wikidata_id = s.wikidata_id;
    mergedFrom.push({ run: RUN_ID, slug: s.slug, canonical_name: s.canonical_name, variants: s.variants, variant_slugs: s.variant_slugs, entity_ids: s.entity_ids, at: stamp });
    await authors.updateOne({ _id: s._id }, { $set: { merged_into: p.slug, merge_run: RUN_ID, is_person: false } });
    foldedDocs++;
  }
  await authors.updateOne({ _id: p._id }, {
    $set: { variants: [...addVariants], variant_slugs: [...addSlugs], entity_ids: [...addEnts], ...patch },
    $push: { merged_from: { $each: mergedFrom } },
  });
  // recompute primary count after the fold
  const fresh = await authors.findOne({ _id: p._id }, { projection: { slug: 1, variants: 1, entity_ids: 1 } });
  await authors.updateOne({ _id: p._id }, { $set: { book_count: await liveCount(fresh) } });
}
for (const q of quarantine) await authors.updateOne({ _id: q._id }, { $set: { is_person: false, quarantine_run: RUN_ID } });

// recompute book_count for ALL surviving persons (kills the stale build snapshot)
let recomputed = 0;
const survivors = await authors.find({ is_person: { $ne: false } }, { projection: { slug: 1, variants: 1, entity_ids: 1 } }).toArray();
for (let i = 0; i < survivors.length; i += 200) {
  const batch = survivors.slice(i, i + 200);
  await Promise.all(batch.map(async (d) => { await authors.updateOne({ _id: d._id }, { $set: { book_count: await liveCount(d) } }); recomputed++; }));
}
console.log(`\nAPPLIED: folded ${foldedDocs} docs, quarantined ${quarantine.length}, recomputed book_count on ${recomputed} survivors.`);
await mc.close();
