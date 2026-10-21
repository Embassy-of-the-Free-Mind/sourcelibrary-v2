#!/usr/bin/env node
/**
 * Ten Vatican manuscript records were retitled by hand on 2026-10-20 (#7060). Their title,
 * display_title, author and published are already correct. This clears everything DERIVED
 * from the old identity so the pipeline re-derives it from the corrected record, and
 * repairs the two non-`books` stores that still serve the old name.
 *
 * PRIOR ART: scripts/maintenance/repair-pharar-author-2026-09-24.mjs — same shape (backup,
 * provenance, sweep_log, --apply/--revert, book_indexes, Supabase books_catalog mirror), but
 * it REWRITES strings carrying one old name in one book. Here the old identity is a whole
 * different work, so rewriting would invent text: the fields are CLEARED, never rewritten.
 * Also read: derived-metadata-lane.md ("A metadata CORRECTION hits the same lane"),
 * work-identity.md, edition-identity.md, first-translation-claims.md.
 *
 * Writes (all on the literal id list below; nothing is deleted, every prior value is in the backup):
 *   books            $unset summary (when it holds text), summary_candidate, description, subject_keywords,
 *                    index.bookSummary, collection_scores(+_meta), quality_assessment.ai_scores.
 *                    historical_significance.reasoning, translation_verification, first_translation,
 *                    first_translation_status, work_id/work_slug/work_title/work_id_source/
 *                    work_id_confidence (an unkeyed book is "unknown coverage", never a gap);
 *                    $set english_title + normalized_title from the corrected title;
 *                    is_first_translation true -> false (retires a badge whose evidence was about the old work;
 *                    never sets one); categories/collections: only the entries in REMOVE below.
 *   book_indexes     $unset bookSummary
 *   collections      highlighted_books / mentioned_books entries for the book ids in COLLECTION_PULLS,
 *                    and the hero_image_attribution title of byzantine-bridge
 *   books_catalog    (Supabase) title/display_title/author/language mirrored from Mongo; derived columns nulled
 *   field_provenance + sweep_log rows
 * NOT done here: edition_key — restamp with `npx tsx scripts/maintenance/materialize-edition-keys.ts
 * --book-id=<id> --apply` (the canonical builder is TypeScript). `slug` is never touched.
 * ACTUATION: an absent `summary` reads as "summary_indexed not done", so the pipeline will regenerate it.
 *
 *   node --env-file=.env.production.local scripts/maintenance/clear-derived-vatican-retitle-2026-10-20.mjs            # dry run
 *   ... --apply [--revalidate]
 *   ... --revert --apply [--revalidate]
 */
import { MongoClient } from 'mongodb';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { recordSweepAction } from '../lib/sweep-log.mjs';
import { revalidateBookPages } from '../lib/revalidate.mjs';
// The repo's slug helper (plain TS, no imports; Node strips the types). Not hand-rolled.
const { generateBookSlug } = await import('../../src/lib/slugify.ts');

const HERE = dirname(fileURLToPath(import.meta.url));
const RUN = 'clear-derived-vatican-retitle-2026-10-20';
const BACKUP = join(HERE, 'backups', `${RUN}.json`);
const SLUG_BACKUP = join(HERE, 'backups', `${RUN}-slugs.json`);
const OPS_BACKUP = join(homedir(), 'sourcelibrary-ops/audits/vatican-2026-10-20/derived-clear-backup.json');
const APPLY = process.argv.includes('--apply');
const REVERT = process.argv.includes('--revert');
const REVALIDATE = process.argv.includes('--revalidate');

const IDS = [
  '69a5e45f006a409842216cb6', '69a5e3749bb980f50423366a', '69a5e3c79bb980f504233baa', '69a5e3d7006a4098422165d4',
  '69a5e3d6006a4098422163f5', '69a5e3a6006a40984221604d', '6990660aef12272ffdc94ef0', '6953ab7477f38f6761bd729d',
  '6953ab6477f38f6761bd6ffa', '69942f45b2f6748db4ac0121',
];

