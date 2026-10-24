#!/usr/bin/env node
/**
 * Two book records adjudicated BY HAND from their own scans (found while
 * bringing articles up to the article rules, 2026-10-18):
 *
 * 1. 69f1345d365e3fcae574e290 — 金剛般若波羅蜜經如義 (Bavarian State Library copy).
 *    Catalogued as Japanese, 2018. The colophon (scan p. 8) reads
 *    「乾隆五十二年歲次丁未重陽日 佛弟子倪珏敬刻流通 廣州海幢寺藏板」: cut in Qianlong 52
 *    (1787) and the blocks held at the Haizhuang temple, Guangzhou. The text is
 *    Classical Chinese throughout (no kana); the record's own `published` field
 *    already says "Qianlong 52 1787". `year` 2018 was a regex hit.
 *    Fix: language/languages Chinese, year 1787, and the derived claims that
 *    repeat Japan (tradition, locations, source_work_dates_meta.work.why).
 *
 * 2. 69a97a1bf3f3d2fb7de26ca4 — Walter Scott, Hermetica (ia:hermetica0003walt).
 *    Catalogued as vol. 1. The title page (scan p. 7) reads "VOLUME III. Notes on
 *    the Latin Asclepius and the Hermetic Excerpts of Stobaeus … Oxford at the
 *    Clarendon Press, 1926". Fix: title, display_title, english_title, and the
 *    served summaries (which describe vol. 1's texts and translation) replaced by
 *    a summary taken from the title page.
 *
 * Both: edition_key recomputed with the one builder (scripts/lib/identity-fields.mjs),
 * the Supabase books_catalog mirror patched, field_provenance + sweep_log rows,
 * the book page revalidated. Left alone on purpose: slugs (links), work_id
 * (work-identity.md), translation_verification and language_review_detail
 * (provenance of what was believed), ai_metadata.
 *
 * PRIOR ART: scripts/maintenance/repair-pharar-author-2026-09-24.mjs (same shape).
 *
 * Usage:
 *   node --env-file=.env.local scripts/maintenance/repair-catalogue-records-2026-10-18.mjs           # dry run
 *   node --env-file=.env.local scripts/maintenance/repair-catalogue-records-2026-10-18.mjs --apply
 *   node --env-file=.env.local scripts/maintenance/repair-catalogue-records-2026-10-18.mjs --revert --apply
 */
import { MongoClient } from 'mongodb';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { recordSweepAction } from '../lib/sweep-log.mjs';
import { computeIdentityFields } from '../lib/identity-fields.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const RUN = 'repair-catalogue-records-2026-10-18';
const BACKUP = join(HERE, 'backups', `${RUN}.json`);
const APPLY = process.argv.includes('--apply');
const REVERT = process.argv.includes('--revert');

const RUYI = '69f1345d365e3fcae574e290';
const SCOTT = '69a97a1bf3f3d2fb7de26ca4';

const RUYI_WHY =
  'colophon (scan p. 8) reads 乾隆五十二年歲次丁未重陽日 … 廣州海幢寺藏板: Qianlong 52 (1787), blocks held at the Haizhuang temple, Guangzhou; the text is Classical Chinese, no kana';
const SCOTT_WHY =
  'title page (scan p. 7) reads "VOLUME III. Notes on the Latin Asclepius and the Hermetic Excerpts of Stobaeus", Oxford, Clarendon Press, 1926 (ia:hermetica0003walt)';
const SCOTT_SUMMARY =
  'Volume III of Walter Scott’s edition of the Hermetica (Oxford: Clarendon Press, 1926): his notes on the Latin Asclepius and on the Hermetic excerpts preserved by Stobaeus.';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SB = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' };
