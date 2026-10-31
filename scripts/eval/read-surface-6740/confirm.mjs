#!/usr/bin/env node
// PRIOR ART: scripts/eval/route-judge-6740/german-cheaper-7701/run.mjs (#7701 German cheaper routes: dry-apply written
// set, blind packet with wrong-page controls, planted controls, RULE.md score with the paired Dirichlet gate, router
// evidence) — copied here and cut to the #6740 read-surface confirmation: one Latin cell, two agy routes, no GPU route,
// no face split (every drawn Latin page is roman type), and no apply (Latin first reads are arm c, #7752: these reads
// are evidence, not writes). judge.mjs's `draw`, `correct` and `judge` stages are used unchanged.
/**
 * #6740 read-surface confirmation (job read-surface-6740): the read at the live knobs (4 a call, image as served, low)
 * against the response surface's Latin optimum (8 a call, image fitted to 1,600 px, low) on the SAME 30 new queue
 * pages. Rule: scripts/eval/read-surface-6740/confirm/RULE.md (committed before any confirmation read).
 *
 *   node --env-file=… confirm.mjs written  --out=DIR       dry applies: the text each route would WRITE on each drawn page
 *   node --env-file=… confirm.mjs packet   --out=DIR       blind, shuffled items + 2 wrong-page controls a route
 *   ROUTE_JUDGE_WEEKLY_MAX=99 node judge.mjs judge --out=DIR
 *   node confirm.mjs plant    --out=DIR                    two planted items on accepted outputs
 *   ROUTE_JUDGE_WEEKLY_MAX=99 node judge.mjs judge --out=DIR
 *   node confirm.mjs score    --out=DIR                    RULE.md's measures and decision -> DIR/score.json
 *   node confirm.mjs evidence --out=DIR                    router evidence (cell la-surface)
 * Read-only: writes nothing to Mongo.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeRng } from '../lib/paired-stats.mjs';
import { plantError, scorePlant } from '../lib/plant-ocr-errors.mjs';

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const STAGE = process.argv[2];
const OUT = path.resolve(arg('out') || '.');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const h = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const J = (f) => JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8'));
const W = (f, x) => fs.writeFileSync(path.join(OUT, f), JSON.stringify(x, null, 1));
const jsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const slug = (route) => route.replace(/[^a-z0-9]+/gi, '_');
// --cell=de-surface (Amendment 6, confirm-de/RULE.md): German, O = 8 a call at the served image, judged by quota cost.
const CELL = arg('cell') || 'la-surface';
const DE = CELL === 'de-surface';
const LANG = DE ? 'German' : 'Latin';
const OPT = DE ? 'agy-flash-low@8' : 'agy-flash-low@8-1600px';
const dirOf = (route) => path.join(OUT, 'corr', CELL, slug(route));
const CLI_OCR = path.join(ROOT, 'scripts/batch/cli-ocr.mjs');
const AGY_USD = 0.00087;                       // the #6740 fee basis: $200 a month, 4.36e-6 of a month a call
const GPU_USD_PER_SEC = 249 / (30 * 86400);    // gex45 at $249 a month

// kind: read = a fresh agy read (written by apply --first-read-only --print-only); gpu = a GPU draft corrected by agy
// (written by the GPU-draft apply with --diff-guard=gpu-draft); draft = the GPU draft ALONE (no agy call), written when
// it passes the GPU-draft floor (30 word characters, cli-ocr.mjs) and the lane's print checks (gpuAloneWritten).
export const ROUTES = {
  'agy-flash-low@4': { kind: 'read', live: true },
  [OPT]: { kind: 'read' },
};
// Amendment 6.2: quota cost, agy usage priced at gemini-3.8-flash list rates (output includes thinking).
const RATE = { input: 0.75e-6, cached: 0.075e-6, output: 3.75e-6 };
const usdOf = (u) => (u ? ((u.input || 0) - (u.cache_read || 0)) * RATE.input + (u.cache_read || 0) * RATE.cached + (u.output || 0) * RATE.output : 0);
const LIVE = 'agy-flash-low@4';
const LATER_READ = /the page has OCR now|OCR was rewritten after this read/;

// ── written ──
function dryApply(route, ids, extra) {
  const dir = dirOf(route), emit = path.join(dir, 'written-dry.jsonl'), only = path.join(dir, 'only-drawn.json');
  fs.rmSync(emit, { force: true }); fs.writeFileSync(only, JSON.stringify(ids));
  const r = spawnSync(process.execPath, ['--no-warnings', CLI_OCR, 'apply', `--out=${dir}`, `--only=${only}`, '--reason=#6740 read-surface confirmation (dry run)', `--emit-written=${emit}`, ...extra], { cwd: ROOT, env: process.env, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`apply ${route}: exit ${r.status}\n${r.stderr?.slice(-2000)}`);
  const sum = JSON.parse(fs.readFileSync(path.join(dir, 'apply-summary-dry.json'), 'utf8'));
  return { rows: new Map(jsonl(emit).map((x) => [x.page_id, x.text])), skipped: sum.skipped_pages || {}, diff_guard: sum.diff_guard ?? null };
}
const readText = (route, id) => {
  const d = dirOf(route);
  try { const m = JSON.parse(fs.readFileSync(path.join(d, `${id}.meta.json`), 'utf8')); if (m.exit !== 0 || m.error_class || m.wrapper) return null; } catch { return null; }
  const t = fs.readFileSync(path.join(d, `${id}.txt`), 'utf8').trim(); return t || null;
};

/**
 * A GPU draft ALONE as a first read: written when it clears what a GPU-only lane would ask of it before any write —
 * cli-ocr.mjs's GPU-draft floor (30 word characters) and gpu-print-lane's loop guard (a line repeated 4+ times in a row,
 * or the draft cut at the token limit: finish = length). No image check, no model: that is the route.
 */
