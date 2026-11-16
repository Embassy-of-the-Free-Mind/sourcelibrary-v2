#!/usr/bin/env node
/**
 * Finish a byline correction: the derived fields it left behind (#3894).
 *
 * `apply-byline-proposals-3894.mjs` (2026-10-19) rewrote `author` / `author_id`
 * on 116 books from the Aldine printer to the real author. Three things derive
 * from those fields and none of them was recomputed:
 *
 *   1. IDENTITY KEYS. `normalized_author` and `edition_key` still carry the
 *      printer ("…|manuzio|1563|v") on every one of them (116 drift, 110 with
 *      the printer in the edition_key author slot, measured 2026-11-12). The
 *      identity worker only stamps ABSENT fields, so this never self-heals, and
 *      dedup tier 2 / the other-scans rail key on the printer's surname.
 *   2. A STALE ENTITY LINK. The apply cleared `author_id` but left
 *      `author_entity_id`; the next night's backfill (entity-id phase) re-linked
 *      the book to the printer at confidence "high" (Streinnius → Henri
 *      Estienne, 2026-10-20). The backfill now refuses that (same PR); this
 *      clears the link it already wrote.
 *   3. WORK IDS. Re-minted by the nightly `mint-local-work-ids --remint-local`
 *      (80 moves, aliases kept) — nothing to write here; residuals are REPORTED.
 *
 * Writes (only with --apply), per book, guarded on the values just read:
 *   books.normalized_title / normalized_author / edition_key / edition_key_quality
 *        ← computeIdentityFields() — the identity worker's own writer, never a copy
 *   books.author_entity_id ($unset) when its owner doc is contradicted by the byline
 *   books.author_id ($unset) when it was set FROM that entity (provenance says so)
 *   sweep_log  one row per book, `detail.before` holding every field it changes,
 *              written BEFORE the book, so --revert needs no backup file.
 * Reports, never writes: new edition_key collisions (review candidates — a
 * shared key is a claim, edition-identity.md), work_ids still keyed on a printer.
 *
 * PRIOR ART: scripts/workers/identity-worker.mjs --restamp — same writer, but
 * corpus-wide (14,721 edition_key drifts outside this cohort belong to #4444's
 * normalizer changes and want their own replay), no per-row diff, no revert,
 * and its --dry-run still inserts a cron_runs row. scripts/maintenance/
 * materialize-edition-keys.ts --book-id — one book, edition_key only (not
 * normalized_author). repair-xiuruji-identity-5620.mjs — one hand-adjudicated
 * book; the sweep_log-as-backup pattern is taken from it.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/maintenance/repair-byline-followups-3894.mjs                  # dry run
 *   node --env-file=.env.production.local scripts/maintenance/repair-byline-followups-3894.mjs --diff=/path.jsonl
 *   node --env-file=.env.production.local scripts/maintenance/repair-byline-followups-3894.mjs --apply
 *   node --env-file=.env.production.local scripts/maintenance/repair-byline-followups-3894.mjs --revert --apply
 *   --sweep=<name>   the byline sweep whose books to finish (default byline-proposals-3894)
 */
import { MongoClient, ObjectId } from 'mongodb';
import fs from 'node:fs';
import { computeIdentityFields } from '../lib/identity-fields.mjs';
import { bylineVsNameForms } from '../lib/name-equivalence.mjs';
import { recordSweepActions } from '../lib/sweep-log.mjs';

const RUN = 'repair-byline-followups-3894';
const APPLY = process.argv.includes('--apply');
const REVERT = process.argv.includes('--revert');
const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=');
const SOURCE_SWEEP = arg('sweep') || 'byline-proposals-3894';
const DIFF = arg('diff');
const IDENTITY = ['normalized_title', 'normalized_author', 'edition_key', 'edition_key_quality'];
const LINK = ['author_entity_id', 'author_id'];

const mc = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
await mc.connect();
const db = mc.db('bookstore');
const books = db.collection('books');

if (REVERT) {
  const logs = await db.collection('sweep_log').find({ sweep: RUN, action: 'byline-followups-repaired' }).sort({ _id: 1 }).toArray();
  const first = new Map();
  for (const l of logs) if (!first.has(l.book_id)) first.set(l.book_id, l.detail.before);
  console.log(`revert: ${first.size} books have a ${RUN} row`);
  let done = 0;
  for (const [id, before] of first) {
    const set = {}, unset = {};
    // A null identity field is a real value ("computed, unkeyable"); only the link fields were absent.
    for (const [f, v] of Object.entries(before)) ((v === null || v === undefined) && LINK.includes(f) ? (unset[f] = '') : (set[f] = v ?? null));
    if (!APPLY) continue;
    const r = await books.updateOne({ id }, { ...(Object.keys(set).length ? { $set: set } : {}), ...(Object.keys(unset).length ? { $unset: unset } : {}) });
    done += r.modifiedCount;
  }
  console.log(APPLY ? `reverted ${done}` : '(dry run — add --apply)');
  await mc.close(); process.exit(0);
}

const src = await db.collection('sweep_log').find({ sweep: SOURCE_SWEEP }, { projection: { book_id: 1 } }).toArray();
const ids = [...new Set(src.map((r) => r.book_id))];
if (!ids.length) { console.error(`no sweep_log rows for ${SOURCE_SWEEP}`); process.exit(1); }
const cohort = await books.find({ id: { $in: ids } }, { projection: {
  _id: 1, id: 1, title: 1, display_title: 1, author: 1, year: 1, published: 1, visible: 1, content_type: 1,
  author_id: 1, author_entity_id: 1, author_link_provenance: 1, work_id: 1, work_id_source: 1, ...Object.fromEntries(IDENTITY.map((f) => [f, 1])),
} }).toArray();

