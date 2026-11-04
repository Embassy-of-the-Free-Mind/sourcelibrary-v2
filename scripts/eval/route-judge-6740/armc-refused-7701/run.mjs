#!/usr/bin/env node
// PRIOR ART: scripts/eval/route-judge-6740/cheap-routes-7701/run.mjs (written/packet/plant/score/apply around judge.mjs's
// `judge`, and the helpers copied here) and german-cheaper-7701/run.mjs (the same copied per test). They draw a page and
// READ it per route; this test spends no read: it draws pages the arm c lane REFUSED, from the ledger, and judges the
// read the lane kept. judge.mjs's `judge` stage is called unchanged. See RULE.md beside the results.
/**
 * #7701 arm c's refused reads (job armc-refused-judge-7701). Read-only except `apply --apply`.
 *   node --env-file=… run.mjs census  --out=DIR --ledger=FILE    usable kept reads of refused pages, by reason
 *   node --env-file=… run.mjs draw    --out=DIR                  15 + 15 pages, one per book; copies their reads
 *   node --env-file=… run.mjs written --out=DIR                  dry apply: the exact text the route would write
 *   node --env-file=… run.mjs packet  --out=DIR                  blind items + 2 wrong-page controls a stratum
 *   ROUTE_JUDGE_WEEKLY_MAX=99 node judge.mjs judge --out=DIR --concurrency=1
 *   node run.mjs plant --out=DIR                                 2 planted items a stratum, then judge again
 *   node run.mjs score --out=DIR                                 RULE.md's measures and decision -> DIR/score.json
 *   node --env-file=… run.mjs apply --out=DIR [--apply]          the accepted pages, through cli-ocr.mjs apply
 *   node run.mjs rates --out=DIR                                 defects per 1,000 words and fidelity -> DIR/defect-rates.json
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeRng } from '../../lib/paired-stats.mjs';
import { plantError, scorePlant } from '../../lib/plant-ocr-errors.mjs';
import { words } from '../defect-rate.mjs';

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const STAGE = process.argv[2];
const OUT = path.resolve(arg('out') || '.');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const LANE_DIR = arg('lane-dir') || '/root/jobs/armc-first-read-7701';
const SEED = 'armc-refused-7701';
const PER_STRATUM = 15;
const h = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const J = (f) => JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8'));
const W = (f, x) => fs.writeFileSync(path.join(OUT, f), JSON.stringify(x, null, 1));
const jsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const CLI_OCR = path.join(ROOT, 'scripts/batch/cli-ocr.mjs');
const ROUTE = 'pero>agy-flash-low-kept';
const dirOf = (cell) => path.join(OUT, 'corr', cell);
export const CELLS = { 'la-armc-refused-share': { lang: 'Latin' }, 'la-armc-refused-putback': { lang: 'Latin' } };
export const stratumOf = (r) => (r.outcome === 'put_back_unsafe' ? 'la-armc-refused-putback' : r.outcome === 'other' && /^only \d+% of its words are in the GPU draft/.test(r.why) ? 'la-armc-refused-share' : null);
const reasonOf = (r) => r.why.replace(/\d+/g, 'N');

/** Every local read of a page, newest first; a read counts as usable only as RULE.md says. */
function localIndex() {
  const idx = new Map(), runs = path.join(LANE_DIR, 'runs');
  for (const date of fs.readdirSync(runs).sort().reverse()) for (const book of fs.readdirSync(path.join(runs, date))) {
    const d = path.join(runs, date, book);
    if (!fs.statSync(d).isDirectory()) continue;
    for (const f of fs.readdirSync(d)) if (f.endsWith('.meta.json')) { const id = f.slice(0, -10); if (!idx.has(id)) idx.set(id, d); }
  }
  return idx;
}
function usable(d, id) {
  if (!d) return { ok: false, why: 'no local read' };
  let m; try { m = JSON.parse(fs.readFileSync(path.join(d, `${id}.meta.json`), 'utf8')); } catch { return { ok: false, why: 'no meta' }; }
  if (m.exit !== 0) return { ok: false, why: `exit ${m.exit}` };
  if (m.error_class) return { ok: false, why: `error ${m.error_class}` };
  if (m.wrapper) return { ok: false, why: 'wrapper' };
  let t = ''; try { t = fs.readFileSync(path.join(d, `${id}.txt`), 'utf8').trim(); } catch { return { ok: false, why: 'no text' }; }
  if (t.length < 5) return { ok: false, why: 'empty' };
  return { ok: true, meta: m, chars: t.length };
}

