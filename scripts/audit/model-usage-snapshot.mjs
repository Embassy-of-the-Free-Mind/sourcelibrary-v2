#!/usr/bin/env node
/**
 * PRIOR ART: scripts/audit/paid-vs-got.mjs — pages written per DAY from page provenance, for
 * spend; it never totals what the corpus carries now. scripts/eval/quality-dashboard/build.mjs —
 * the ops_reports snapshot pattern copied here (one fixed _id, read by a page). /about/processing
 * — counts pages from books.pages_ocr, which carries no engine. scripts/audit/ocr-loop-corpus.mjs
 * — the checkpointed walk shape. None of them says which engine wrote the text a reader sees.
 *
 * model-usage-snapshot — which engine wrote the text every page carries today (#5601).
 *
 * Walks `pages` by _id in chunks (string ids first, then ObjectIds — BSON type bracketing keeps
 * the two ranges apart), grouping server-side on the stored provenance:
 *   ocr.model × ocr.source           pages, pages with text, pages written in the last 30 days, books
 *   translation.model × .source      the same, for the English translation
 *   translations.es.model            Spanish translations
 * plus gallery_images by model (small collection, one aggregate) and the Supabase search-index
 * tables (planner estimates — an exact count over 5M rows takes minutes).
 *
 * Counts are CURRENT STATE: the engine whose text the page carries now, not every engine that
 * ever ran on it. A page re-read by a specialist counts once, under the specialist.
 *
 * Each row is also assigned to its entry on the page by engineFor() (src/data/public-models.ts)
 * and merged into `engines` — pages with text, and books counted once across rows.
 *
 * Writes ONE ops_reports document, _id 'model-usage', read by /about/models
 * (src/lib/model-usage-report.ts). Never writes pages. No model call.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/audit/model-usage-snapshot.mjs            # dry run, prints
 *   node --env-file=.env.production.local scripts/audit/model-usage-snapshot.mjs --apply    # + ops_reports
 *   … --write-recent   also rewrite src/data/model-usage-recent.json (the test fixture: every
 *                      engine that wrote pages in the last 30 days must have an entry on the page)
 *   … --fresh          ignore the checkpoint and start the walk again
 *   … --chunk=N        pages per server-side aggregate (default 100000, ~5 s each)
 *
 * Exit 0 = ran; 3 = ran, but an engine wrote pages in the last 30 days that the page does not
 * describe (add it to src/data/public-models.ts); 2 = could not measure.
 */
import { MongoClient, ObjectId } from 'mongodb';
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// The page's own matcher (node strips the types), so a count lands on the entry a reader sees.
const { engineFor } = await import(path.join(ROOT, 'src/data/public-models.ts'));
const arg = (n, d) => {
  const hit = process.argv.find(a => a.startsWith(`--${n}=`));
  return hit ? hit.split('=').slice(1).join('=') : d;
};
const flag = n => process.argv.includes(`--${n}`);

const APPLY = flag('apply');
const CHUNK = Number(arg('chunk', '100000'));
const CHECKPOINT = path.join(ROOT, arg('checkpoint', 'scripts/output/model-usage.checkpoint.json'));
const RECENT_FILE = path.join(ROOT, 'src/data/model-usage-recent.json');
const REPORT_ID = 'model-usage';
const RECENT_DAYS = 30;

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || 'bookstore';
if (!uri) { console.error('MONGODB_URI missing'); process.exit(2); }

const client = new MongoClient(uri, { readPreference: 'secondaryPreferred' });
await client.connect();
const db = client.db(dbName);
const pages = db.collection('pages');

// ── checkpoint ────────────────────────────────────────────────────────────────
const cutoff = new Date(Date.now() - RECENT_DAYS * 864e5);
let state = null;
if (!flag('fresh') && fs.existsSync(CHECKPOINT)) {
  state = JSON.parse(fs.readFileSync(CHECKPOINT, 'utf8'));
  // A checkpoint older than a day would mix two different "last 30 days" windows.
  if (Date.now() - Date.parse(state.started_at) > 864e5) state = null;
  else console.log(`resuming walk from ${state.phase} ${state.last} (${state.seen.toLocaleString()} pages seen)`);
}
if (!state) state = { started_at: new Date().toISOString(), cutoff: cutoff.toISOString(), phase: 'string', last: null, seen: 0, rows: {} };
const CUT = new Date(state.cutoff);

function save() {
  fs.mkdirSync(path.dirname(CHECKPOINT), { recursive: true });
  fs.writeFileSync(CHECKPOINT, JSON.stringify(state));
}

// rows keyed `${lane}\u0001${model}\u0001${source}` → { pages, with_text, recent, books: [ids] }
function add(lane, model, source, g) {
  const key = `${lane}\u0001${model ?? ''}\u0001${source ?? ''}`;
  const r = (state.rows[key] ||= { lane, model: model ?? null, source: source ?? null, pages: 0, with_text: 0, recent: 0, books: [] });
  r.pages += g.n;
  r.with_text += g.text;
  r.recent += g.recent;
  if (g.books) {
    const s = new Set(r.books);
    for (const b of g.books) s.add(String(b));
    r.books = [...s];
  }
}

