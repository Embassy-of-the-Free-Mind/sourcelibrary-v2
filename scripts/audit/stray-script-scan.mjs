#!/usr/bin/env node
/**
 * PRIOR ART: scripts/audit/translation-bridging.mjs — counts CJK in translations to find
 * untranslated SOURCE left in the English (a different defect: the right script, not
 * translated). scripts/audit/hidden-meta-scan.mjs — walks the local corpus mirror, which this box
 * does not have. scripts/audit/ocr-script-fidelity.mjs — OCR side, not translation. The detector
 * itself is scripts/lib/stray-script.mjs (shared with the write-time guard, #5734).
 *
 * stray-script-scan — every English translation in `pages` with a letter whose script is neither
 * Latin nor expected for the page (the page's OCR and the book's language), outside the tags that
 * legitimately carry original-script words. #5734 part 3. READ-ONLY: writes files, touches no
 * store.
 *
 * Phase A (walk): `pages` by _id window (string _ids first, then 12-hour ObjectId windows).
 * Per window, ONE server-side aggregation counts translated pages by book × model × call site ×
 * translation language, and materialises the ids of pages whose translation has a non-Latin letter
 * outside a carrier tag (a PCRE prefilter; approximate, the exact rule runs in phase B). Each
 * window's line is appended to walk.jsonl in one write; a restart skips done windows (checkpoint
 * rule, eval-design §9).
 * Phase B (classify): the prefiltered ids, 300 at a time, fetched with translation + OCR and run
 * through strayScripts(). One line per batch in hits.jsonl (checkpointed by batch index).
 * Phase C (--summarize): segment by model, source language, lane and script → summary.json,
 * summary.md, same-pattern ids (hangul-that-ids.txt: Hangul 그 is the only stray) and review.jsonl.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/audit/stray-script-scan.mjs --out=DIR [--phase=walk|classify|summarize|all]
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient, ObjectId } from 'mongodb';
import { strayScripts, repairStrayHangul, CARRIER_TAGS, GUARD_EXEMPT_SCRIPTS } from '../lib/stray-script.mjs';

const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=') ?? d;
const OUT = arg('out', 'scripts/output/stray-script-scan');
const PHASE = arg('phase', 'all');
const WINDOW_H = Number(arg('window-hours', 12));
fs.mkdirSync(OUT, { recursive: true });
const WALK = path.join(OUT, 'walk.jsonl');
const HITS = path.join(OUT, 'hits.jsonl');
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// A non-Latin letter not followed (before the next '<') by the close of a carrier tag. Nested
// tags inside a carrier are handled by the exact rule in phase B; this only narrows the fetch.
const PREFILTER = `[^\\P{L}\\p{Latin}](?![^<]*</(?:${CARRIER_TAGS.join('|')})\\s*>)`;

const readLines = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

async function walk(db) {
  const P = db.collection('pages');
  const done = new Set(readLines(WALK).map((r) => r.window));
  // A range on ObjectId never matches another BSON type (type bracketing), so string _ids — ~280K
  // page docs — are their own window.
  const windows = [{ key: 'string-id', match: { _id: { $type: 'string' } } }];
  const [first] = await P.find({ _id: { $type: 'objectId' } }, { projection: { _id: 1 } }).sort({ _id: 1 }).limit(1).toArray();
  const [last] = await P.find({ _id: { $type: 'objectId' } }, { projection: { _id: 1 } }).sort({ _id: -1 }).limit(1).toArray();
  const step = WINDOW_H * 3600;
  for (let t = Math.floor(first._id.getTimestamp().getTime() / 1000); t <= last._id.getTimestamp().getTime() / 1000; t += step) {
    windows.push({ key: `oid:${t}`, match: { _id: { $gte: ObjectId.createFromTime(t), $lt: ObjectId.createFromTime(t + step) } } });
  }
  log(`walk: ${windows.length} windows, ${done.size} done`);
  let n = 0;
  for (const w of windows) {
    if (done.has(w.key)) continue;
    const t0 = Date.now();
    const groups = await P.aggregate([
      { $match: { ...w.match, 'translation.data': { $type: 'string', $gt: '' } } },
      { $project: { id: 1, book_id: 1, m: '$translation.model', s: '$translation.engine.call_site', a: '$translation.engine.api', l: '$translation.language', src: '$translation.source',
        hit: { $regexMatch: { input: '$translation.data', regex: PREFILTER } } } },
      { $group: { _id: { b: '$book_id', m: '$m', s: '$s', a: '$a', l: '$l', src: '$src' }, n: { $sum: 1 }, hits: { $push: { $cond: ['$hit', '$id', '$$REMOVE'] } } } },
    ], { allowDiskUse: true, maxTimeMS: 1_800_000 }).toArray();
    const pages = groups.reduce((s, g) => s + g.n, 0);
    const hits = groups.reduce((s, g) => s + g.hits.length, 0);
    fs.appendFileSync(WALK, JSON.stringify({ window: w.key, pages, hits, ms: Date.now() - t0, groups }) + '\n');
    if (++n % 20 === 0 || pages > 50000) log(`walk ${w.key}: ${pages} translated, ${hits} prefilter hits, ${Date.now() - t0} ms`);
  }
  log('walk done');
}

async function classify(db) {
  const ids = [];
  for (const r of readLines(WALK)) for (const g of r.groups) for (const id of g.hits) ids.push(id);
  // A batch is done when its line covers the same number of ids it would cover now (a walk window
  // re-run after classify can lengthen the last batch).
  const done = new Map(readLines(HITS).map((r) => [r.batch, r.n]));
  const books = db.collection('books');
  const langCache = new Map();
  const BATCH = 300;
  log(`classify: ${ids.length} prefiltered pages, ${Math.ceil(ids.length / BATCH)} batches, ${done.size} done`);
  for (let i = 0, b = 0; i < ids.length; i += BATCH, b++) {
    if (done.has(b) && (done.get(b) === undefined || done.get(b) === ids.slice(i, i + BATCH).length)) continue;
    const pages = await db.collection('pages').find({ id: { $in: ids.slice(i, i + BATCH) } }, {
      projection: { id: 1, book_id: 1, page_number: 1, 'translation.data': 1, 'translation.model': 1, 'translation.language': 1, 'translation.source': 1, 'translation.edited_by': 1,
        'translation.engine.call_site': 1, 'translation.engine.api': 1, 'translation.updated_at': 1, 'ocr.data': 1 },
    }).toArray();
    const need = [...new Set(pages.map((p) => p.book_id))].filter((x) => !langCache.has(x));
    if (need.length) for (const bk of await books.find({ id: { $in: need } }, { projection: { id: 1, language: 1 } }).toArray()) langCache.set(bk.id, bk.language || null);
    const rows = [];
    for (const p of pages) {
      const t = p.translation || {};
      if (t.language && !/^english$/i.test(t.language)) continue;
      const language = langCache.get(p.book_id) ?? null;
      const stray = strayScripts(t.data, { ocr: p.ocr?.data, language });
      if (!stray.length) continue;
      const scripts = [...new Set(stray.map((s) => s.script))];
      const hangulThatOnly = scripts.length === 1 && scripts[0] === 'Hangul' && (() => {
        const r = repairStrayHangul(t.data, { ocr: p.ocr?.data, language });
        return r.count > 0 && r.other.length === 0 && strayScripts(r.text, { ocr: p.ocr?.data, language }).length === 0;
      })();
      rows.push({
        id: p.id, book_id: p.book_id, page: p.page_number, language, model: t.model || null, site: t.engine?.call_site || null, api: t.engine?.api || null,
        source: t.source || null, human: !!(t.source === 'manual' || t.edited_by), updated_at: t.updated_at, scripts, hangul_that_only: hangulThatOnly,
        guard: stray.some((x) => !GUARD_EXEMPT_SCRIPTS.has(x.script)),
        runs: stray.slice(0, 8).map((s) => ({ script: s.script, text: s.text.slice(0, 40), ctx: t.data.slice(Math.max(0, s.index - 50), s.index + s.text.length + 40).replace(/\s+/g, ' ') })),
        n_runs: stray.length,
      });
    }
    fs.appendFileSync(HITS, JSON.stringify({ batch: b, n: ids.slice(i, i + BATCH).length, rows }) + '\n');
    if (b % 50 === 0) log(`classify batch ${b}: ${rows.length} stray of ${pages.length}`);
  }
  log('classify done');
}

async function summarize(db) {
  const bookIds = new Set();
  const walk = readLines(WALK);
  for (const r of walk) for (const g of r.groups) bookIds.add(g._id.b);
  const lang = new Map();
  const ids = [...bookIds];
  for (let i = 0; i < ids.length; i += 5000) {
    for (const b of await db.collection('books').find({ id: { $in: ids.slice(i, i + 5000) } }, { projection: { id: 1, language: 1 } }).toArray()) lang.set(b.id, b.language || '(none)');
  }
  const laneOf = (site, api) => (site ? `${site}${api ? ` (${api})` : ''}` : '(no engine block: pre-#4613)');
  const seg = { model: {}, language: {}, lane: {} };
  const bump = (dim, key, f, n = 1) => { const o = (seg[dim][key ??= '(none)'] ??= { translated: 0, stray: 0, guard: 0, hangul_that_only: 0, by_script: {} }); o[f] += n; return o; };
  let translated = 0;
  for (const r of walk) for (const g of r.groups) {
    if (g._id.l && !/^english$/i.test(g._id.l)) continue;
    translated += g.n;
    bump('model', g._id.m, 'translated', g.n);
    bump('language', lang.get(g._id.b) || '(none)', 'translated', g.n);
    bump('lane', laneOf(g._id.s, g._id.a), 'translated', g.n);
  }
  const rows = [...new Map(readLines(HITS).map((b) => [b.batch, b])).values()].flatMap((b) => b.rows); // last line per batch wins
  const review = fs.createWriteStream(path.join(OUT, 'review.jsonl'));
  const thatIds = [];
  const byScript = {};
  for (const r of rows) {
    for (const [dim, key] of [['model', r.model], ['language', r.language || '(none)'], ['lane', laneOf(r.site, r.api)]]) {
      const o = bump(dim, key, 'stray');
      if (r.hangul_that_only) o.hangul_that_only++;
      if (r.guard) o.guard++;
      for (const s of r.scripts) o.by_script[s] = (o.by_script[s] || 0) + 1;
    }
    for (const s of r.scripts) byScript[s] = (byScript[s] || 0) + 1;
    if (r.hangul_that_only && !r.human) thatIds.push(r.id); else review.write(JSON.stringify(r) + '\n');
  }
  await new Promise((res) => review.end(res));
  fs.writeFileSync(path.join(OUT, 'hangul-that-ids.txt'), thatIds.join('\n') + '\n');
  const guardPages = rows.filter((r) => r.guard).length;
  const summary = { generated_at: new Date().toISOString(), windows: walk.length, english_translated_pages: translated, stray_pages: rows.length, guard_would_refuse_pages: guardPages, hangul_that_only_pages: thatIds.length, by_script: byScript, ...seg };
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 1));
  const table = (dim, min = 0) => {
    const ent = Object.entries(seg[dim]).filter(([, v]) => v.stray > min || v.translated > 50000).sort((a, b) => b[1].stray - a[1].stray || b[1].translated - a[1].translated);
    return [`| ${dim} | English pages | with stray script | per 10k | guard would refuse | Hangul 그 only | scripts |`, '|---|---:|---:|---:|---:|---:|---|',
      ...ent.map(([k, v]) => `| ${k} | ${v.translated.toLocaleString('en-US')} | ${v.stray} | ${v.translated ? (1e4 * v.stray / v.translated).toFixed(1) : '–'} | ${v.guard} | ${v.hangul_that_only} | ${Object.entries(v.by_script).sort((a, b) => b[1] - a[1]).map(([s, n]) => `${s} ${n}`).join(', ')} |`)].join('\n');
  };
  fs.writeFileSync(path.join(OUT, 'summary.md'), [`English translated pages scanned: ${translated.toLocaleString('en-US')} · with stray script: ${rows.length} · the write-time guard would refuse: ${guardPages} · Hangul 그 only: ${thatIds.length}`,
    `By script (pages): ${Object.entries(byScript).sort((a, b) => b[1] - a[1]).map(([s, n]) => `${s} ${n}`).join(', ')}`, '', table('model'), '', table('lane'), '', table('language')].join('\n'));
  log(`summary: ${translated} English pages, ${rows.length} stray, ${thatIds.length} Hangul-that-only → ${OUT}`);
}

const mongo = new MongoClient(process.env.MONGODB_URI);
await mongo.connect();
const db = mongo.db('bookstore');
try {
  if (PHASE === 'walk' || PHASE === 'all') await walk(db);
  if (PHASE === 'classify' || PHASE === 'all') await classify(db);
  if (PHASE === 'summarize' || PHASE === 'all') await summarize(db);
} finally { await mongo.close(); }
