#!/usr/bin/env node
/**
 * Repair the `prompts` collection's provenance invariants (#3614).
 *
 * WHY THIS EXISTS. Every OCR/translation/summary/modernization call resolves its
 * prompt with `findOne({ type, is_default: true })` — 17 call sites across
 * `src/lib/prompts.ts`, the workers, and the batch scripts, most of them with no
 * sort at all. That query is only well-defined if EXACTLY ONE row per type
 * carries the flag. On 2026-09-02 `summary` had two, one of them with no
 * `version` field, so which prompt produced a summary was decided by natural
 * order — and the unversioned row stamps `prompt_version: undefined` onto the
 * page, breaking the chain `.claude/docs/data-provenance.md` exists to
 * guarantee.
 *
 * FOUR REPAIRS, each independently reported and skippable:
 *
 *   1. is_default  — keep exactly one per `type`. The keeper is the highest
 *      normalised version, tie-broken by newest `created_at`. Losers are $set to
 *      false (never deleted — prompts are immutable audit rows).
 *   2. version     — normalise to a NUMBER. `'v1'` → `1`; a missing field → `0`
 *      (these are pre-versioning rows from 2025-12 and sort oldest either way,
 *      so 0 preserves the existing order while making every comparison typed).
 *      Mixed string/number made `sort({version:-1})` follow BSON type order
 *      rather than intent, and printed defaults as `vundefined` and `vv1`.
 *   3. name        — two rows have no `name` at all, one of them the LIVE
 *      image_extraction default, so its output records `prompt_name: undefined`.
 *      Backfilled from the type's canonical name only when that name is
 *      unambiguous for the type; otherwise reported and left alone.
 *   4. content_hash — recomputed (md5 of content, same as `promptContentHash`)
 *      where missing. The hash is the cryptographic verifier that ties stored
 *      text back to the prompt that made it.
 *
 * THEN THE ACTUAL GUARD. With duplicates gone, `--apply` creates a UNIQUE
 * PARTIAL INDEX on `{ type: 1 }` where `is_default: true`. From then on a writer
 * that inserts a second default fails loudly with E11000 instead of silently
 * forking provenance. Every existing writer already unsets the old default
 * BEFORE inserting the new one, so none of them are broken by this. The index
 * build will REFUSE if duplicates remain — that is the verification step, not a
 * failure to work around.
 *
 * THIS ACTUATES THE PIPELINE. The `prompts` collection is read by the
 * translate/OCR workers on every job. Read the dry run before applying and
 * confirm the keeper is the prompt you want live.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/maintenance/repair-prompt-defaults-3614.mjs           # dry run
 *   node --env-file=.env.production.local scripts/maintenance/repair-prompt-defaults-3614.mjs --apply   # write
 *   ... --apply --skip-index      # repair rows but do not create the unique index
 */
import { MongoClient } from 'mongodb';
import { createHash } from 'crypto';

const APPLY = process.argv.includes('--apply');
const SKIP_INDEX = process.argv.includes('--skip-index');

const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI not set'); process.exit(1); }

/**
 * The one canonical prompt name per type, used ONLY to backfill a missing
 * `name`. A type absent from this map, or one whose rows disagree with it, is
 * reported rather than guessed.
 */
const CANONICAL_NAME_BY_TYPE = {
  ocr: 'Standard OCR',
  translation: 'Standard Translation',
  summary: 'Standard Summary',
  image_extraction: 'Image Extraction',
  english_modernization: 'English Modernization',
};

/** `'v12'` → 12, `12` → 12, missing → 0. Anything else → null (report, don't guess). */
function normalizeVersion(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (v === undefined || v === null) return 0;
  if (typeof v === 'string') {
    const m = /^v?(\d+)$/i.exec(v.trim());
    if (m) return Number(m[1]);
  }
  return null;
}

const client = new MongoClient(uri);
await client.connect();
const db = client.db(process.env.MONGODB_DB || 'bookstore');
const prompts = db.collection('prompts');

const rows = await prompts.find({}).toArray();
console.log(`\n${rows.length} prompt rows${APPLY ? '' : '  (DRY RUN — no writes)'}\n`);

const writes = [];   // { _id, set: {...}, why }
let unparseable = 0;

// --- 2. version typing (computed first: repairs 1 and 3 both depend on it) ---
const versionOf = new Map();
for (const p of rows) {
  const norm = normalizeVersion(p.version);
  if (norm === null) {
    console.log(`✗ version unparseable, left alone: ${p._id} ${p.type}/${p.name} version=${JSON.stringify(p.version)}`);
    unparseable++;
    versionOf.set(String(p._id), -1);
    continue;
  }
  versionOf.set(String(p._id), norm);
  if (p.version !== norm) {
    writes.push({ _id: p._id, set: { version: norm },
      why: `version ${JSON.stringify(p.version)} (${typeof p.version}) → ${norm}` });
  }
}