// updated_at is a Date on most rows and an ISO string on some; BSON order puts every string
// below every Date, so each type is compared against its own form of the cutoff.
const isRecent = f => ({ $cond: [{ $or: [
  { $and: [{ $eq: [{ $type: f }, 'date'] }, { $gte: [f, CUT] }] },
  { $and: [{ $eq: [{ $type: f }, 'string'] }, { $gte: [f, CUT.toISOString()] }] },
] }, 1, 0] });
const hasText = f => ({ $cond: [{ $and: [{ $eq: [{ $type: f }, 'string'] }, { $gt: [f, ''] }] }, 1, 0] });

async function chunk(match) {
  return pages.aggregate([
    { $match: match },
    { $sort: { _id: 1 } },
    { $limit: CHUNK },
    {
      $facet: {
        last: [{ $group: { _id: null, last: { $max: '$_id' }, n: { $sum: 1 } } }],
        ocr: [{ $group: { _id: { m: '$ocr.model', s: '$ocr.source' }, n: { $sum: 1 }, text: { $sum: hasText('$ocr.data') }, recent: { $sum: isRecent('$ocr.updated_at') }, books: { $addToSet: '$book_id' } } }],
        tr: [{ $match: { 'translation.data': { $exists: true } } }, { $group: { _id: { m: '$translation.model', s: '$translation.source' }, n: { $sum: 1 }, text: { $sum: hasText('$translation.data') }, recent: { $sum: isRecent('$translation.updated_at') }, books: { $addToSet: '$book_id' } } }],
        es: [{ $match: { 'translations.es': { $exists: true } } }, { $group: { _id: { m: '$translations.es.model' }, n: { $sum: 1 }, text: { $sum: 1 }, recent: { $sum: isRecent('$translations.es.updated_at') }, books: { $addToSet: '$book_id' } } }],
      },
    },
  ], { allowDiskUse: true, maxTimeMS: 600000 }).toArray();
}

// ── walk ──────────────────────────────────────────────────────────────────────
const t0 = Date.now();
for (const phase of ['string', 'objectId']) {
  if (state.phase === 'objectId' && phase === 'string') continue;
  state.phase = phase;
  for (;;) {
    const last = state.last == null ? null : phase === 'objectId' ? new ObjectId(state.last) : state.last;
    const match = last == null
      ? { _id: phase === 'string' ? { $type: 'string' } : { $type: 'objectId' } }
      : { _id: { $gt: last } }; // type bracketing: $gt on a string matches strings only
    let res;
    for (let attempt = 1; ; attempt++) {
      try { [res] = await chunk(match); break; } catch (e) {
        if (attempt >= 4) { console.error(`chunk failed after ${attempt} tries: ${e.message}`); save(); process.exit(2); }
        console.warn(`chunk retry ${attempt}: ${e.message}`);
        await new Promise(r => setTimeout(r, 5000 * attempt));
      }
    }
    const head = res.last[0];
    if (!head) break;
    for (const g of res.ocr) add('ocr', g._id.m, g._id.s, g);
    for (const g of res.tr) add('translation', g._id.m, g._id.s, g);
    for (const g of res.es) add('translation_es', g._id.m, null, g);
    state.seen += head.n;
    state.last = String(head.last);
    save();
    const rate = state.seen / ((Date.now() - t0) / 1000);
    process.stdout.write(`\r${phase} ${state.seen.toLocaleString()} pages · ${Math.round(rate).toLocaleString()}/s   `);
    if (head.n < CHUNK) break;
  }
  state.last = null;
}
console.log('');

// ── languages per row (books.language of the books it touches) ────────────────
const allBooks = new Set(Object.values(state.rows).flatMap(r => r.books));
const lang = new Map();
{
  const cur = db.collection('books').find({}, { projection: { id: 1, language: 1 } });
  for await (const b of cur) {
    const l = typeof b.language === 'string' && b.language.trim() ? b.language.trim() : null;
    if (b.id && allBooks.has(String(b.id))) lang.set(String(b.id), l);
    if (allBooks.has(String(b._id))) lang.set(String(b._id), l);
  }
}
function topLanguages(books) {
  const c = new Map();
  for (const b of books) { const l = lang.get(b); if (l) c.set(l, (c.get(l) || 0) + 1); }
  return [...c].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([language, n]) => ({ language, books: n }));
}

const rows = Object.values(state.rows)
  .map(r => ({ lane: r.lane, model: r.model, source: r.source, pages: r.pages, pages_with_text: r.with_text, pages_last_30d: r.recent, books: r.books.length, languages: topLanguages(r.books) }))
  .sort((a, b) => b.pages - a.pages);