function gpuAloneWritten(d) {
  if (!d?.text || d.text.replace(/\W/g, '').length < 30) return { why: 'GPU draft under 30 word characters' };
  if (d.finish === 'length') return { why: 'GPU draft cut at the token limit (loop)' };
  const lines = d.text.split('\n').map((l) => l.trim()).filter(Boolean);
  for (let i = 3; i < lines.length; i++) if (lines[i].length > 3 && lines[i] === lines[i - 1] && lines[i] === lines[i - 2] && lines[i] === lines[i - 3]) return { why: 'GPU draft repeats a line 4 times (loop)' };
  return { text: d.text.trim() };
}

function written() {
  const s = J('sample.json'), ids = s.cells[CELL].pages.map((p) => p.page_id), out = {};
  for (const [route, R] of Object.entries(ROUTES)) {
    if (R.kind === 'draft') {
      const f = path.join(OUT, R.file), drafts = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {};
      const faceOf = new Map(s.cells[CELL].pages.map((p) => [p.page_id, p.script_face]));
      out[route] = Object.fromEntries(ids.filter((id) => !R.faces || R.faces.includes(faceOf.get(id))).map((id) => [id, drafts[id] ? gpuAloneWritten(drafts[id]) : { why: 'no GPU draft' }]));
    } else {
      if (!fs.existsSync(dirOf(route))) { console.log(`${route}: not read yet`); continue; }
      const extra = R.kind === 'read' ? ['--first-read-only', '--print-only'] : ['--diff-guard=gpu-draft', '--print-only'];
      const d = dryApply(route, ids, extra);
      const faceOf = new Map(s.cells[CELL].pages.map((p) => [p.page_id, p.script_face]));
      out[route] = Object.fromEntries(ids.filter((id) => !R.faces || R.faces.includes(faceOf.get(id))).map((id) => {
        if (d.rows.has(id)) return [id, { text: d.rows.get(id) }];
        const why = d.skipped[id] ?? 'not read';
        // the live lane read the page after this test did: the page was unread when read, so it counts
        if (LATER_READ.test(why) && readText(route, id) && R.kind === 'read') return [id, { text: readText(route, id), later_read: why }];
        return [id, { why }];
      }));
      if (d.diff_guard) out[`${route}#diff_guard`] = d.diff_guard;
    }
    const v = Object.values(out[route]);
    console.log(`${route}: written ${v.filter((x) => x.text).length}/${v.length}`);
  }
  W('written.json', { [CELL]: out });
}

function shuffled(xs, salt) { return [...xs].sort((a, b) => h(salt + JSON.stringify(a.id ?? a)).localeCompare(h(salt + JSON.stringify(b.id ?? b)))); }