// --- 1. exactly one is_default per type ---
const byType = new Map();
for (const p of rows) {
  if (p.is_default !== true) continue;
  if (!byType.has(p.type)) byType.set(p.type, []);
  byType.get(p.type).push(p);
}
for (const [type, defaults] of byType) {
  if (defaults.length === 1) {
    const [p] = defaults;
    console.log(`✓ ${type}: one default — "${p.name}" v${versionOf.get(String(p._id))} (${p._id})`);
    continue;
  }
  // Keeper: highest normalised version, tie-broken by newest created_at.
  const sorted = [...defaults].sort((a, b) => {
    const dv = versionOf.get(String(b._id)) - versionOf.get(String(a._id));
    if (dv !== 0) return dv;
    return new Date(b.created_at || 0) - new Date(a.created_at || 0);
  });
  const [keeper, ...losers] = sorted;
  console.log(`✗ ${type}: ${defaults.length} rows with is_default:true`);
  console.log(`    KEEP  "${keeper.name}" v${versionOf.get(String(keeper._id))} (${keeper._id}) created ${keeper.created_at?.toISOString?.().slice(0, 10)}`);
  for (const l of losers) {
    console.log(`    UNSET "${l.name}" v${versionOf.get(String(l._id))} (${l._id}) created ${l.created_at?.toISOString?.().slice(0, 10)}`);
    writes.push({ _id: l._id, set: { is_default: false },
      why: `${type}: demoted duplicate default "${l.name}"` });
  }
}
for (const type of Object.keys(CANONICAL_NAME_BY_TYPE)) {
  const present = rows.some(p => p.type === type);
  if (present && !byType.has(type)) console.log(`✗ ${type}: NO default at all — every lookup for this type falls back to the hardcoded prompt`);
}

// --- 3. missing name ---
for (const p of rows) {
  if (typeof p.name === 'string' && p.name.trim()) continue;
  const canonical = CANONICAL_NAME_BY_TYPE[p.type];
  if (!canonical) { console.log(`✗ nameless row ${p._id} type=${p.type} — no canonical name for this type, left alone`); continue; }
  console.log(`✗ nameless row ${p._id} type=${p.type} v${versionOf.get(String(p._id))} → "${canonical}"${p.is_default ? '  (this is the LIVE default — its output records prompt_name: undefined)' : ''}`);
  writes.push({ _id: p._id, set: { name: canonical }, why: `name backfilled → "${canonical}"` });
}

// --- 4. missing content_hash ---
for (const p of rows) {
  if (typeof p.content_hash === 'string' && p.content_hash) continue;
  if (typeof p.content !== 'string' || !p.content) { console.log(`✗ ${p._id} ${p.type}/${p.name} has no content — cannot hash, left alone`); continue; }
  const hash = createHash('md5').update(p.content).digest('hex');
  console.log(`✗ ${p._id} ${p.type}/${p.name} v${versionOf.get(String(p._id))} missing content_hash → ${hash}`);
  writes.push({ _id: p._id, set: { content_hash: hash }, why: 'content_hash recomputed' });
}

// --- report + write ---
const merged = new Map();
for (const w of writes) {
  const k = String(w._id);
  if (!merged.has(k)) merged.set(k, { _id: w._id, set: {}, why: [] });
  Object.assign(merged.get(k).set, w.set);
  merged.get(k).why.push(w.why);
}

console.log(`\n${merged.size} rows to update, ${writes.length} field changes` + (unparseable ? `, ${unparseable} unparseable versions skipped` : ''));

if (!APPLY) {
  console.log('\nDry run. Re-run with --apply to write.\n');
} else if (merged.size) {
  const ops = [...merged.values()].map(m => ({ updateOne: { filter: { _id: m._id }, update: { $set: m.set } } }));
  const res = await prompts.bulkWrite(ops, { ordered: false });
  console.log(`\napplied: ${res.modifiedCount} rows modified`);
}

// --- the guard: unique partial index on the default flag ---
const INDEX_NAME = 'uniq_default_per_type';
if (APPLY && !SKIP_INDEX) {
  const existing = await prompts.indexes();
  if (existing.some(i => i.name === INDEX_NAME)) {
    console.log(`index ${INDEX_NAME} already present`);
  } else {
    try {
      await prompts.createIndex({ type: 1 }, {
        name: INDEX_NAME,
        unique: true,
        partialFilterExpression: { is_default: true },
      });
      console.log(`index ${INDEX_NAME} created — a second is_default:true for a type now fails with E11000`);
    } catch (e) {
      console.error(`\nINDEX BUILD FAILED — duplicates remain. Do not work around this; fix the data.\n${e.message}`);
      process.exitCode = 1;
    }
  }
}

// --- verify ---
const after = await prompts.aggregate([
  { $match: { is_default: true } },
  { $group: { _id: '$type', n: { $sum: 1 }, names: { $push: '$name' } } },
  { $sort: { _id: 1 } },
]).toArray();
console.log('\ndefaults per type' + (APPLY ? '' : ' (unchanged — dry run)') + ':');
for (const t of after) console.log(`  ${t.n === 1 ? '✓' : '✗'} ${t._id}: ${t.n}  ${t.names.join(', ')}`);
if (after.some(t => t.n !== 1)) process.exitCode = 1;

await client.close();