async function census() {
  const ledger = jsonl(arg('ledger')), { MongoClient } = await import('mongodb');
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  const pages = c.db('bookstore').collection('pages'), idx = localIndex();
  const refused = ledger.filter((r) => r.outcome !== 'written'), ids = refused.map((r) => r.page_id), read = new Set();
  for (let i = 0; i < ids.length; i += 2000) for await (const p of pages.find({ id: { $in: ids.slice(i, i + 2000) } }, { projection: { id: 1, has: { $and: [{ $eq: [{ $type: '$ocr.data' }, 'string'] }, { $gt: [{ $strLenCP: { $trim: { input: '$ocr.data' } } }, 0] }] } } }).batchSize(1000)) if (p.has) read.add(p.id);
  await c.close();
  const rows = {};
  const usableRows = [];
  for (const r of refused) {
    const x = (rows[reasonOf(r)] ??= { outcome: r.outcome, pages: 0, read_in_mongo_now: 0, unread_now: 0, kept_usable_unread: 0, books: new Set(), not_usable: {} });
    x.pages++;
    if (read.has(r.page_id)) { x.read_in_mongo_now++; continue; }
    x.unread_now++;
    const u = usable(idx.get(r.page_id), r.page_id);
    if (u.ok) { x.kept_usable_unread++; x.books.add(r.book_id); usableRows.push({ ...r, dir: idx.get(r.page_id), chars: u.chars }); } else x.not_usable[u.why] = (x.not_usable[u.why] || 0) + 1;
  }
  for (const x of Object.values(rows)) x.books = x.books.size;
  W('census.json', { at: new Date().toISOString(), ledger_rows: ledger.length, refused: refused.length, written: ledger.filter((r) => r.outcome === 'written').length, by_reason: rows });
  fs.writeFileSync(path.join(OUT, 'frame.jsonl'), usableRows.filter(stratumOf).map((r) => JSON.stringify(r)).join('\n') + '\n');
  console.table(Object.fromEntries(Object.entries(rows).map(([k, x]) => [k.slice(0, 60), { pages: x.pages, read: x.read_in_mongo_now, unread: x.unread_now, usable: x.kept_usable_unread, books: x.books }])));
}