async function packet() {
  const { MongoClient } = await import('mongodb');
  const { getPageSource } = await import('../../lib/page-image-url.mjs');
  const s = J('sample.json'), wr = J('written.json')[CELL], sps = s.cells[CELL].pages;
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  const pages = new Map((await c.db('bookstore').collection('pages').find({ id: { $in: sps.map((p) => p.page_id) } }, { projection: { id: 1, book_id: 1, page_number: 1, archived_photo: 1, cropped_photo: 1, split_from_spread: 1, photo: 1, enhanced_photo: 1, photo_original: 1, crop: 1 } }).toArray()).map((p) => [p.id, p]));
  await c.close();
  if (fs.existsSync(path.join(OUT, 'key.json')) && J('key.json').some((k) => k.kind === 'planted')) throw new Error('packet: planted items exist; rebuilding would drop them');
  const items = new Map(), key = [];
  const add = (route, sp, kind, text, extra = {}) => {
    const tag = kind === 'item' ? `${CELL}:${sp.page_id}:${h(text.trim())}` : `${kind}:${CELL}:${route}:${sp.page_id}:${extra.other ?? ''}`;
    const id = `j${h(tag).slice(0, 10)}`;
    if (!items.has(id)) items.set(id, { id, task: 'ocr', lang: LANG, image_url: getPageSource(pages.get(sp.page_id)), text });
    key.push({ id: `k${h(`${kind}:${CELL}:${route}:${sp.page_id}:${extra.other ?? ''}`).slice(0, 10)}`, judged_as: id, cell: CELL, route, kind, page_id: sp.page_id, book_id: sp.book_id, page_number: sp.page_number, script_face: sp.script_face, ...extra });
  };
  for (const route of Object.keys(ROUTES).filter((r) => wr[r])) {
    const ok = sps.filter((sp) => wr[route][sp.page_id]?.text);   // a face-limited route (kraken) has rows on its face only
    for (const sp of ok) add(route, sp, 'item', wr[route][sp.page_id].text);
    // two wrong-page controls: this page's image, this route's written text of a page of ANOTHER book
    const rng = makeRng(parseInt(h(`wp-${CELL}-${route}`).slice(0, 8), 16));
    for (let i = 0; i < 2 && ok.length > 2; i++) {
      const a = ok[Math.floor(rng() * ok.length)]; let b = a;
      while (b.book_id === a.book_id) b = ok[Math.floor(rng() * ok.length)];
      add(route, a, 'wrong_page', wr[route][b.page_id].text, { other: b.page_id });
    }
  }
  W('packet.json', { built_at: new Date().toISOString(), items: shuffled([...items.values()], 'pk-read-surface-6740') });
  W('key.json', key);
  console.log(`${items.size} items to judge (${key.filter((k) => k.kind === 'wrong_page').length} wrong-page controls), ${key.length} key rows`);
}

const verdicts = () => new Map(jsonl(path.join(OUT, 'verdicts-opus.jsonl')).filter((r) => r.verdict).map((r) => [r.id, r.verdict]));

/** plant: two planted items per script face, on outputs the judge accepted (kinds rotating B, C, D, E). */
function plant() {
  const key = J('key.json'), pk = J('packet.json'), V = verdicts();
  if (key.some((k) => k.kind === 'planted')) { console.log('planted items already in the packet'); return; }
  const kinds = ['B', 'C', 'D', 'E'];
  let slot = 0;
  for (const face of ['all']) {
    const acc = shuffled([...new Map(key.filter((k) => k.kind === 'item' && V.get(k.judged_as)?.accept).map((k) => [k.judged_as, k])).values()], `plant-${face}`);
    let got = 0;
    for (const k of acc) {
      if (got >= 2) break;
      const it = pk.items.find((x) => x.id === k.judged_as);
      for (let tries = 0; tries < 4; tries++) {
        const kind = kinds[(slot + tries) % 4];
        const p = plantError(it.text, { kind, lang: LANG, seed: parseInt(h(`${k.judged_as}${kind}`).slice(0, 8), 16) });
        if (!p) continue;
        const id = `j${h(`planted:${k.judged_as}:${kind}`).slice(0, 10)}`;
        pk.items.push({ id, task: 'ocr', lang: LANG, image_url: it.image_url, text: p.text });
        key.push({ id: `k${h(`planted:${CELL}:${k.route}:${k.page_id}:${kind}`).slice(0, 10)}`, judged_as: id, cell: CELL, route: k.route, kind: 'planted', page_id: k.page_id, book_id: k.book_id, script_face: face, source_item: k.judged_as, plant: p.plant });
        got++; slot++; break;
      }
    }
    console.log(`${face}: ${got} planted`);
  }
  pk.items = shuffled(pk.items, 'pk-read-surface-6740-planted');
  W('packet.json', pk); W('key.json', key);
}

