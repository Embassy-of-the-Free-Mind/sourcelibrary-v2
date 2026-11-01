#!/usr/bin/env node
// PRIOR ART: see lib.mjs. The judge driver (pace guard, call budget, resume from the verdict file, wrong-page
// controls) follows scripts/eval/confidence-7866/judge.mjs runQueue, restated because its items come from #7866's draw.
/**
 * Judge calibration at #7866's bar (#7263). READ-ONLY on Mongo; R2 read for the typed texts; GitHub raw for Kanripo.
 * Opus only through `claude -p` on this box's subscription (judgeAbsolute); no paid API, no Gemini.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/judge-cal-7866bar-7263/run.mjs <stage> [--dir=<kanripo cache>]
 *     draw      the 100 pages (seeded; one per book): 20 German (DTA), 20 English (EEBO-TCP), 20 Latin (CAMENA, EEBO-TCP,
 *               DTA), 40 Chinese manuscript (the zh-paddle-dice-lt090 lane, Kanripo)        → OUT/draw.json, results/draw.json
 *     fetch     stored read, typed reference, page image per drawn page                       → OUT/items/<uid>.json, OUT/img
 *     truth     the truth rule (lib.mjs) per page                                             → results/truth.jsonl
 *     judge     #7866's judge, once per page, then the controls: 2 wrong-page per stratum (this image, another drawn page's
 *               read) and 6 seeded repeats; at most CALL_CAP calls; stops at the weekly 85% pace guard → OUT/verdicts.jsonl
 *     export    the verdicts, without text                                                    → results/verdicts.jsonl
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import { makeRng } from '../lib/paired-stats.mjs';
import { eligiblePage, imageUrl, judgeAbsolute, paceCheck } from '../confidence-7866/lib.mjs';
import { getToFile, PREFIX } from '../typed-refs-6012/lib.mjs';
import { workInfo, pbPages } from '../zh-skqs-5568-kanripo.mjs';
import { bodyText, foldHan, isInterior } from '../ground-truth-5935/lib.mjs';
import { SEED, N, CALL_CAP, MIN_REF_LETTERS, MIN_HAN, truthLatin, truthHan } from './lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RESULTS = path.join(HERE, 'results');
const OUT = path.join(process.env.JOB_SCRATCH || os.tmpdir(), 'judge-cal-7866bar');
const REFS = '/data/scratch/sl/typed-refs-6012';
const VERDICTS = path.join(OUT, 'verdicts.jsonl');
fs.mkdirSync(RESULTS, { recursive: true }); fs.mkdirSync(path.join(OUT, 'items'), { recursive: true });
const sha = (s) => createHash('sha256').update(String(s)).digest('hex');
const hseed = (s, id) => (s ^ parseInt(sha(id).slice(0, 8), 16)) >>> 0;
const shuffle = (xs, rng) => { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const jsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const J = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const PAGE_PROJ = { _id: 0, translation: 0, ocr_history: 0 };
// #7866's page call (confidence-7866/analyze.mjs badPage; that file runs its CLI on import, so restated here unchanged)
const badPage = (v) => !v.accept || (v?.defects || []).some((d) => d.severity === 'wrong_text');

async function mongo() { const c = await MongoClient.connect(process.env.MONGODB_URI); return { c, db: c.db(process.env.MONGODB_DB || 'bookstore') }; }

// ── typed references (#6012 derived shards, private R2) ──
const manifests = {};
function manifest(src) {
  if (!manifests[src]) manifests[src] = new Map(fs.readFileSync(path.join(REFS, src, 'manifest.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => { const r = JSON.parse(l); return [r.source_id, r]; }));
  return manifests[src];
}
const shards = {};
async function typedPages(src, sourceId) {
  const m = manifest(src).get(sourceId);
  const f = path.join(OUT, 'shards', src, m.derived_shard);
  if (!fs.existsSync(f)) { fs.mkdirSync(path.dirname(f), { recursive: true }); await getToFile(m.derived_key, f); }
  if (!shards[f]) shards[f] = new Map(zlib.gunzipSync(fs.readFileSync(f)).toString('utf8').split('\n').filter(Boolean).map((l) => { const r = JSON.parse(l); return [r.source_id, r]; }));
  return shards[f].get(sourceId)?.pages ?? null;
}

/** Same-edition books whose pages map to the typed text by one offset (page_number - typed page index). */
function printBooks() {
  const dir = { dta: 'dta', camena: 'camena', 'eebo-tcp': 'eebo' };
  const books = new Map();
  for (const [src, d] of Object.entries(dir)) {
    for (const l of fs.readFileSync(path.join(REFS, d, 'aligned-pages.jsonl'), 'utf8').split('\n')) {
      if (!l) continue; const r = JSON.parse(l);
      if (r.kind !== 'same-edition' || !r.congruent) continue;
      const k = `${r.book_id}|${r.source_id}`;
      if (!books.has(k)) books.set(k, { book_id: r.book_id, source: src, dir: d, source_id: r.source_id, language: r.language, rows: [] });
      books.get(k).rows.push([r.page_number, r.ref_page_idx[0]]);
    }
  }
  const out = [];
  for (const b of books.values()) {
    const offs = {}; for (const [p, i] of b.rows) offs[p - i] = (offs[p - i] || 0) + 1;
    const [off, n] = Object.entries(offs).sort((a, c) => c[1] - a[1])[0];
    if (b.rows.length < 10 || n / b.rows.length < 0.8) continue;
    const pns = b.rows.map((r) => r[0]);
    const lang = /^German/.test(b.language) && b.source === 'dta' ? 'German' : b.language === 'English' && b.source === 'eebo-tcp' ? 'English' : b.language === 'Latin' ? 'Latin' : null;
    if (lang) out.push({ book_id: b.book_id, source: b.source, dir: b.dir, source_id: b.source_id, lang, offset: +off, lo: Math.min(...pns), hi: Math.max(...pns), aligned_pages: b.rows.length });
  }
  return out.sort((a, c) => (a.book_id + a.source_id).localeCompare(c.book_id + c.source_id));
}