function dryApply(cell, ids) {
  const dir = dirOf(cell), emit = path.join(dir, 'written-dry.jsonl'), only = path.join(dir, 'only-drawn.json');
  fs.rmSync(emit, { force: true }); fs.writeFileSync(only, JSON.stringify(ids));
  const r = spawnSync(process.execPath, ['--no-warnings', CLI_OCR, 'apply', `--out=${dir}`, `--only=${only}`, '--print-only', '--reason=#7701 armc-refused cell test (dry run)', `--emit-written=${emit}`], { cwd: ROOT, env: process.env, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`apply ${cell}: exit ${r.status}\n${r.stderr?.slice(-2000)}`);
  const sum = JSON.parse(fs.readFileSync(path.join(dir, 'apply-summary-dry.json'), 'utf8'));
  return { rows: new Map(jsonl(emit).map((x) => [x.page_id, x.text])), skipped: sum.skipped_pages || {} };
}

/** Seeded walk of the page frame: page-weighted, one page per book over the WHOLE test. */
function draw() {
  const frame = jsonl(path.join(OUT, 'frame.jsonl')), used = new Set(), cells = {}, ORDER_LEN = PER_STRATUM + 25;
  for (const cell of Object.keys(CELLS)) {
    const rows = frame.filter((r) => stratumOf(r) === cell).sort((a, b) => h(`${SEED}:${a.page_id}`).localeCompare(h(`${SEED}:${b.page_id}`)));
    const take = [];
    for (const r of rows) { if (take.length >= ORDER_LEN) break; if (used.has(r.book_id)) continue; used.add(r.book_id); take.push(r); }
    cells[cell] = { frame_pages: rows.length, frame_books: new Set(rows.map((r) => r.book_id)).size, ordered: take };
    const d = dirOf(cell); fs.mkdirSync(d, { recursive: true });
    for (const r of take) for (const f of [...fs.readdirSync(r.dir).filter((x) => x.startsWith(`${r.page_id}.`)), 'prompt-ref.json', 'correct-prompt-template.txt']) fs.copyFileSync(path.join(r.dir, f), path.join(d, f));
  }
  W('draw-order.json', cells);
  for (const [c, x] of Object.entries(cells)) console.log(`${c}: ${x.frame_pages} pages, ${x.frame_books} books, ${x.ordered.length} in order`);
}

/** The first 15 of each stratum's order that the route can write; a page it cannot write is counted, then passed over. */
function written() {
  const order = J('draw-order.json'), sample = { seed: SEED, cells: {} }, out = {};
  for (const [cell, x] of Object.entries(order)) {
    const d = dryApply(cell, x.ordered.map((r) => r.page_id)), pages = [], passed = [];
    out[cell] = { [ROUTE]: {} };
    for (const r of x.ordered) {
      const text = d.rows.get(r.page_id);
      if (pages.length < PER_STRATUM && text) { pages.push({ page_id: r.page_id, book_id: r.book_id, page_number: r.page_number, why: r.why, run: r.run, dir: r.dir }); out[cell][ROUTE][r.page_id] = { text }; } else if (pages.length < PER_STRATUM) passed.push({ page_id: r.page_id, why: d.skipped[r.page_id] ?? 'not emitted' });
    }
    sample.cells[cell] = { frame_pages: x.frame_pages, frame_books: x.frame_books, pages, passed_over: passed };
    console.log(`${cell}: ${pages.length} pages, ${passed.length} passed over`, passed.map((p) => p.why));
  }
  W('sample.json', sample); W('written.json', out);
}

function shuffled(xs, salt) { return [...xs].sort((a, b) => h(salt + JSON.stringify(a.id ?? a)).localeCompare(h(salt + JSON.stringify(b.id ?? b)))); }

async function packet() {
  const { MongoClient } = await import('mongodb');
  const { getPageSource } = await import('../../../lib/page-image-url.mjs');
  const s = J('sample.json'), wr = J('written.json');
  const all = Object.values(s.cells).flatMap((c) => c.pages.map((p) => p.page_id));
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  const pages = new Map((await c.db('bookstore').collection('pages').find({ id: { $in: all } }, { projection: { id: 1, book_id: 1, page_number: 1, archived_photo: 1, cropped_photo: 1, split_from_spread: 1, photo: 1, enhanced_photo: 1, photo_original: 1, crop: 1 } }).toArray()).map((p) => [p.id, p]));
  await c.close();
  const items = new Map(), key = [], imgCheck = [];
  const add = (cell, sp, kind, text, extra = {}) => {
    const tag = kind === 'item' ? `${cell}:${sp.page_id}:${h(text.trim())}` : `${kind}:${cell}:${sp.page_id}:${extra.other ?? ''}`;
    const id = `j${h(tag).slice(0, 10)}`;
    items.set(id, { id, task: 'ocr', lang: CELLS[cell].lang, image_url: getPageSource(pages.get(sp.page_id)), text });
    key.push({ id: `k${h(`${kind}:${cell}:${sp.page_id}:${extra.other ?? ''}`).slice(0, 10)}`, judged_as: id, cell, route: ROUTE, kind, page_id: sp.page_id, book_id: sp.book_id, page_number: sp.page_number, ...extra });
  };
  for (const [cell, x] of Object.entries(s.cells)) {
    const sps = x.pages;
    for (const sp of sps) {
      add(cell, sp, 'item', wr[cell][ROUTE][sp.page_id].text);
      const m = JSON.parse(fs.readFileSync(path.join(dirOf(cell), `${sp.page_id}.meta.json`), 'utf8'));
      const res = await fetch(getPageSource(pages.get(sp.page_id))), buf = res.ok ? Buffer.from(await res.arrayBuffer()) : null;
      imgCheck.push({ page_id: sp.page_id, served: res.status, same_bytes_as_read: buf ? h2(buf) === m.image_sha256 : null, read_url: m.image_url, tool_calls: m.tool_calls });
    }
    const rng = makeRng(parseInt(h(`wp-${cell}`).slice(0, 8), 16));
    for (let i = 0; i < 2 && sps.length > 2; i++) {
      const a = sps[Math.floor(rng() * sps.length)]; let b = a;
      while (b.book_id === a.book_id) b = sps[Math.floor(rng() * sps.length)];
      add(cell, a, 'wrong_page', wr[cell][ROUTE][b.page_id].text, { other: b.page_id });
    }
  }
  W('image-check.json', imgCheck);
  W('packet.json', { built_at: new Date().toISOString(), items: shuffled([...items.values()], 'pk-armc-refused') });
  W('key.json', key);
  console.log(`${items.size} items (${key.filter((k) => k.kind === 'wrong_page').length} wrong-page); images same as read: ${imgCheck.filter((x) => x.same_bytes_as_read).length}/${imgCheck.length}`);
}
const h2 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

const verdicts = () => new Map(jsonl(path.join(OUT, 'verdicts-opus.jsonl')).filter((r) => r.verdict).map((r) => [r.id, r.verdict]));
const wt = (v) => (v?.defects || []).some((d) => d.severity === 'wrong_text');

/** Two planted items a stratum, kinds rotating B, C, D, E; on an accepted output, else on the highest-fidelity one. */
function plant() {
  const key = J('key.json'), pk = J('packet.json'), V = verdicts();
  if (key.some((k) => k.kind === 'planted')) { console.log('planted items already in the packet'); return; }
  const kinds = ['B', 'C', 'D', 'E']; let slot = 0;
  for (const [cell, C] of Object.entries(CELLS)) {
    const rows = key.filter((k) => k.cell === cell && k.kind === 'item' && V.get(k.judged_as));
    const pool = shuffled(rows, `plant-${cell}`).sort((a, b) => Number(!!V.get(b.judged_as).accept) - Number(!!V.get(a.judged_as).accept) || V.get(b.judged_as).fidelity - V.get(a.judged_as).fidelity);
    let got = 0;
    for (const k of pool) {
      if (got >= 2) break;
      const it = pk.items.find((x) => x.id === k.judged_as);
      for (let tries = 0; tries < 4; tries++) {
        const kind = kinds[(slot + tries) % 4];
        const p = plantError(it.text, { kind, lang: C.lang, seed: parseInt(h(`${k.judged_as}${kind}`).slice(0, 8), 16) });
        if (!p) continue;
        const id = `j${h(`planted:${k.judged_as}:${kind}`).slice(0, 10)}`;
        pk.items.push({ id, task: 'ocr', lang: C.lang, image_url: it.image_url, text: p.text });
        key.push({ id: `k${h(`planted:${cell}:${k.page_id}:${kind}`).slice(0, 10)}`, judged_as: id, cell, route: ROUTE, kind: 'planted', page_id: k.page_id, book_id: k.book_id, source_item: k.judged_as, source_accepted: !!V.get(k.judged_as).accept, plant: p.plant });
        got++; slot++; break;
      }
    }
    console.log(`${cell}: ${got} planted`);
  }
  pk.items = shuffled(pk.items, 'pk-armc-refused-planted');
  W('packet.json', pk); W('key.json', key);
}

// the score.js of cheap-routes: Beta(1 + k, 1 + n - k), Monte Carlo over gammas
function betaP(k, n, thr, seed) {
  const rnd = makeRng(seed);
  const normal = () => { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const gamma = (a) => { if (a < 1) return gamma(a + 1) * rnd() ** (1 / a); const d = a - 1 / 3, c = 1 / Math.sqrt(9 * d); for (;;) { let x, v; do { x = normal(); v = 1 + c * x; } while (v <= 0); v = v ** 3; const u = rnd(); if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v; } };
  let hit = 0; const N = 40000; for (let i = 0; i < N; i++) { const a = gamma(1 + k), b = gamma(1 + n - k); if (a / (a + b) >= thr) hit++; }
  return +(hit / N).toFixed(3);
}
const cls = (d) => String(d.class || '').toUpperCase().match(/^[IOTDE]\d+/)?.[0] ?? 'E2';

function score() {
  const s = J('sample.json'), key = J('key.json'), V = verdicts();
  const out = { scored_at: new Date().toISOString(), rule: 'RULE.md (committed before the judge stage)', judge: 'claude-opus-5-5 (claude -p), route-judge-6740 judgePrompt against the page image, blind, shuffled, one at a time', cells: {} };
  let seed = 77011;
  for (const [cell, x] of Object.entries(s.cells)) {
    const rows = x.pages.map((sp) => { const k = key.find((y) => y.cell === cell && y.kind === 'item' && y.page_id === sp.page_id), v = k && V.get(k.judged_as);
      return { page_id: sp.page_id, book_id: sp.book_id, page_number: sp.page_number, refusal: sp.why, judged: !!v, accept: !!v?.accept, wrong_text: wt(v), fidelity: v?.fidelity ?? null, defects: (v?.defects || []).map((d) => ({ class: cls(d), severity: d.severity, quote: String(d.quote).slice(0, 100), what: String(d.what ?? '').slice(0, 120) })), note: v?.reader_note ?? null }; });
    const j = rows.filter((r) => r.judged), n = j.length, kk = j.filter((r) => r.accept).length, w = j.filter((r) => r.wrong_text).length;
    const cp = key.filter((k) => k.cell === cell && k.kind === 'wrong_page').map((k) => V.get(k.judged_as));
    const control = { n: cp.length, refused: cp.filter((v) => v && !v.accept && Number(v.fidelity) <= 2).length };
    const pl = key.filter((k) => k.cell === cell && k.kind === 'planted').map((k) => ({ kind: k.plant.kind, source_accepted: k.source_accepted, ...(V.get(k.judged_as) ? scorePlant(V.get(k.judged_as), k.plant) : { unjudged: true }) }));
    const p = betaP(kk, n, 0.8, seed++);
    const classes = {}, sev = {};
    for (const r of j) { for (const c of new Set(r.defects.map((d) => d.class))) classes[c] = (classes[c] || 0) + 1; for (const d of r.defects) sev[d.severity] = (sev[d.severity] || 0) + 1; }
    const hist = {}; for (const r of j) hist[r.fidelity] = (hist[r.fidelity] || 0) + 1;
    const voided = cp.length < 2 || control.refused < cp.length || (pl.length >= 2 && pl.every((y) => !y.unjudged && !y.caught));
    const route = !voided && w === 0 && p >= 0.8 ? 'apply the kept read' : 're-read with read@4';
    out.cells[cell] = { frame_pages: x.frame_pages, frame_books: x.frame_books, n, accept: `${kk}/${n}`, wrong_text_pages: `${w}/${n}`, p_acc_ge_080: p, fidelity: hist, classes_pages: Object.fromEntries(Object.entries(classes).sort((a, b) => b[1] - a[1])), severity_defects: sev, control, planted: { n: pl.length, caught: pl.filter((y) => y.caught).length, detail: pl }, voided, route, rows };
    console.log(`${cell}: ${kk}/${n} wrong text ${w} P80 ${p} ctrl ${control.refused}/${control.n} planted ${pl.filter((y) => y.caught).length}/${pl.length} -> ${route}`);
    console.log('  fidelity', hist, 'classes', out.cells[cell].classes_pages, 'severity', sev);
  }
  W('score.json', out);
}

/** The accepted pages with no wrong-text defect, written by cli-ocr.mjs apply (RULE.md: Writes). */
function apply() {
  const sc = J('score.json'), APPLY = process.argv.includes('--apply'), res = {};
  for (const [cell, x] of Object.entries(sc.cells)) {
    const ids = x.rows.filter((r) => r.accept && !r.wrong_text).map((r) => r.page_id), dir = dirOf(cell), only = path.join(dir, 'only-best.json');
    if (!ids.length) { res[cell] = { pages: 0 }; continue; }
    fs.writeFileSync(only, JSON.stringify(ids));
    const r = spawnSync(process.execPath, ['--no-warnings', CLI_OCR, 'apply', `--out=${dir}`, `--only=${only}`, '--first-read-only', '--print-only', '--reason=#7701 armc-refused cell test: the arm c read the #7695 guards refused, written because a blind Opus judge accepted it against the image (job armc-refused-judge-7701)', ...(APPLY ? ['--apply'] : [])], { cwd: ROOT, env: process.env, encoding: 'utf8' });
    const tail = r.stdout.trim().split('\n').filter((l) => /^(written|would write)|run id|run_id/i.test(l));
    res[cell] = { pages: ids.length, ids, exit: r.status, summary: tail, stderr: r.stderr?.slice(-400) };
    console.log(`${cell}: ${ids.length} -> ${tail.join(' | ')}`);
  }
  W(`apply-${APPLY ? 'done' : 'dry'}.json`, res);
}

const stages = { census, draw, written, packet, plant, score, apply, rates };
/** The per-1,000-words reading eval-design.md 10.3 asks for. Beside the k/n rule of RULE.md: it does not move that decision. */
function rates() {
  const score = J('score.json'), written = J('written.json'), live = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/eval/estimator/router-table/defect-rates.json'), 'utf8')).cells['latin-blank'];
  const pick = (x) => Object.fromEntries(['pages', 'books', 'words', 'fidelity_mean', 'cosmetic_per_1k', 'misleads_per_1k', 'wrong_text_per_1k'].map((k) => [k, x[k]]));
  const study_cells = {};
  for (const [cell, x] of Object.entries(score.cells)) {
    const rows = x.rows.filter((r) => r.judged), n = (s) => rows.reduce((a, r) => a + r.defects.filter((d) => d.severity === s).length, 0);
    const w = rows.reduce((a, r) => a + words(written[cell][ROUTE][r.page_id].text), 0), per1k = (s) => Math.round((n(s) / w) * 1e6) / 1e3;
    study_cells[cell] = { route: ROUTE, pages: rows.length, books: new Set(rows.map((r) => r.book_id)).size, words: w, fidelity_mean: Math.round((rows.reduce((a, r) => a + r.fidelity, 0) / rows.length) * 100) / 100, cosmetic_per_1k: per1k('cosmetic'), misleads_per_1k: per1k('misleads'), wrong_text_per_1k: per1k('wrong_text') };
  }
  W('defect-rates.json', { _about: 'Defects per 1,000 words of the kept reads arm c refused (#7701), from the stored Opus verdicts, without the recheck calibration or by-book intervals of defect-rate.py (n = 15 a stratum). The decision is the k/n rule of RULE.md.', study_cells, router_table_latin_blank: { 'pero>agy-flash-low-written': pick(live['pero>agy-flash-low-written']), 'agy-flash-low@4-written': pick(live['agy-flash-low@4-written']) } });
  console.log(JSON.stringify(study_cells));
}

if (!stages[STAGE]) { console.error(`usage: run.mjs ${Object.keys(stages).join('|')} --out=DIR`); process.exit(2); }
await stages[STAGE]();