// entity id -> owner docs (live, not tombstoned), for the stale-link check
const entIds = [...new Set(cohort.map((b) => b.author_entity_id).filter(Boolean).map(String))];
const owners = new Map();
// entity_ids are stored as strings on some docs and ObjectIds on others: match both.
const entIdForms = [...entIds, ...entIds.filter((s) => ObjectId.isValid(s)).map((s) => new ObjectId(s))];
for (const a of await db.collection('authors').find({ entity_ids: { $in: entIdForms }, merged_into: { $exists: false } },
  { projection: { slug: 1, canonical_name: 1, variants: 1, aliases: 1, entity_ids: 1 } }).toArray()) {
  for (const e of a.entity_ids || []) { const k = String(e); if (entIds.includes(k)) { if (!owners.has(k)) owners.set(k, []); owners.get(k).push(a); } }
}

const plans = [];
const tally = { cohort: cohort.length, identity: 0, edition_key: 0, stale_entity: 0, author_id_cleared: 0, unchanged: 0 };
for (const b of cohort) {
  const before = {}, after = {};
  if (b.content_type !== 'artwork') {
    const f = computeIdentityFields(b);
    for (const k of IDENTITY) if ((b[k] ?? null) !== (f[k] ?? null)) { before[k] = b[k] ?? null; after[k] = f[k] ?? null; }
    if ('edition_key' in after) tally.edition_key++;
    if (Object.keys(after).length) tally.identity++;
  }
  const ent = b.author_entity_id ? String(b.author_entity_id) : null;
  const os = ent ? owners.get(ent) || [] : [];
  // Only a SINGLE owner can be contradicted; >1 owner is the backfill's ambiguous case and it already skips.
  if (os.length === 1 && bylineVsNameForms(b.author, [os[0].canonical_name, ...(os[0].variants || []), ...(os[0].aliases || [])]) === 'different') {
    before.author_entity_id = b.author_entity_id; after.author_entity_id = null; tally.stale_entity++;
    const last = (b.author_link_provenance || []).at(-1);
    if (b.author_id && b.author_id === os[0].slug && last?.method === 'entity-id-link' && String(last.matched) === ent) {
      before.author_id = b.author_id; after.author_id = null; tally.author_id_cleared++;
    }
  }
  if (!Object.keys(after).length) { tally.unchanged++; continue; }
  plans.push({ b, before, after });
}

// Report: keys this run would make shared with OTHER books (review candidates, never merges).
const newKeys = [...new Set(plans.map((p) => p.after.edition_key).filter(Boolean))];
const collide = await books.aggregate([
  { $match: { edition_key: { $in: newKeys } } },
  { $group: { _id: '$edition_key', ids: { $push: '$id' }, visible: { $sum: { $cond: ['$visible', 1, 0] } } } },
]).toArray();
const printerRx = /:(a|n):(?:[^:]*-)?(manuzio|manutius|manuzi|torresano|torresanus|turrisanus|aldo|aldi|aldina|aldus|estienne|stephanus)(?:-[^:]*)?:/i;
const residualWork = cohort.filter((b) => printerRx.test(b.work_id || '')).map((b) => ({ id: b.id, work_id: b.work_id, source: b.work_id_source }));

const diffRows = [];
for (const p of plans) for (const k of Object.keys(p.after)) diffRows.push({ id: p.b.id, visible: !!p.b.visible, author: p.b.author, field: k, before: p.before[k], after: p.after[k] });
if (DIFF) fs.writeFileSync(DIFF, diffRows.map((r) => JSON.stringify(r)).join('\n') + '\n');

console.log(`=== ${RUN} — source sweep ${SOURCE_SWEEP} — ${APPLY ? 'APPLY' : 'DRY RUN'} ===`);
console.log(tally);
console.log(`field changes: ${diffRows.length} across ${plans.length} books${DIFF ? ` -> ${DIFF}` : ''}`);
for (const r of diffRows.slice(0, 12)) console.log(`  ${r.id} ${r.field}: ${JSON.stringify(r.before)} -> ${JSON.stringify(r.after)}`);
console.log(`new edition_key collisions with books outside this run (review queue, not merged): ${collide.filter((c) => c.ids.length > 1).length}`);
for (const c of collide.filter((c) => c.ids.length > 1).slice(0, 10)) console.log(`  ${c._id}  ids=${c.ids.join(',')}`);
console.log(`work_ids still keyed on a printer (report only — merge-cluster ids or unmintable titles): ${residualWork.length}`);
for (const r of residualWork) console.log(`  ${r.id} [${r.source}] ${r.work_id}`);

if (APPLY && plans.length) {
  // sweep_log first: the before-snapshot is the revert path.
  await recordSweepActions(db, plans.map((p) => ({ sweep: RUN, book_id: p.b.id, action: 'byline-followups-repaired',
    detail: { source_sweep: SOURCE_SWEEP, before: p.before, after: p.after } })));
  let done = 0, raced = 0;
  for (const p of plans) {
    // Guard: every field we change must still hold the value we read.
    const filter = { _id: p.b._id };
    for (const k of Object.keys(p.before)) filter[k] = p.before[k] === null ? null : p.before[k];
    const set = {}, unset = {};
    for (const [k, v] of Object.entries(p.after)) (v === null && LINK.includes(k) ? (unset[k] = '') : (set[k] = v));
    const r = await books.updateOne(filter, { $set: { ...set, updated_at: new Date() }, ...(Object.keys(unset).length ? { $unset: unset } : {}) });
    r.modifiedCount ? done++ : raced++;
  }
  console.log(`applied ${done}, skipped ${raced} (changed since read). Then: node scripts/workers/sync-books-catalog.mjs`);
}
await mc.close();