// Memberships the corrected identity does not support. Anything not listed stays. Ficino
// (6990660a), Pappus (366a) and Vat.gr.191 (3baa) keep theirs: their corrected identity still fits.
const REMOVE = {
  '69a5e45f006a409842216cb6': { collections: ['magic', 'astrology', 'shwep', 'hermetica', 'forbidden-books'], categories: ['magic'] }, // Frederick II, falconry
  '6953ab7477f38f6761bd729d': { collections: ['hermetica', 'shwep', 'mystical-practice', 'spiritual-alchemy', 'jungs-library', 'the-moon', 'eros-esoteric'], categories: ['hermeticism'] }, // Reg.lat.1278: the corrected title still says "alchemical recipes", so alchemy stays; the Rosarium-derived esoteric memberships go
  '69a5e3d6006a4098422163f5': { collections: ['newtons-other-science'], categories: ['alchemy'] }, // Ross.247 computus
  '6953ab6477f38f6761bd6ffa': { collections: [], categories: ['alchemy'] }, // Pal.lat.1262 medical/moral
  '69942f45b2f6748db4ac0121': { collections: ['classical-philosophy', 'renaissance-philosophy', 'shwep', 'theology', 'platonic-tradition', 'neoplatonism'], categories: ['philosophy'] }, // Pal.gr.108 lexicon
  '69a5e3a6006a40984221604d': { collections: ['classical-philosophy', 'school-of-athens'], categories: ['philosophy'] }, // Vat.gr.130 Diodorus
  '69a5e3d7006a4098422165d4': { collections: [], categories: ['neoplatonism', 'mysticism'] }, // Vat.gr.2181 Aristophanes
};
const RESTORE = { '6953ab7477f38f6761bd729d': ['alchemy'] };
const PULL_IDS = ['6953ab7477f38f6761bd729d', '69942f45b2f6748db4ac0121']; // Reg.lat.1278, Pal.gr.108
const COLLECTION_FIELDS = ['highlighted_books', 'mentioned_books', 'hero_image_attribution', 'important_book_ids'];

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SH = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' };
const sb = (q, init = {}) => fetch(`${SUPABASE_URL}/rest/v1/books_catalog?${q}`, { ...init, headers: { ...SH, ...(init.headers || {}) } });
// Mirrors normalizeTitle() in src/lib/dedup.ts (TypeScript; a script cannot import it).
const normalizeTitle = (t) => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/^(the|a|an|der|die|das|de|le|la|les|il|lo|gli|i|el|los|las)\s+/i, '')
  .replace(/\s*[(\[:]?\s*(vol\.?\s*\d+|tomus?\s*\d+|part\.?\s*\d+|band\s*\d+|tome?\s*\d+)[)\]]?\s*$/i, '')
  .replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();

const BOOK_UNSET = ['summary_candidate', 'description', 'subject_keywords', 'index.bookSummary', 'collection_scores', 'collection_scores_meta',
  'quality_assessment.ai_scores.historical_significance.reasoning', 'translation_verification', 'first_translation', 'first_translation_status',
  'work_id', 'work_slug', 'work_title', 'work_id_source', 'work_id_confidence'];
const get = (o, p) => p.split('.').reduce((a, k) => a?.[k], o);
const SB_NULL = ['summary_text', 'description', 'subject_keywords', 'work_id', 'ft_disposition', 'ft_reasoning', 'ft_verdict', 'ft_evidence_strength', 'ft_our_completeness'];

const mc = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
await mc.connect();
const db = mc.db('bookstore');
const books = db.collection('books');
const now = new Date();

async function revalidate(ds) {
  if (!REVALIDATE) return;
  const r = await revalidateBookPages(ds.map((d) => ({ id: d.id, slug: d.slug })));
  console.log(`revalidated: ${JSON.stringify({ revalidated: r.revalidated })}`);
}