const LIVE = { visible: true, pages_count: { $gt: 0 } };

async function draw() {
  const { c, db } = await mongo();
  const drawn = [], log = [];
  // PRINT: books shuffled by makeRng(SEED.books + language index); a page drawn uniformly from the book's aligned
  // range (not only the pages the aligner found: a badly read page is as likely as a good one); kept when the typed
  // page is there, has no <gap>, and holds >= MIN_REF_LETTERS letters; at most 12 pages tried a book.
  const pb = printBooks();
  for (const [li, lang] of ['German', 'English', 'Latin'].entries()) {
    const seen = new Set();
    for (const b of shuffle(pb.filter((x) => x.lang === lang), makeRng(SEED.books + li))) {
      if (drawn.filter((d) => d.lang === lang).length >= N[lang]) break;
      if (seen.has(b.book_id)) continue; seen.add(b.book_id);
      const book = await db.collection('books').findOne({ id: b.book_id, ...LIVE }, { projection: { _id: 0, id: 1, title: 1, language: 1, pages_count: 1 } });
      if (!book) { log.push({ book: b.book_id, why: 'not live' }); continue; }
      const pages = (await db.collection('pages').find({ book_id: b.book_id, page_number: { $gte: b.lo, $lte: b.hi } }, { projection: PAGE_PROJ }).toArray()).filter(eligiblePage).sort((x, y) => x.page_number - y.page_number);
      const typed = await typedPages(b.dir, b.source_id);
      if (!typed) { log.push({ book: b.book_id, why: 'typed text missing' }); continue; }
      let pick = null, tries = 0;
      for (const p of shuffle(pages, makeRng(hseed(SEED.pages, b.book_id)))) {
        if (tries++ >= 12) break;
        const i = p.page_number - b.offset, t = typed[i];
        if (!t || t.gaps > 0) continue;
        if (t.text.replace(/[^\p{L}]/gu, '').length < MIN_REF_LETTERS) continue;
        pick = { p, i }; break;
      }
      if (!pick) { log.push({ book: b.book_id, why: 'no page passed in 12 tries' }); continue; }
      drawn.push({ uid: `${lang.slice(0, 2).toLowerCase()}-${b.book_id}`, stratum: 'print', lang, book_id: b.book_id, title: String(book.title || '').slice(0, 90), book_language: book.language,
        page_id: pick.p.id, page_number: pick.p.page_number, image: imageUrl(pick.p), ref: { source: b.source, dir: b.dir, source_id: b.source_id, index: pick.i, offset: b.offset },
        engine: pick.p.ocr?.model ?? null, pipeline: pick.p.ocr?.pipeline ?? null, ocr_source: pick.p.ocr?.source ?? null, ocr_hash: sha(pick.p.ocr.data).slice(0, 16) });
      console.log(lang, drawn.length, b.book_id, pick.p.page_number);
    }
  }
  // MANUSCRIPT: books the Paddle zh lane re-read (book_events paddle_zh_reocr), live, shuffled by makeRng(SEED.books + 9);
  // a page drawn uniformly among the book's interior pages the lane wrote (pipeline ^paddle-zh: the
  // zh-paddle-dice-lt090 cell of #7866); kept when BOTH neighbours carry a trusted Kanripo leaf (qa_screen screened,
  // dice >= 0.6) two leaves apart, so the page's own leaf is the one between them, and its body holds >= MIN_HAN Han
  // characters. The page's own read never decides whether it is drawn.
  const ev = await db.collection('book_events').find({ type: 'paddle_zh_reocr', 'details.pages_written': { $gt: 0 } }, { projection: { _id: 0, book_id: 1 } }).toArray();
  const frame = [...new Set(ev.map((e) => e.book_id))].sort();
  const kcache = {};
  for (const id of shuffle(frame, makeRng(SEED.books + 9))) {
    if (drawn.filter((d) => d.lang === 'Chinese').length >= N.Chinese) break;
    const book = await db.collection('books').findOne({ id, ...LIVE }, { projection: { _id: 0, id: 1, title: 1, language: 1, pages_count: 1 } });
    if (!book) { log.push({ book: id, why: 'not live' }); continue; }
    const pages = await db.collection('pages').find({ book_id: id, 'ocr.pipeline': /^paddle-zh/ }, { projection: { _id: 0, id: 1, page_number: 1 } }).toArray();
    const pool = pages.filter((p) => isInterior(p.page_number, book.pages_count)).sort((a, b) => a.page_number - b.page_number);
    let pick = null, tries = 0;
    for (const q of shuffle(pool, makeRng(hseed(SEED.pages, id)))) {
      if (tries++ >= 12) break;
      const nb = await db.collection('pages').find({ book_id: id, page_number: { $in: [q.page_number - 1, q.page_number + 1] } }, { projection: { _id: 0, page_number: 1, 'ocr.qa_screen': 1 } }).toArray();
      const at = (k) => nb.find((x) => x.page_number === k)?.ocr?.qa_screen;
      const a = at(q.page_number - 1), b = at(q.page_number + 1);
      const ok = (s) => s?.status === 'screened' && s.dice >= 0.6 && s.repo && s.pb;
      if (!ok(a) || !ok(b) || a.repo !== b.repo) continue;
      const krId = String(a.repo).replace(/^kanripo\//, '');
      const juan = (pbn) => Number(String(pbn).match(/_(\d{3})-\d+[ab]$/)?.[1]);
      const ja = juan(a.pb), jb = juan(b.pb);
      if (!Number.isFinite(ja) || !Number.isFinite(jb)) continue;
      const w = kcache[krId] ??= await workInfo(krId);
      const pbs = await pbPages(krId, 'WYG', (w.juan_files || []).filter((x) => x >= Math.min(ja, jb) - 1 && x <= Math.max(ja, jb) + 1));
      const ia = pbs.findIndex((x) => x.pb === a.pb), ib = pbs.findIndex((x) => x.pb === b.pb);
      if (ia < 0 || ib - ia !== 2) continue;
      const p = await db.collection('pages').findOne({ id: q.id }, { projection: PAGE_PROJ });
      if (!eligiblePage(p)) continue;
      if ([...foldHan(bodyText(p.ocr.data))].length < MIN_HAN) continue;
      pick = { p, krId, juans: [...new Set([ja, jb])], pb: pbs[ia + 1].pb };
      break;
    }
    if (!pick) { log.push({ book: id, why: 'no page with two trusted neighbours in 12 tries' }); continue; }
    drawn.push({ uid: `zh-${id}`, stratum: 'manuscript', lang: 'Chinese', book_id: id, title: String(book.title || '').slice(0, 90), book_language: book.language,
      page_id: pick.p.id, page_number: pick.p.page_number, image: imageUrl(pick.p), ref: { source: 'kanripo', repo: pick.krId, witness: 'WYG', juans: pick.juans, pb: pick.pb, leaf_rule: 'neighbours' },
      engine: pick.p.ocr?.model ?? null, pipeline: pick.p.ocr?.pipeline ?? null, ocr_source: pick.p.ocr?.source ?? null, ocr_hash: sha(pick.p.ocr.data).slice(0, 16) });
    console.log('Chinese', drawn.length, id, pick.p.page_number, pick.pb);
  }
  await c.close();
  const meta = { seeds: SEED, n: N, drawn_at: new Date().toISOString(), rule: 'run.mjs draw (header comments)', counts: drawn.reduce((m, d) => ((m[d.lang] = (m[d.lang] || 0) + 1), m), {}) };
  fs.writeFileSync(path.join(OUT, 'draw.json'), JSON.stringify({ ...meta, drawn, skipped: log }, null, 1));
  fs.writeFileSync(path.join(RESULTS, 'draw.json'), JSON.stringify({ ...meta, drawn: drawn.map(({ title, ...d }) => d), skipped: log }, null, 1) + '\n');
  console.log(JSON.stringify(meta.counts), 'skipped', log.length);
}

const MAX_IMAGE_BYTES = 4e6, RESIZE_PX = 3000;   // #7866's judge.mjs: one resize before any call
async function imageFor(uid, url) {
  const f = path.join(OUT, 'img', `${uid}.jpg`);
  let buf = fs.existsSync(f) ? fs.readFileSync(f) : null;
  if (!buf) {
    const r = await fetch(url, { headers: { 'User-Agent': 'SourceLibrary-eval/7263 (https://sourcelibrary.org)' }, signal: AbortSignal.timeout(60e3) });
    if (!r.ok) throw new Error(`image HTTP ${r.status} ${url.slice(0, 100)}`);
    buf = Buffer.from(await r.arrayBuffer());
    fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, buf);
  }
  if (buf.length > MAX_IMAGE_BYTES) {
    const { default: sharp } = await import('sharp');
    buf = await sharp(buf).resize(RESIZE_PX, RESIZE_PX, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
    fs.writeFileSync(f, buf);
  }
  return buf;
}

async function fetchAll() {
  const { drawn } = J(path.join(OUT, 'draw.json'));
  const { c, db } = await mongo();
  for (const d of drawn) {
    const f = path.join(OUT, 'items', `${d.uid}.json`);
    if (fs.existsSync(f)) continue;
    const p = await db.collection('pages').findOne({ id: d.page_id }, { projection: { _id: 0, 'ocr.data': 1 } });
    const it = { uid: d.uid, read: p.ocr.data, read_hash: sha(p.ocr.data).slice(0, 16), changed_since_draw: sha(p.ocr.data).slice(0, 16) !== d.ocr_hash };
    if (d.stratum === 'print') {
      const typed = await typedPages(d.ref.dir, d.ref.source_id);
      it.ref = typed[d.ref.index]; it.win = [typed[d.ref.index - 1]?.text ?? '', typed[d.ref.index].text, typed[d.ref.index + 1]?.text ?? ''];
    } else {
      const pbs = await pbPages(d.ref.repo, 'WYG', d.ref.juans.flatMap((j) => [j - 1, j, j + 1]).filter((j, i, a) => a.indexOf(j) === i).sort((a, b) => a - b));
      const k = pbs.findIndex((x) => x.pb === d.ref.pb);
      it.pbs = pbs.slice(Math.max(0, k - 1), k + 2).map((x) => ({ pb: x.pb, text: x.text })); it.k = Math.min(1, k);
    }
    await imageFor(d.uid, d.image);
    fs.writeFileSync(f, JSON.stringify(it));
    console.log('fetched', d.uid, it.changed_since_draw ? 'READ CHANGED SINCE DRAW' : '');
  }
  await c.close();
}

function truth() {
  const { drawn } = J(path.join(OUT, 'draw.json'));
  const rows = [];
  for (const d of drawn) {
    const it = J(path.join(OUT, 'items', `${d.uid}.json`));
    const t = d.stratum === 'print' ? truthLatin(it.read, it.ref, it.win) : truthHan(it.read, it.pbs, it.k);
    rows.push({ uid: d.uid, stratum: d.stratum, lang: d.lang, book_id: d.book_id, page_id: d.page_id, engine: d.engine, pipeline: d.pipeline, ...t });
  }
  fs.writeFileSync(path.join(RESULTS, 'truth.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const by = {}; for (const r of rows) { const k = r.lang; by[k] ??= { n: 0, bad: 0, spans: 0 }; by[k].n++; by[k].bad += r.bad; by[k].spans += r.spans.length > 0; }
  console.log(JSON.stringify(by));
}

// ── the judge (#7866's instrument, unchanged) ──
const LANG = { German: 'German', English: 'English', Latin: 'Latin', Chinese: 'Chinese' };
async function judge() {
  const { drawn } = J(path.join(OUT, 'draw.json'));
  const have = jsonl(VERDICTS);
  const done = new Set(have.filter((r) => r.verdict).map((r) => r.id));
  const tries = new Map(); for (const r of have) if (!r.verdict) tries.set(r.id, (tries.get(r.id) ?? 0) + 1);
  const text = (uid) => J(path.join(OUT, 'items', `${uid}.json`)).read;
  const jobs = shuffle(drawn, makeRng(SEED.queue)).map((d) => ({ id: d.uid, set: 'item', d, text: () => text(d.uid) }));
  // Controls: per stratum 2 wrong-page items (this image, another drawn book's read in the same language) and, over all
  // items, 6 repeats (the same image and text again) — seeded, fixed before any verdict.
  for (const s of ['print', 'manuscript']) {
    const pool = shuffle(drawn.filter((d) => d.stratum === s), makeRng(SEED.wrongPage + (s === 'print' ? 0 : 1)));
    for (let i = 0; i < 2; i++) { const a = pool[i], b = pool.slice(i + 1).find((x) => x.lang === a.lang && x.book_id !== a.book_id); if (b) jobs.push({ id: `wp-${a.uid}`, set: 'wrong_page', d: a, other: b.uid, text: () => text(b.uid) }); }
  }
  for (const d of shuffle(drawn, makeRng(SEED.repeats)).slice(0, 6)) jobs.push({ id: `rep-${d.uid}`, set: 'repeat', d, text: () => text(d.uid) });
  const todo = jobs.filter((j) => !done.has(j.id) && (tries.get(j.id) ?? 0) < 3);
  const limits = await import('../../lib/model-limits.mjs');
  const state = {}; let calls = have.filter((r) => r.verdict || r.usage).length, stop = null, i = 0;
  console.log(`judge: ${todo.length} to do; ${calls} calls so far (cap ${CALL_CAP})`);
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (!stop && i < todo.length) {
      if (calls >= CALL_CAP) { stop = `call cap ${CALL_CAP}`; break; }
      const why = await paceCheck(limits, state); if (why) { stop = why; break; }
      if (i >= todo.length) break;
      const j = todo[i++]; calls++;
      let rec;
      try {
        const r = await judgeAbsolute({ lang: LANG[j.d.lang], text: j.text() }, await imageFor(j.d.uid, j.d.image));
        rec = { id: j.id, set: j.set, uid: j.d.uid, other: j.other ?? null, ...r };
      } catch (e) { rec = { id: j.id, set: j.set, uid: j.d.uid, err: String(e.message || e).slice(0, 200) }; calls--; }
      if (rec.cls === 'quota') { limits.noteLimitHit('claude', { reason: String(rec.raw || '').slice(0, 200) }); stop = 'quota reply'; break; }
      fs.appendFileSync(VERDICTS, JSON.stringify({ ...rec, at: new Date().toISOString() }) + '\n');
      console.log(`  ${j.set} ${j.id}: ${rec.verdict ? `accept=${rec.verdict.accept} f${rec.verdict.fidelity} bad=${badPage(rec.verdict)}` : rec.err ? `ERR ${rec.err}` : 'unparsed'}`);
    }
  }));
  console.log(`${calls} calls in all; ${stop ? `STOPPED: ${stop}` : 'queue done'}; meter ${JSON.stringify(state.meter ?? null)}`);
}