// ── score ──
function gammaSampler(seed) {
  const rnd = makeRng(seed);
  const normal = () => { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const gamma = (a) => { if (a < 1) return gamma(a + 1) * rnd() ** (1 / a); const d = a - 1 / 3, c = 1 / Math.sqrt(9 * d); for (;;) { let x, v; do { x = normal(); v = 1 + c * x; } while (v <= 0); v = v ** 3; const u = rnd(); if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v; } };
  return gamma;
}
function betaP(k, n, thr, seed) { const g = gammaSampler(seed); let hit = 0; const N = 40000; for (let i = 0; i < N; i++) { const a = g(1 + k), b = g(1 + n - k); if (a / (a + b) >= thr) hit++; } return +(hit / N).toFixed(3); }
/** Paired: Dirichlet(1 + both, 1 + a_only, 1 + b_only, 1 + neither); P(acc_a >= acc_b - within). The router's rule. */
function pairedP(c, within, seed) {
  const g = gammaSampler(seed); let hit = 0; const N = 40000;
  for (let i = 0; i < N; i++) { const x = [c.both, c.a_only, c.b_only, c.neither].map((v) => g(1 + v)); const t = x.reduce((a, b) => a + b); if ((x[1] - x[2]) / t >= -within) hit++; }
  return +(hit / N).toFixed(3);
}
const wt = (v) => (v?.defects || []).some((d) => d.severity === 'wrong_text');
const cls = (d) => String(d.class || '').toUpperCase().match(/^[IOTDE]\d+/)?.[0] ?? 'E2';
// RULE.md: zero tolerance for wrong-leaf or invented text (the I classes, and a wrong-page refusal of an item's own page)
const invented = (v) => (v?.defects || []).filter((d) => /^I\d/.test(cls(d)) || /wrong[- ]?(leaf|page)|invent/i.test(`${d.what ?? ''} ${d.class ?? ''}`));

/** agy calls a page for an agy route: every call its read made (block calls once, one-page calls by their meta), over pages read. */
function callsPerPage(route) {
  const d = dirOf(route);
  if (!fs.existsSync(d)) return null;
  const metas = fs.readdirSync(d).filter((f) => f.endsWith('.meta.json')).map((f) => JSON.parse(fs.readFileSync(path.join(d, f), 'utf8')));
  const bc = jsonl(path.join(d, 'calls.jsonl'));
  const block = bc.reduce((t, c) => t + (c.calls ?? 1), 0);
  const single = metas.filter((m) => !m.call_id).reduce((t, m) => t + (m.calls ?? 1), 0);
  const usd = bc.reduce((t, c) => t + (c.usage || []).reduce((a, u) => a + usdOf(u), 0), 0) + metas.filter((m) => !m.call_id).reduce((t, m) => t + (m.usage || []).reduce((a, u) => a + usdOf(u), 0), 0);
  return { calls: block + single, pages: metas.length, per_page: +((block + single) / Math.max(1, metas.length)).toFixed(3), usd, usd_per_1k_pages: +(1000 * usd / Math.max(1, metas.length)).toFixed(3) };
}
/** GPU seconds a page: the engine's own wall time over the pages it drafted (the card alone, no other tenant at the time). */
function gpuSecsPerPage(file) {
  const f = path.join(OUT, file); if (!fs.existsSync(f)) return null;
  const e = JSON.parse(fs.readFileSync(f, 'utf8'))._engine;
  if (e?.secs_per_page) return +e.secs_per_page;
  if (e?.run?.wall_secs && e?.pages) return +(e.run.wall_secs / e.pages).toFixed(3);
  return null;
}

function scoreRoutes(sps, wr, key, V, seedBase) {
  const vOf = (route, id) => { const k = key.find((x) => x.route === route && x.kind === 'item' && x.page_id === id); return k ? V.get(k.judged_as) ?? null : null; };
  const R = {}; let seed = seedBase;
  for (const [route, RR] of Object.entries(ROUTES).filter(([r]) => wr[r])) {
    // RULE.md 6: a face-limited route is scored on its own face only (the pooled stratum leaves it out)
    if (RR.faces && !sps.every((sp) => RR.faces.includes(sp.script_face))) continue;
    const rows = sps.map((sp) => { const w = wr[route][sp.page_id]; const v = w?.text ? vOf(route, sp.page_id) : null;
      return { page_id: sp.page_id, book_id: sp.book_id, face: sp.script_face, written: !!w?.text, judged: !!v, accept: !!v?.accept, wt: wt(v), inv: invented(v).length > 0, fidelity: v?.fidelity ?? null, why: w?.why ?? null,
        wrong_text: (v?.defects || []).filter((d) => d.severity === 'wrong_text').map((d) => `${d.class}: ${String(d.quote).slice(0, 80)} — ${d.what ?? ''}`.slice(0, 200)) }; });
    const wrt = rows.filter((r) => r.written && r.judged);
    const k = wrt.filter((r) => r.accept).length, n = wrt.length, w = wrt.filter((r) => r.wt).length, inv = wrt.filter((r) => r.inv).length;
    const cs = key.filter((x) => x.route === route && x.kind === 'wrong_page').map((x) => V.get(x.judged_as));
    const cp = RR.kind === 'draft' ? null : callsPerPage(route);
    const per = cp?.per_page ?? 0;
    const gpuFile = RR.kind === 'draft' ? RR.file : RR.kind === 'gpu' ? ROUTES[RR.draft].file : null;
    const gs = gpuFile ? gpuSecsPerPage(gpuFile) : null;
    const gpuUsd = gs ? gs * GPU_USD_PER_SEC : 0;
    const accDrawn = rows.filter((r) => r.accept).length / rows.length;
    R[route] = { all_drawn: { accept: `${rows.filter((r) => r.accept).length}/${rows.length}`, wrong_text: `${rows.filter((r) => r.wt).length}/${rows.length}` },
      written: { accept: `${k}/${n}`, wrong_text: `${w}/${n}`, invented_or_wrong_leaf: `${inv}/${n}`, p_acc_ge_080: betaP(k, n, 0.8, seed++), wrong_text_ok: n > 0 && w / n <= 0.04 && inv === 0 },
      control: { wrong_page: cs.map((v) => v ? { accept: v.accept, fidelity: v.fidelity } : null), passed: cs.length === 2 && cs.every((v) => v && !v.accept && Number(v.fidelity) <= 2) },
      not_written: rows.filter((r) => !r.written).reduce((t, r) => { const x = String(r.why).replace(/:.*/, '').slice(0, 60); t[x] = (t[x] || 0) + 1; return t; }, {}),
      agy_calls_per_page: +per.toFixed(3), calls: cp, gpu_secs_per_page: gs,
      quota_usd_per_1k_pages: cp?.usd_per_1k_pages ?? null, quota_usd_per_1k_accepted: cp && accDrawn ? +((cp.usd_per_1k_pages ?? 0) / accDrawn).toFixed(3) : null,
      usd_per_accepted_page: accDrawn ? +((per * AGY_USD + gpuUsd) / accDrawn).toFixed(5) : null,
      wrong_text_pages: rows.filter((r) => r.wt || r.inv).map((r) => ({ page_id: r.page_id, face: r.face, written: r.written, defects: r.wrong_text })), _rows: rows };
    R[route].eligible = R[route].written.wrong_text_ok && R[route].written.p_acc_ge_080 >= 0.9 && R[route].control.passed;
  }
  return R;
}
function pair(R, a, b, seed) {
  const ra = new Map(R[a]._rows.map((r) => [r.page_id, r])), both = R[b]._rows.filter((r) => r.written && r.judged && ra.get(r.page_id)?.written && ra.get(r.page_id)?.judged).map((r) => [ra.get(r.page_id), r]);
  const c = { n: both.length, books: new Set(both.map(([x]) => x.book_id)).size, both: both.filter(([x, y]) => x.accept && y.accept).length, a_only: both.filter(([x, y]) => x.accept && !y.accept).length, b_only: both.filter(([x, y]) => !x.accept && y.accept).length, neither: both.filter(([x, y]) => !x.accept && !y.accept).length };
  return { ...c, p_a_within_008: pairedP(c, 0.08, seed), rule: `P(acc_${a} >= acc_${b} - 0.08) >= 0.9, Dirichlet(1 + counts)` };
}

function score() {
  const s = J('sample.json'), key = J('key.json'), wr = J('written.json')[CELL], V = verdicts(), sps = s.cells[CELL].pages;
  const out = { scored_at: new Date().toISOString(), rule: 'RULE.md (committed before the judge stage)', judge: 'claude-opus-5-5 (claude -p), route-judge-6740 judgePrompt against the page image, blind, shuffled', strata: {} };
  const pl = key.filter((k) => k.kind === 'planted').map((k) => ({ face: k.script_face, kind: k.plant.kind, route: k.route, ...(V.get(k.judged_as) ? scorePlant(V.get(k.judged_as), k.plant) : { unjudged: true }) }));
  let seed = 6740;
  for (const [stratum, pages] of [['all', sps]]) {
    const R = scoreRoutes(pages, wr, key, V, seed); seed += 100;
    const paired = {};
    for (const r of Object.keys(R).filter((x) => x !== LIVE)) paired[`${r}|${LIVE}`] = pair(R, r, LIVE, seed++);
    // RULE.md decision: the live route stays unless a cheaper route is eligible and paired within 0.08 of it; the pick is
    // the cheapest per accepted page among the live route and those that replace it. Planted controls both missed: void.
    const pls = stratum === 'all' ? pl : pl.filter((x) => x.face === stratum);
    const voided = pls.length >= 2 && pls.every((x) => !x.unjudged && !x.caught);
    // German (confirm-de/RULE.md 2): cheaper means a quota cost per accepted page at least 10 % below live's.
    const cheaper = (r) => (DE ? R[r].quota_usd_per_1k_accepted <= 0.9 * R[LIVE].quota_usd_per_1k_accepted : R[r].agy_calls_per_page < R[LIVE].agy_calls_per_page);
    const replaces = Object.keys(R).filter((r) => r !== LIVE && R[r].eligible && paired[`${r}|${LIVE}`].p_a_within_008 >= 0.9 && cheaper(r));
    const cand = [LIVE, ...replaces];
    const pick = voided ? null : [...cand].sort((x, y) => (R[x].usd_per_accepted_page ?? 9) - (R[y].usd_per_accepted_page ?? 9))[0];
    for (const r of Object.values(R)) delete r._rows;
    out.strata[stratum] = { n_drawn: pages.length, routes: R, paired, planted: { n: pls.length, caught: pls.filter((x) => x.caught).length, detail: pls }, decision: { pick, replaces, voided, why: voided ? 'both planted controls missed' : `routes that replace ${LIVE} by RULE.md 2, cheapest per accepted page` } };
    console.log(`\n[${stratum}] n=${pages.length} decision: ${pick} (replaces: ${replaces.join(', ') || 'none'})`);
    for (const [r, x] of Object.entries(R)) console.log(`  ${r}: quota $${x.quota_usd_per_1k_pages}/1k pages $${x.quota_usd_per_1k_accepted}/1k accepted | written ${x.written.accept} wt ${x.written.wrong_text} inv ${x.written.invented_or_wrong_leaf} P80 ${x.written.p_acc_ge_080} | all ${x.all_drawn.accept} | ctrl ${x.control.passed} | ${x.agy_calls_per_page} calls/pg ${x.gpu_secs_per_page ?? '-'} gpu s/pg $${x.usd_per_accepted_page}/acc | elig ${x.eligible}`);
    for (const [p, x] of Object.entries(paired)) console.log(`  paired ${p}: ${x.a_only} vs ${x.b_only} of ${x.n} (both ${x.both}) P ${x.p_a_within_008}`);
    console.log(`  planted ${pls.filter((x) => x.caught).length}/${pls.length}`);
  }
  // RULE.md 2-4: O passes when it is eligible, paired within 0.08 of A, and cheaper in calls a page here.
  out.decision = { passes: out.strata.all.decision.replaces.includes(OPT), pick: out.strata.all.decision.pick };
  console.log(`\ndecision: ${JSON.stringify(out.decision)}`);
  W('score.json', out);
}

/** Router evidence: unsplit (cell de-cheap) and by-script (print, and the Fraktur / Antiqua faces as their own cells). */
function evidence() {
  const sc = J('score.json'), s = J('sample.json'), key = J('key.json'), wr = J('written.json')[CELL], V = verdicts();
  const EV = path.join(ROOT, 'scripts/eval/estimator/router-table/evidence');
  const vOf = (route, id) => { const k = key.find((x) => x.route === route && x.kind === 'item' && x.page_id === id); return k ? V.get(k.judged_as) ?? null : null; };
  const agg = (rows) => { const n = rows.length, k = rows.filter((r) => r.v?.accept).length, w = rows.filter((r) => wt(r.v)).length; const cl = {};
    for (const r of rows) for (const c of new Set((r.v?.defects || []).map(cls))) cl[c] = (cl[c] || 0) + 1;
    return { n, books: new Set(rows.map((r) => r.book_id)).size, accept: `${k}/${n}`, wrong_text_pages: `${w}/${n}`, classes_k_of_n: Object.fromEntries(Object.entries(cl).sort((a, b) => b[1] - a[1]).map(([c, v]) => [c, `${v}/${n}`])) }; };
  const gen = `scripts/eval/read-surface-6740/confirm.mjs evidence --cell=${CELL} (#6740; no model calls in this step)`;
  const un = { generated_by: gen, provenance: DE ? '#6740 read-surface German confirmation (job read-surface-2-6740): judge.mjs draw --cells=de-surface (30 new German books in the first-read lane frame, era-stratified 17/11/2, the #7701 draws and the Latin confirmation left out), correct (agy gemini-3.8-flash-low, default pool; read@4 on the 4-page piece, read@8 on the block); written = each route as the lane would write it; Opus judge blind against the served image, wrong-page and planted controls (read-surface-6740/confirm-de/RULE.md)' : '#6740 read-surface confirmation: judge.mjs draw --cells=la-surface (30 new Latin books in the first-read lane frame, both #7701 draws left out), correct (agy gemini-3.8-flash-low, AGY_HOME .agy-james; read@4 on the 4-page piece, the optimum 8 a call at a 1,600 px long edge); written = each route as the lane would write it; Opus judge blind against the served image, wrong-page and planted controls (read-surface-6740/confirm/RULE.md)',
    judge: 'claude-opus-5-5 (claude -p), route-judge-6740 judgePrompt against the page image', cells: {} };
  const bys = { generated_by: gen, cells: {} };
  for (const [stratum, pages] of [['all', s.cells[CELL].pages]]) {
    const routes = {};
    for (const route of Object.keys(ROUTES).filter((r) => wr[r] && (!ROUTES[r].faces || pages.every((sp) => ROUTES[r].faces.includes(sp.script_face))))) {
      const rows = pages.filter((sp) => wr[route][sp.page_id]?.text).map((sp) => ({ ...sp, v: vOf(route, sp.page_id) })).filter((r) => r.v);
      routes[`${route}-written`] = { ...agg(rows), note: 'the drawn pages the route writes, judged; a page not written stays scans-only' };
    }
    const paired = Object.fromEntries(Object.entries(sc.strata[stratum].paired).map(([p, x]) => [p.split('|').map((r) => `${r}-written`).join('|'), { n: x.n, books: x.books, both: x.both, a_only: x.a_only, b_only: x.b_only, neither: x.neither }]));
    const name = stratum === 'all' ? CELL : `${CELL}-${stratum}`;
    un.cells[name] = { task: 'ocr', lang: LANG, frame: s.cells[CELL].frame, routes, paired };
    if (stratum === 'all') bys.cells[`${CELL}|print`] = { routes, paired };
    else bys.cells[`${name}|print`] = { routes, paired };
  }
  const fn = DE ? 'read-surface-6740-de.score.json' : 'read-surface-6740.score.json';
  fs.writeFileSync(path.join(EV, fn), JSON.stringify(un, null, 1) + '\n');
  fs.writeFileSync(path.join(EV, 'by-script', fn), JSON.stringify(bys, null, 1) + '\n');
  console.log('wrote evidence/read-surface-6740.score.json and by-script/');
}

const stages = { written, packet, plant, score, evidence };
if (!stages[STAGE]) { console.error(`usage: confirm.mjs ${Object.keys(stages).join('|')} --out=DIR`); process.exit(2); }
await stages[STAGE]();
