#!/usr/bin/env node
// PRIOR ART: scripts/eval/route-judge-6740/cheap-routes-7701/run.mjs (#7701's cell tests: one unread interior page per
// book, written set from the lane's own guards, blind packet with wrong-page and planted controls, Beta(1+k,1+n-k) rule;
// its packet/plant/score code is followed here) and judge.mjs (its `judge` stage, called unchanged). They do not fit as
// is: their cells read with agy and write through cli-ocr.mjs apply; this cell reads with the GPU print lane
// (LightOnOCR-3-1B, scripts/gpu/gpu-print-gpu.sh) and its written set is scripts/lib/gpu-print-lane.mjs pageVerdict.
/**
 * English print before 1800 on the GPU print lane (#6871, job gpu-next-frame-6871). Route under test: `lighton` =
 * LightOnOCR-3-1B as the 1800+ lane reads (gpu-print-read.py, FP8, 2,400 px), written only past the lane's guards
 * (loop, textless, other_script, engine_commentary, transliteration). RULE.md beside the results fixes the decision.
 *
 *   node --env-file=… run.mjs draw   --out=DIR [--n=30]   frame (English, `year` < 1800, held for a GPU lane or not
 *                                                          held, not a manuscript, not an unsplit spread, not in the
 *                                                          1800+ frame) → DIR/frame-books.json; 30 pages → sample.json
 *                                                          + DIR/lane/manifest.tsv (the GPU reader's input)
 *   LANE_DIR=DIR/lane HOURS=1 bash scripts/gpu/gpu-print-gpu.sh     (through gpu-queue.sh: the card, under /root/gpu.lock)
 *   node --env-file=… run.mjs packet --out=DIR             written set (pageVerdict) + blind items + 2 wrong-page controls
 *   ROUTE_JUDGE_WEEKLY_MAX=99 node judge.mjs judge --out=DIR
 *   node run.mjs plant  --out=DIR                          2 planted items on accepted outputs
 *   ROUTE_JUDGE_WEEKLY_MAX=99 node judge.mjs judge --out=DIR
 *   node run.mjs score  --out=DIR                          RULE.md's measures and decision → DIR/score.json
 * Read-only: nothing here writes to Mongo.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { makeRng } from '../../lib/paired-stats.mjs';
import { plantError, scorePlant } from '../../lib/plant-ocr-errors.mjs';

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const STAGE = process.argv[2];
const OUT = path.resolve(arg('out') || '.');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const h = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const J = (f) => JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8'));
const W = (f, x) => fs.writeFileSync(path.join(OUT, f), JSON.stringify(x, null, 1));
const jsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const shuffled = (xs, salt) => [...xs].sort((a, b) => h(salt + (a.id ?? a.page_id)).localeCompare(h(salt + (b.id ?? b.page_id))));
const CELL = 'en-pre1800', ROUTE = 'lighton', LANG = 'English';
const GPU_LANE = '/root/jobs/gpu-print-6871';

async function draw() {
  const N = Number(arg('n') || 30);
  const { withMongo } = await import('../../../lib/mongo.mjs');
  const { VISIBLE_PAGE_MATCH } = await import('../../../lib/page-counts.mjs');
  const { getPageSource } = await import('../../../lib/page-image-url.mjs');
  const { isHeld, isUnsplitSpread } = await import('../../../lib/pipeline-hold.mjs');
  const { GPU_LANE_HOLDS, manuscriptReason, spreadReason } = await import('../../../batch/cli-ocr-lane.mjs');
  const { isEnglishBook, hasNoText, isHumanEdited, HOLD_REASON } = await import('../../../lib/gpu-print-lane.mjs');
  const { isInterior } = await import('../../ground-truth-5935/lib.mjs');
  const LANE_HOLDS = new Set([HOLD_REASON, ...GPU_LANE_HOLDS]);
  const NO_TEXT = { $or: [{ 'ocr.data': { $exists: false } }, { 'ocr.data': null }, { 'ocr.data': { $regex: /^\s*$/ } }] };
  const taken = new Set(JSON.parse(fs.readFileSync(path.join(GPU_LANE, 'frame-books.json'), 'utf8')).books.map((b) => b.bid));
  for (const f of fs.readdirSync(path.join(GPU_LANE, 'plan'))) taken.add(f.replace(/\.json$/, ''));
  fs.mkdirSync(path.join(OUT, 'lane'), { recursive: true });
  const tally = { books: 0, manuscript: 0, unsplit_spread: 0, other_hold: 0, in_1800_frame: 0, nothing_owed: 0, possible_spread_books: 0 };
  const frame = [], pages = [];
  await withMongo(async (db) => {
    const books = await db.collection('books').find(
      { visible: true, language: { $regex: '^English' }, year: { $gte: 1400, $lt: 1800 }, pages_count: { $gt: 0 } },
      { projection: { id: 1, title: 1, year: 1, published: 1, language: 1, pages_count: 1, pages_ocr: 1, image_source: 1, pipeline_auto: 1, needs_splitting: 1, split_completed: 1 } }).toArray();
    for (const b of books) {
      if (!isEnglishBook(b.language)) continue;
      tally.books++;
      if (isUnsplitSpread(b)) { tally.unsplit_spread++; continue; }
      if (manuscriptReason(b)) { tally.manuscript++; continue; }
      if (isHeld(b) ? !LANE_HOLDS.has(b.pipeline_auto.hold.reason) : b.pipeline_auto?.held === true) { tally.other_hold++; continue; }
      if (taken.has(b.id)) { tally.in_1800_frame++; continue; }
      const unread = (await db.collection('pages').find({ book_id: b.id, ...VISIBLE_PAGE_MATCH, ...NO_TEXT }, { projection: { _id: 0, id: 1, page_number: 1, ocr: 1, photo: 1, archived_photo: 1, cropped_photo: 1, enhanced_photo: 1, photo_original: 1, split_from_spread: 1, crop: 1 } }).sort({ page_number: 1 }).toArray())
        .filter((p) => !isHumanEdited(p.ocr) && hasNoText(p.ocr));
      if (!unread.length) { tally.nothing_owed++; continue; }
      const possibleSpread = !!spreadReason(b, unread);
      if (possibleSpread) tally.possible_spread_books++;
      frame.push({ bid: b.id, title: b.title, year: b.year, pages_count: b.pages_count, owed: unread.length, hold: isHeld(b) ? b.pipeline_auto.hold.reason : null, possible_spread: possibleSpread, provider: b.image_source?.provider ?? null, _unread: unread });
    }
  }, { timeoutMs: 3 * 3600 * 1000 });
  // One interior unread page per book, books in a seeded order (salt en-pre1800-6871).
  for (const b of [...frame].sort((x, y) => h(`en-pre1800-6871${x.bid}`).localeCompare(h(`en-pre1800-6871${y.bid}`)))) {
    if (pages.length >= N) break;
    const inner = b._unread.filter((p) => isInterior(p.page_number, b.pages_count) && getPageSource(p));
    if (!inner.length) continue;
    const p = inner.sort((x, y) => h(`en-pre1800-6871${x.id}`).localeCompare(h(`en-pre1800-6871${y.id}`)))[0];
    pages.push({ page_id: p.id, book_id: b.bid, page_number: p.page_number, year: b.year, hold: b.hold, provider: b.provider, possible_spread: b.possible_spread, title: String(b.title || '').slice(0, 80), src: getPageSource(p).replace(/\s+/g, '') });
  }
  const rows = frame.map(({ _unread, ...r }) => r);
  fs.writeFileSync(path.join(OUT, 'frame-books.json'), JSON.stringify({ built_at: new Date().toISOString(), rule: 'visible English, year 1400-1799, held under a GPU-lane hold or not held (pipeline_auto.held excluded), not a manuscript (cli-ocr-lane manuscriptReason), not an unsplit spread, not in the 1800+ frame, pages with no text', tally, books: rows }, null, 1));
  W('sample.json', { drawn_at: new Date().toISOString(), cells: { [CELL]: { lang: LANG, route: ROUTE, pages } } });
  fs.writeFileSync(path.join(OUT, 'lane', 'manifest.tsv'), pages.map((p) => [p.book_id, p.page_number, p.page_id, p.src].join('\t')).join('\n') + '\n');
  console.log(`frame ${rows.length} books, ${rows.reduce((s, r) => s + r.owed, 0)} pages with no text (${rows.filter((r) => r.hold).length} held, ${rows.filter((r) => !r.hold).length} not held); drew ${pages.length}`, tally);
}

async function written() {
  const { pageVerdict } = await import('../../../lib/gpu-print-lane.mjs');
  const s = J('sample.json').cells[CELL];
  const out = {};
  for (const p of s.pages) {
    const f = path.join(OUT, 'lane', 'out', p.book_id, `${p.page_number}`);
    if (fs.existsSync(`${f}.err`)) { out[p.page_id] = { why: 'read error' }; continue; }
    if (!fs.existsSync(`${f}.json`)) { out[p.page_id] = { why: 'not read' }; continue; }
    const r = JSON.parse(fs.readFileSync(`${f}.json`, 'utf8'));
    const v = pageVerdict(r.text, { finish: r.finish });
    out[p.page_id] = v.verdict === 'write' ? { text: v.body } : { why: `${v.verdict}:${v.reason}` };
  }
  W('written.json', out);
  return out;
}

async function packet() {
  const s = J('sample.json').cells[CELL], wr = await written();
  const items = new Map(), key = [];
  const add = (sp, kind, text, extra = {}) => {
    const tag = kind === 'item' ? `${CELL}:${sp.page_id}:${h(text.trim())}` : `${kind}:${CELL}:${ROUTE}:${sp.page_id}:${extra.other ?? ''}`;
    const id = `j${h(tag).slice(0, 10)}`;
    if (!items.has(id)) items.set(id, { id, task: 'ocr', lang: LANG, image_url: sp.src, text });
    key.push({ id: `k${h(`${kind}:${CELL}:${ROUTE}:${sp.page_id}:${extra.other ?? ''}`).slice(0, 10)}`, judged_as: id, cell: CELL, route: ROUTE, kind, page_id: sp.page_id, book_id: sp.book_id, page_number: sp.page_number, ...extra });
  };
  const ok = s.pages.filter((sp) => wr[sp.page_id]?.text);
  for (const sp of ok) add(sp, 'item', wr[sp.page_id].text);
  const rng = makeRng(parseInt(h(`wp-${CELL}-${ROUTE}`).slice(0, 8), 16));
  for (let i = 0; i < 2 && ok.length > 2; i++) {
    const a = ok[Math.floor(rng() * ok.length)]; let b = a;
    while (b.book_id === a.book_id) b = ok[Math.floor(rng() * ok.length)];
    add(a, 'wrong_page', wr[b.page_id].text, { other: b.page_id });
  }
  W('packet.json', { built_at: new Date().toISOString(), items: shuffled([...items.values()], 'pk-en-pre1800') });
  W('key.json', key);
  console.log(`${ok.length}/${s.pages.length} drawn pages written; ${items.size} items to judge; not written:`, Object.values(wr).filter((x) => x.why).map((x) => x.why));
}

const verdicts = () => new Map(jsonl(path.join(OUT, 'verdicts-opus.jsonl')).filter((r) => r.verdict).map((r) => [r.id, r.verdict]));

function plant() {
  const key = J('key.json'), pk = J('packet.json'), V = verdicts();
  if (key.some((k) => k.kind === 'planted')) { console.log('planted items already in the packet'); return; }
  // plant-ocr-errors.mjs has no English planter: kinds D (one printed line dropped) and B (one numeral changed) do not
  // depend on the language's word lists, so they run under the Latin planter's code; C and E (nouns, sentences) do.
  const kinds = ['D', 'B'];
  const acc = shuffled([...new Map(key.filter((k) => k.kind === 'item' && V.get(k.judged_as)?.accept).map((k) => [k.judged_as, k])).values()], `plant-${CELL}`);
  let got = 0;
  for (const k of acc) {
    if (got >= 2) break;
    const it = pk.items.find((x) => x.id === k.judged_as);
    for (let tries = 0; tries < 2; tries++) {
      const kind = kinds[(got + tries) % 2];
      const p = plantError(it.text, { kind, lang: 'Latin', seed: parseInt(h(`${k.judged_as}${kind}`).slice(0, 8), 16) });
      if (!p) continue;
      const id = `j${h(`planted:${k.judged_as}:${kind}`).slice(0, 10)}`;
      pk.items.push({ id, task: 'ocr', lang: LANG, image_url: it.image_url, text: p.text });
      key.push({ id: `k${h(`planted:${CELL}:${ROUTE}:${k.page_id}:${kind}`).slice(0, 10)}`, judged_as: id, cell: CELL, route: ROUTE, kind: 'planted', page_id: k.page_id, book_id: k.book_id, source_item: k.judged_as, plant: p.plant });
      got++; break;
    }
  }
  console.log(`${got} planted`);
  pk.items = shuffled(pk.items, 'pk-en-pre1800-planted');
  W('packet.json', pk); W('key.json', key);
}

function betaP(k, n, thr, seed) {
  const rnd = makeRng(seed);
  const normal = () => { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const gamma = (a) => { if (a < 1) return gamma(a + 1) * rnd() ** (1 / a); const d = a - 1 / 3, c = 1 / Math.sqrt(9 * d); for (;;) { let x, v; do { x = normal(); v = 1 + c * x; } while (v <= 0); v = v ** 3; const u = rnd(); if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v; } };
  let hit = 0; const M = 40000;
  for (let i = 0; i < M; i++) { const a = gamma(1 + k), b = gamma(1 + n - k); if (a / (a + b) >= thr) hit++; }
  return +(hit / M).toFixed(3);
}
const wt = (v) => (v?.defects || []).some((d) => d.severity === 'wrong_text');
const cls = (d) => String(d.class || '').toUpperCase().match(/^[IOTDE]\d+/)?.[0] ?? 'E2';

function score() {
  const s = J('sample.json').cells[CELL], key = J('key.json'), wr = J('written.json'), V = verdicts();
  const items = key.filter((k) => k.kind === 'item');
  const rows = s.pages.map((p) => {
    const k = items.find((x) => x.page_id === p.page_id), v = k ? V.get(k.judged_as) ?? null : null;
    return { page_id: p.page_id, book_id: p.book_id, year: p.year, hold: p.hold, possible_spread: p.possible_spread, written: !!wr[p.page_id]?.text, why: wr[p.page_id]?.why ?? null, judged: !!v, accept: !!v?.accept, wrong_text: wt(v), fidelity: v?.fidelity ?? null, defects: (v?.defects || []).map((d) => ({ class: cls(d), severity: d.severity, quote: String(d.quote || '').slice(0, 120), what: d.what })), reader_note: v?.reader_note ?? null };
  });
  const W_ = rows.filter((r) => r.written && r.judged), k = W_.filter((r) => r.accept).length, n = W_.length, wtN = W_.filter((r) => r.wrong_text).length;
  const drawnK = rows.filter((r) => r.accept).length;
  const wp = key.filter((x) => x.kind === 'wrong_page').map((x) => ({ page_id: x.page_id, ...(V.get(x.judged_as) ? { accept: V.get(x.judged_as).accept, fidelity: V.get(x.judged_as).fidelity } : { unjudged: true }) }));
  const control = wp.length === 2 && wp.every((x) => !x.unjudged && !x.accept && x.fidelity <= 2);
  const pl = key.filter((x) => x.kind === 'planted').map((x) => ({ kind: x.plant.kind, ...(V.get(x.judged_as) ? scorePlant(V.get(x.judged_as), x.plant) : { unjudged: true }) }));
  const plantsVoid = pl.length === 2 && pl.every((x) => !x.unjudged && !x.caught);
  const pAcc = betaP(k, n, 0.8, 6871);
  const top = {}; for (const r of W_) for (const d of r.defects) top[d.class] = (top[d.class] ?? 0) + 1;
  const eligible = control && !plantsVoid && n > 0 && wtN / n <= 0.04 && pAcc >= 0.9;
  const out = {
    scored_at: new Date().toISOString(), rule: 'RULE.md (committed before the judge stage)', judge: 'Opus (claude -p), route-judge-6740 judgePrompt against the page image, blind, shuffled',
    cell: CELL, route: ROUTE, drawn: rows.length, written: rows.filter((r) => r.written).length, judged_written: n, accepted_written: k, wrong_text_written: wtN,
    accepted_of_drawn: drawnK, p_acc_ge_0_8: pAcc, controls: { wrong_page: wp, wrong_page_passed: control, planted: pl, plants_void: plantsVoid },
    not_written: rows.filter((r) => !r.written).map((r) => r.why), top_defects: Object.entries(top).sort((a, b) => b[1] - a[1]).slice(0, 5),
    decision: eligible ? 'PASS: schedule English print before 1800 on the GPU print lane (lighton alone, the lane guards)' : 'FAIL: the cell keeps its current route (scans only); test next: gpu>agy-flash-low',
    rows,
  };
  W('score.json', out);
  const { rows: _r, ...head } = out;
  console.log(JSON.stringify(head, null, 1));
}

const STAGES = { draw, packet, plant, score, written };
if (!STAGES[STAGE]) { console.error('usage: run.mjs draw|packet|plant|score --out=DIR'); process.exit(2); }
await STAGES[STAGE]();