if (REVERT) {
  const bk = JSON.parse(readFileSync(BACKUP, 'utf8'));
  console.log(`revert: ${bk.books.length} books, ${bk.book_indexes.length} book_indexes, ${bk.collections.length} collections, ${bk.supabase.length} supabase rows`);
  if (!APPLY) { console.log('-- dry run --'); await mc.close(); process.exit(0); }
  for (const b of bk.books) {
    const set = {}, unset = {};
    for (const [f, v] of Object.entries(b.before)) (v === '__ABSENT__' ? unset : set)[f] = v === '__ABSENT__' ? '' : v;
    const r = await books.updateOne({ id: b.id }, { $set: { ...set, updated_at: now }, ...(Object.keys(unset).length ? { $unset: unset } : {}) });
    console.log(`  book ${b.id.slice(-4)} modified ${r.modifiedCount}`);
  }
  for (const x of bk.book_indexes) await db.collection('book_indexes').updateOne({ book_id: x.book_id }, { $set: { bookSummary: x.bookSummary } });
  for (const c of bk.collections) await db.collection('collections').updateOne({ slug: c.slug }, { $set: c.before });
  for (const r of bk.supabase) { const { id, ...rest } = r; const res = await sb(`id=eq.${id}`, { method: 'PATCH', body: JSON.stringify(rest) }); if (!res.ok) console.log('  supabase fail', id, res.status); }
  if (existsSync(SLUG_BACKUP)) {
    const sl = JSON.parse(readFileSync(SLUG_BACKUP, 'utf8'));
    for (const x of sl) {
      const r = await books.updateOne({ id: x.id }, { $set: { slug: x.old }, $pull: { slug_aliases: x.old } });
      await sb(`id=eq.${x.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ slug: x.old }) });
      console.log(`  slug ${x.id.slice(-4)} -> ${x.old} (${r.modifiedCount}); new slug ${x.new} stays as a dead URL until revalidated`);
    }
    await revalidate(sl.flatMap((x) => [{ id: x.id, slug: x.old }, { id: x.id, slug: x.new }]));
  }
  const ds = await books.find({ id: { $in: IDS } }, { projection: { id: 1, slug: 1 } }).toArray();
  await revalidate(ds);
  await mc.close(); process.exit(0);
}

const docs = await books.find({ id: { $in: IDS } }).toArray();
if (docs.length !== IDS.length) { console.error(`!! expected ${IDS.length} books, found ${docs.length}`); process.exit(1); }
const bi = await db.collection('book_indexes').find({ book_id: { $in: IDS }, bookSummary: { $exists: true } }).toArray();
const sbRows = await (await sb(`id=in.(${IDS.join(',')})&select=*`)).json();
const colls = await db.collection('collections').find({ $or: [
  { 'highlighted_books.book_id': { $in: PULL_IDS } }, { 'mentioned_books.book_id': { $in: PULL_IDS } }, { 'hero_image_attribution.book_id': { $in: PULL_IDS } } ] }).toArray();

// Plan
const plan = [];
for (const d of docs) {
  const rm = REMOVE[d.id] || {};
  if (!d.field_provenance?.title) { console.error(`!! ${d.id} has no field_provenance.title — is the retitle applied?`); process.exit(1); }
  const set = { english_title: d.title, normalized_title: normalizeTitle(d.title) };
  const unset = [];
  for (const f of BOOK_UNSET) if (get(d, f) !== undefined) unset.push(f);
  if (typeof d.summary?.data === 'string' && d.summary.data.trim()) unset.push('summary');
  if (d.is_first_translation === true) set.is_first_translation = false;
  if (RESTORE[d.id]) set.collections = [...new Set([...(d.collections || []), ...RESTORE[d.id]])]; // first pass over-removed 'alchemy'
  if (rm.collections?.length) set.collections = (set.collections || d.collections || []).filter((c) => !rm.collections.includes(c));
  if (rm.categories?.length) set.categories = (d.categories || []).filter((c) => !rm.categories.includes(c));
  if (RESTORE[d.id]) set.categories = [...new Set([...(set.categories || d.categories || []), 'alchemy'])];
  const removedColl = (d.collections || []).filter((c) => (rm.collections || []).includes(c));
  plan.push({ d, set, unset, removedColl });
  console.log(`${d.id.slice(-4)} ${d.title.slice(0, 44).padEnd(44)} unset ${unset.length} [${unset.map((u) => u.split('.').pop()).join(',')}]${set.is_first_translation === false ? ' FT-true->false' : ''}${removedColl.length ? ` coll-${removedColl.length}[${removedColl.join(',')}]` : ''}${rm.categories ? ` cat-[${rm.categories.join(',')}]` : ''}`);
}
const colPlans = colls.map((c) => {
  const after = {};
  const hb = (c.highlighted_books || []).filter((x) => !PULL_IDS.includes(x.book_id));
  if (hb.length !== (c.highlighted_books || []).length) after.highlighted_books = hb;
  const mb = (c.mentioned_books || []).filter((x) => !PULL_IDS.includes(x.book_id));
  if (mb.length !== (c.mentioned_books || []).length) after.mentioned_books = mb;
  if (c.hero_image_attribution && PULL_IDS.includes(c.hero_image_attribution.book_id)) {
    const nd = docs.find((d) => d.id === c.hero_image_attribution.book_id);
    after.hero_image_attribution = { ...c.hero_image_attribution, title: nd.display_title || nd.title };
  }
  console.log(`collections/${c.slug}: ${Object.keys(after).map((k) => `${k}${Array.isArray(after[k]) ? ` ${c[k].length}->${after[k].length}` : ' retitled'}`).join(', ') || '(only featured_images/curated_gallery images reference the book; left)'}`);
  return { slug: c.slug, before: Object.fromEntries(COLLECTION_FIELDS.filter((f) => f in c).map((f) => [f, c[f]])), after };
}).filter((p) => Object.keys(p.after).length);
// Slugs still carry the old identity. Old slug -> slug_aliases (findBookByIdOrSlug 301s an alias hit).
const slugPlan = [];
const taken = new Set();
for (const d of docs) {
  let base = generateBookSlug(d.title || '', d.author || '', d.display_title);
  if (!/[a-z]/.test(base) || base === 'untitled') { console.error(`!! unusable slug for ${d.id}: ${base}`); process.exit(1); }
  let cand = base, i = 2;
  const clash = async (c) => taken.has(c) || await books.countDocuments({ id: { $ne: d.id }, $or: [{ slug: c }, { slug_aliases: c }] });
  while (d.slug !== cand && await clash(cand)) cand = `${base}-${i++}`;
  taken.add(cand);
  if (d.slug !== cand) slugPlan.push({ id: d.id, old: d.slug, new: cand });
  console.log(`slug ${d.id.slice(-4)} ${d.slug === cand ? '(already)' : `${d.slug} -> ${cand}`}`);
}
console.log(`book_indexes with bookSummary: ${bi.length}; supabase rows: ${sbRows.length}`);
if (!APPLY) { console.log('\n-- dry run (add --apply) --'); await mc.close(); process.exit(0); }

// Backup first (repo-ignored dir + the private ops repo)
const backup = {
  run: RUN, at: now.toISOString(),
  books: plan.map(({ d, set, unset }) => ({ id: d.id, before: Object.fromEntries([...Object.keys(set), ...unset].map((f) => [f, get(d, f) === undefined ? '__ABSENT__' : get(d, f)]).map(([f, v]) => [f, v])) })),
  book_indexes: bi.map((x) => ({ book_id: x.book_id, bookSummary: x.bookSummary })),
  collections: colPlans.map(({ slug, before }) => ({ slug, before })),
  supabase: sbRows,
};
mkdirSync(dirname(BACKUP), { recursive: true });
if (!existsSync(BACKUP)) { writeFileSync(BACKUP, JSON.stringify(backup)); }
try { if (!existsSync(OPS_BACKUP)) writeFileSync(OPS_BACKUP, JSON.stringify(backup)); } catch (e) { console.log('ops backup skipped', e.message); }
console.log(`backup: ${BACKUP}`);

let n = 0;
for (const { d, set, unset, removedColl } of plan) {
  const u = Object.fromEntries(unset.map((f) => [f, '']));
  const r = await books.updateOne({ id: d.id }, { $set: { ...set, updated_at: now }, ...(unset.length ? { $unset: u } : {}) });
  n += r.modifiedCount;
  if (!await db.collection('field_provenance').findOne({ book_id: d.id, field: 'derived_metadata', run: RUN })) await db.collection('field_provenance').insertOne({
    book_id: d.id, field: 'derived_metadata', value: null, source: 'hand-adjudicated', run: RUN,
    evidence: { cleared: unset, retitled_from_audit: '#7060', rationale: 'derived fields described the pre-correction identity; cleared so the pipeline re-derives' },
    created_at: now.toISOString(),
  });
  await recordSweepAction(db, { sweep: RUN, book_id: d.id, action: 'derived-fields-cleared-after-retitle',
    detail: { unset, set_keys: Object.keys(set), collections_removed: removedColl, previous_work_id: d.work_id ?? null, previous_edition_key: d.edition_key ?? null, previous_first_translation_flag: d.is_first_translation ?? null } });
}
console.log(`books modified: ${n}/${plan.length}`);
let bn = 0;
for (const x of bi) bn += (await db.collection('book_indexes').updateOne({ book_id: x.book_id }, { $unset: { bookSummary: '' } })).modifiedCount;
console.log(`book_indexes modified: ${bn}`);
for (const { slug, after } of colPlans) {
  const r = await db.collection('collections').updateOne({ slug }, { $set: { ...after, updated_at: now } });
  await recordSweepAction(db, { sweep: RUN, book_id: PULL_IDS.join(','), action: 'collection-membership-pulled', detail: { collection: slug, fields: Object.keys(after) } });
  console.log(`collections/${slug} modified ${r.modifiedCount}`);
}
if (slugPlan.length) {
  if (!existsSync(SLUG_BACKUP)) writeFileSync(SLUG_BACKUP, JSON.stringify(slugPlan));
  try { const o = OPS_BACKUP.replace('.json', '-slugs.json'); if (!existsSync(o)) writeFileSync(o, JSON.stringify(slugPlan)); } catch {}
}
for (const x of slugPlan) {
  const r = await books.updateOne({ id: x.id, slug: x.old }, { $set: { slug: x.new, updated_at: now }, $addToSet: { slug_aliases: x.old } });
  await recordSweepAction(db, { sweep: RUN, book_id: x.id, action: 'slug-renamed-old-kept-as-alias', detail: x });
  console.log(`  slug ${x.id.slice(-4)} modified ${r.modifiedCount}`);
}
// Supabase mirror: identity from Mongo (now corrected), derived columns nulled; only columns the table has.
const fresh = await books.find({ id: { $in: IDS } }).toArray();
for (const d of fresh) {
  const row = sbRows.find((r) => r.id === d.id);
  if (!row) { console.log(`  supabase: no row for ${d.id}`); continue; }
  const patch = { slug: d.slug, title: d.title, display_title: d.display_title, author: d.author, language: d.language, updated_at: now.toISOString() };
  for (const c of SB_NULL) if (c in row) patch[c] = null;
  if ('is_first_translation' in row && row.is_first_translation === true) patch.is_first_translation = false;
  if ('collections' in row) patch.collections = d.collections || [];
  if ('categories' in row) patch.categories = d.categories || [];
  if ('collection_relevance' in row) patch.collection_relevance = null;
  let res = await sb(`id=eq.${d.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(patch) });
  if (!res.ok) { console.log(`  supabase ${d.id.slice(-4)} ${res.status} ${(await res.text()).slice(0, 160)}`); }
  else console.log(`  supabase ${d.id.slice(-4)} ${res.status}`);
}
await revalidate([...fresh, ...slugPlan.map((x) => ({ id: x.id, slug: x.old }))]);
await mc.close();