/** The committed verdicts: accept, fidelity, defect classes and severities; never the quoted text. */
function exportVerdicts() {
  const rows = jsonl(VERDICTS).filter((r) => r.verdict).map((r) => ({ id: r.id, set: r.set, uid: r.uid, other: r.other, model: r.model, prompt_sha: r.prompt_sha, at: r.at,
    accept: r.verdict.accept, fidelity: r.verdict.fidelity, judge_bad: badPage(r.verdict), defects: (r.verdict.defects || []).map((x) => ({ class: x.class, severity: x.severity })) }));
  fs.writeFileSync(path.join(RESULTS, 'verdicts.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  console.log('exported', rows.length);
}

/** #7866's 800 page verdicts (lane_judge_verdicts, lane confidence-7866) as numbers: the page call, its MQM
 *  misleads / wrong_text counts, the words of the page's stored text now, and the book's design weight, stratum, script
 *  and human_read_count (books-known-fields: the reader-view field, #5048). The input of analyze.py's correction. */
async function frame7866() {
  const { c, db } = await mongo();
  const v = await db.collection('lane_judge_verdicts').find({ lane: 'confidence-7866', kind: 'item' }, { projection: { _id: 0, usage: 0 } }).toArray();
  const pages = new Map((await db.collection('pages').find({ id: { $in: v.map((r) => r.page_id) } }, { projection: { _id: 0, id: 1, 'ocr.data': 1 } }).toArray()).map((p) => [p.id, p]));
  const books = new Map((await db.collection('books').find({ id: { $in: [...new Set(v.map((r) => r.book_id))] } }, { projection: { _id: 0, id: 1, human_read_count: 1, read_count: 1 } }).toArray()).map((b) => [b.id, b]));
  const { words } = await import('../confidence-7866/lib.mjs');
  const rows = v.map((r) => {
    const t = pages.get(r.page_id)?.ocr?.data, sev = (s) => (r.verdict?.defects || []).filter((d) => d.severity === s).length;
    return { page_id: r.page_id, book_id: r.book_id, stratum: r.draw?.stratum, weight: r.draw?.weight, script: r.script_type, cell: r.cell_real, lang: r.lang,
      judged: Boolean(r.verdict), judge_bad: r.verdict ? badPage(r.verdict) : null, misleads: r.verdict ? sev('misleads') : null, wrong_text: r.verdict ? sev('wrong_text') : null,
      words_now: t ? words(t, r.lang) : null, text_sha_now: t ? sha(t.trim()).slice(0, 16) : null, text_sha_judged: r.write?.text_sha ?? null,
      human_read_count: books.get(r.book_id)?.human_read_count ?? null, read_count: books.get(r.book_id)?.read_count ?? null };
  });
  await c.close();
  const score = J(path.join(HERE, '../confidence-7866/results/score.json'));
  fs.writeFileSync(path.join(RESULTS, 'frame-7866.json'), JSON.stringify({ read_at: new Date().toISOString(), frame_books: score.corpus.frame_books, rows }, null, 1) + '\n');
  console.log('frame-7866', rows.length, 'pages; books with human_read_count', [...books.values()].filter((b) => b.human_read_count != null).length, 'of', books.size);
}

const stages = { draw, fetch: fetchAll, truth, judge, export: exportVerdicts, frame7866 };
if (!stages[process.argv[2]]) { console.error(`stages: ${Object.keys(stages).join(' | ')}`); process.exit(2); }
await stages[process.argv[2]]();