// ── per engine entry on the page: rows merged, books de-duplicated across rows ──
const byEngine = new Map();
for (const r of Object.values(state.rows)) {
  const id = engineFor(r.lane === 'translation_es' ? 'translation' : r.lane, r.model, r.source);
  if (!id || id === 'not-a-model') continue;
  const key = `${r.lane}\u0001${id}`;
  const e = byEngine.get(key) || { lane: r.lane, id, pages: 0, pages_last_30d: 0, books: new Set() };
  e.pages += r.with_text;
  e.pages_last_30d += r.recent;
  for (const b of r.books) e.books.add(b);
  byEngine.set(key, e);
}
const engines = [...byEngine.values()]
  .map(e => ({ lane: e.lane, id: e.id, pages: e.pages, pages_last_30d: e.pages_last_30d, books: e.books.size, languages: topLanguages(e.books) }))
  .sort((a, b) => b.pages - a.pages);

// ── gallery images by model ───────────────────────────────────────────────────
const images = (await db.collection('gallery_images').aggregate([
  { $group: { _id: '$model', n: { $sum: 1 }, recent: { $sum: { $cond: [{ $gte: ['$detected_at', CUT.toISOString()] }, 1, 0] } } } },
  { $sort: { n: -1 } },
], { maxTimeMS: 120000 }).toArray()).map(g => ({ lane: 'images', model: g._id ?? null, source: null, images: g.n, images_last_30d: g.recent }));

// ── search index (Supabase; planner estimates, labelled as such) ──────────────
const search = [];
if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
  const sb = createClient(process.env.SUPABASE_URL.trim(), process.env.SUPABASE_SERVICE_ROLE_KEY.trim(), { auth: { persistSession: false } });
  for (const table of ['page_translations', 'book_embeddings', 'artwork_embeddings', 'gallery_text_embeddings', 'clip_embeddings']) {
    const est = await sb.from(table).select('*', { count: 'estimated', head: true });
    const sample = await sb.from(table).select('embedding_model').order('updated_at', { ascending: false, nullsFirst: false }).limit(200);
    const models = [...new Set((sample.data || []).map(r => r.embedding_model).filter(Boolean))];
    search.push({ table, rows_estimated: est.error ? null : est.count, models_in_latest_200: models, error: est.error?.message || sample.error?.message || null });
  }
} else {
  console.warn('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing — search index counts skipped');
}

const report = {
  _id: REPORT_ID,
  type: 'model_usage',
  schema_version: 1,
  generated_at: new Date(),
  generated_by: 'scripts/audit/model-usage-snapshot.mjs',
  walk: { started_at: state.started_at, pages_seen: state.seen, recent_since: state.cutoff },
  engines,
  rows,
  images,
  search,
};

// ── print ─────────────────────────────────────────────────────────────────────
for (const r of rows.filter(r => r.pages >= 100)) {
  console.log(`${r.lane.padEnd(15)} ${String(r.model).padEnd(34)} ${String(r.source).padEnd(22)} ${String(r.pages).padStart(10)} pages ${String(r.pages_last_30d).padStart(9)} last30 ${String(r.books).padStart(7)} books`);
}
for (const i of images) console.log(`images          ${String(i.model).padEnd(34)} ${String(i.images).padStart(10)} images`);
for (const s of search) console.log(`search          ${s.table.padEnd(34)} ~${s.rows_estimated} rows ${s.models_in_latest_200.join(',')}`);

if (APPLY) {
  await db.collection('ops_reports').replaceOne({ _id: REPORT_ID }, report, { upsert: true });
  console.log(`ops_reports/${REPORT_ID} written (${state.seen.toLocaleString()} pages walked)`);
} else {
  console.log('dry run — pass --apply to write ops_reports');
}
fs.writeFileSync(path.join(ROOT, 'scripts/output/model-usage-report.json'), JSON.stringify(report, null, 2));
fs.rmSync(CHECKPOINT, { force: true });
await client.close();

// ── drift check: an engine that wrote pages lately must be described on the page ──
const recent = rows.filter(r => r.pages_last_30d > 0 && r.lane !== 'translation_es' && (r.model || r.source));
const unlisted = recent.filter(r => !engineFor(r.lane, r.model, r.source));
if (flag('write-recent')) {
  const out = {
    _comment: 'Written by scripts/audit/model-usage-snapshot.mjs --write-recent. Every (lane, model, source) that wrote pages in the 30 days before generated_at; tests/unit/public-models.test.ts fails if one has no entry in src/data/public-models.ts.',
    generated_at: report.generated_at.toISOString().slice(0, 10),
    rows: recent.map(r => ({ lane: r.lane, model: r.model, source: r.source, pages_last_30d: r.pages_last_30d })),
  };
  fs.writeFileSync(RECENT_FILE, JSON.stringify(out, null, 2) + '\n');
  console.log(`wrote ${path.relative(ROOT, RECENT_FILE)} (${out.rows.length} rows)`);
}


if (unlisted.length) {
  console.error(`UNLISTED: ${unlisted.length} engine(s) wrote pages in the last ${RECENT_DAYS} days with no entry in src/data/public-models.ts:`);
  for (const r of unlisted) console.error(`  ${r.lane} ${r.model} ${r.source} (${r.pages_last_30d} pages)`);
  process.exit(3);
}