const sbGet = async (id) => (await (await fetch(`${SUPABASE_URL}/rest/v1/books_catalog?id=eq.${id}&select=*`, { headers: SB })).json())?.[0] || null;
const sbPatch = async (id, patch) => {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/books_catalog?id=eq.${id}`, { method: 'PATCH', headers: { ...SB, Prefer: 'return=minimal' }, body: JSON.stringify(patch) });
  return res.status;
};

const get = (o, p) => p.split('.').reduce((a, k) => a?.[k], o);
const show = (v) => (typeof v === 'string' ? v : JSON.stringify(v));

/** The $set for each book, built from the live document. */
function ruyiChanges(doc) {
  const set = { language: 'Chinese', languages: ['Chinese'], year: 1787, year_source: 'hand-adjudicated' };
  if (Array.isArray(doc.tradition)) set.tradition = doc.tradition.map((t) => (t === 'Japanese' ? 'Chinese' : t));
  (doc.locations || []).forEach((l, i) => {
    if (l?.country === 'Japan') {
      set[`locations.${i}.country`] = 'China';
      if ('city' in l || 'place' in l) set[`locations.${i}.${'city' in l ? 'city' : 'place'}`] = 'Guangzhou';
    }
  });
  const why = get(doc, 'source_work_dates_meta.work.why');
  if (typeof why === 'string' && /in Japan/.test(why)) set['source_work_dates_meta.work.why'] = why.replace(/printed 1787 in Japan/, 'printed 1787 at the Haizhuang temple, Guangzhou').replace(/in Japan/g, 'in Guangzhou');
  const fpl = get(doc, 'field_provenance.language');
  if (fpl && typeof fpl === 'object') {
    set['field_provenance.language'] = {
      ...fpl,
      value: 'Chinese',
      why: RUYI_WHY,
      source: 'hand-adjudicated',
      claims: [...(fpl.claims || []), { value: 'Chinese', source: 'hand-adjudicated', run: RUN, why: RUYI_WHY, at: new Date().toISOString() }],
    };
  }
  return set;
}

function scottChanges(doc) {
  const set = {
    title: 'Hermetica, vol. 3',
    display_title: 'The Hermetic Writings, Volume 3',
    english_title: 'The Hermetic Writings, Volume 3',
  };
  if (doc.summary && typeof doc.summary === 'object') set['summary.data'] = SCOTT_SUMMARY;
  else if (typeof doc.summary === 'string') set.summary = SCOTT_SUMMARY;
  for (const f of ['summary_candidate.brief', 'summary_candidate.abstract', 'reading_summary.overview', 'index.bookSummary.brief', 'index.bookSummary.abstract']) {
    if (typeof get(doc, f) === 'string') set[f] = SCOTT_SUMMARY;
  }
  for (const f of ['reading_summary.detailed', 'index.bookSummary.detailed', 'summary_candidate.detailed']) {
    if (typeof get(doc, f) === 'string') set[f] = SCOTT_SUMMARY;
  }
  return set;
}

const mc = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
await mc.connect();
const db = mc.db(process.env.MONGODB_DB || 'bookstore');
const books = db.collection('books');
const indexes = db.collection('book_indexes');

if (REVERT) {
  if (!existsSync(BACKUP)) { console.error('no backup'); process.exit(1); }
  const backup = JSON.parse(readFileSync(BACKUP, 'utf8'));
  for (const b of backup.books) {
    console.log(`revert ${b.id}: ${Object.keys(b.before).join(', ')}`);
    if (!APPLY) continue;
    const set = {}; const unset = {};
    for (const [k, v] of Object.entries(b.before)) (v === undefined || v === null ? (unset[k] = '') : (set[k] = v));
    await books.updateOne({ id: b.id }, { $set: { ...set, updated_at: new Date() }, ...(Object.keys(unset).length ? { $unset: unset } : {}) });
    if (b.index_before) await indexes.updateOne({ book_id: b.id }, { $set: b.index_before });
    if (b.supabase_before) console.log(`  supabase ${await sbPatch(b.id, b.supabase_before)}`);
  }
  if (!APPLY) console.log('-- dry run (add --apply) --');
  await mc.close(); process.exit(0);
}

const backup = { run: RUN, at: new Date().toISOString(), books: [] };
for (const [id, build, why] of [[RUYI, ruyiChanges, RUYI_WHY], [SCOTT, scottChanges, SCOTT_WHY]]) {
  const doc = await books.findOne({ id });
  if (!doc) { console.error(`!! ${id} not found`); process.exit(1); }
  const set = build(doc);
  const identity = computeIdentityFields({ ...doc, ...Object.fromEntries(Object.entries(set).filter(([k]) => !k.includes('.'))) });
  for (const k of ['edition_key', 'edition_key_quality', 'normalized_title']) if (identity[k] !== doc[k]) set[k] = identity[k];

  console.log(`\n== ${id}  ${doc.display_title}`);
  const before = {};
  for (const [k, v] of Object.entries(set)) {
    before[k] = get(doc, k) ?? null;
    console.log(`  ${k}\n     was: ${show(before[k]).slice(0, 220)}\n     now: ${show(v).slice(0, 220)}`);
  }

  // book_indexes is merged over books.index on read: mirror the summary there.
  const idx = await indexes.findOne({ book_id: id });
  const idxSet = {}; let indexBefore = null;
  if (id === SCOTT && idx) {
    indexBefore = {};
    for (const f of ['bookSummary.brief', 'bookSummary.abstract', 'bookSummary.detailed']) {
      if (typeof get(idx, f) === 'string') { idxSet[f] = SCOTT_SUMMARY; indexBefore[f] = get(idx, f); }
    }
  }
  if (id === RUYI && idx) {
    indexBefore = {};
    (function walk(o, p) {
      if (typeof o === 'string') { if (/Japan/.test(o)) { idxSet[p] = o.replace(/Japanese/g, 'Chinese').replace(/Japan/g, 'China'); indexBefore[p] = o; } return; }
      if (o && typeof o === 'object' && !(o instanceof Date) && !o._bsontype) for (const [k, v] of Object.entries(o)) walk(v, p ? `${p}.${k}` : k);
    })({ ...idx, _id: undefined }, '');
  }
  for (const [k, v] of Object.entries(idxSet)) console.log(`  book_indexes.${k}\n     was: ${show(indexBefore[k]).slice(0, 220)}\n     now: ${show(v).slice(0, 220)}`);

  const row = SUPABASE_URL && SUPABASE_KEY ? await sbGet(id) : null;
  const sbSet = {}; const sbBefore = {};
  if (row) {
    const want = id === RUYI
      ? { language: 'Chinese', year: 1787 }
      : { title: set.title, display_title: set.display_title, english_title: set.english_title, summary_text: SCOTT_SUMMARY };
    for (const [k, v] of Object.entries(want)) if (k in row && row[k] !== v) { sbSet[k] = v; sbBefore[k] = row[k]; }
  }
  console.log(`  supabase books_catalog: ${row ? (Object.keys(sbSet).length ? Object.entries(sbSet).map(([k, v]) => `${k}: ${show(sbBefore[k]).slice(0, 80)} -> ${show(v).slice(0, 80)}`).join('; ') : '(already right)') : '(no row or no creds)'}`);

  backup.books.push({ id, before, index_before: indexBefore && Object.keys(indexBefore).length ? indexBefore : null, supabase_before: Object.keys(sbBefore).length ? sbBefore : null });
  if (!APPLY) continue;

  const r = await books.updateOne({ id }, { $set: { ...set, updated_at: new Date() } });
  console.log(`  books modified: ${r.modifiedCount}`);
  if (Object.keys(idxSet).length) console.log(`  book_indexes modified: ${(await indexes.updateOne({ book_id: id }, { $set: idxSet })).modifiedCount}`);
  if (Object.keys(sbSet).length) console.log(`  supabase: ${await sbPatch(id, { ...sbSet, updated_at: new Date().toISOString() })}`);
  for (const field of Object.keys(set).filter((k) => ['language', 'year', 'title', 'display_title'].includes(k))) {
    await db.collection('field_provenance').insertOne({
      book_id: id, field, value: set[field], previous_value: before[field], source: 'hand-adjudicated', run: RUN,
      evidence: { rationale: why, adjudicated_by: 'read off the scan by eye, no model verdict used' }, created_at: new Date().toISOString(),
    });
  }
  await recordSweepAction(db, { sweep: RUN, book_id: id, action: 'catalogue-record-repaired-by-hand', detail: { fields: Object.keys(set), why } });
  const rv = await fetch(`https://sourcelibrary.org/api/admin/revalidate-book/${id}`, { method: 'POST', headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } });
  console.log(`  provenance + sweep_log written; revalidate ${rv.status}`);
}

if (APPLY) {
  mkdirSync(dirname(BACKUP), { recursive: true });
  if (!existsSync(BACKUP)) writeFileSync(BACKUP, JSON.stringify(backup, null, 1));
  console.log(`\nbackup: ${BACKUP}`);
} else {
  console.log('\n-- dry run (add --apply) --');
}
await mc.close();
