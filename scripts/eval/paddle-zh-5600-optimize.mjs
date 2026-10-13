#!/usr/bin/env node
/**
 * PRIOR ART: scripts/eval/zh-cohort-5547-pilot.mjs (#5547 — prep a manifest for a Paddle box and report
 * its throughput; one recipe, no accuracy gate) and scripts/eval/benchmark-score.mjs (the scorer, used
 * here unchanged, as a subprocess). Neither compares serving CONFIGURATIONS of one engine against a
 * non-inferiority gate; this does, per PREREGISTRATION-paddle-zh-optimize-5600.md.
 *
 * #5600 step 3 — the cheapest PaddleOCR-VL configuration that reads the cohort as well as the pilot recipe.
 *
 *   sample      draw the 100 accuracy pages (held, eye manuscript-regular, referenced; makeRng(5600)) →
 *               results/paddle-zh-5600/sample.json; write <dir>/acc.tsv and <dir>/tput.tsv (the 400-page
 *               throughput set: the first 400 book rows of the #5547 pilot manifest) and stage their images
 *               under <dir>/img/ for pushing to a box.
 *   score       for every arm in <dir>/arms/<arm>/out/_bench/*.txt: score with benchmark-score.mjs against the
 *               Kanripo/CBETA references, base = the #5547 Paddle outputs; per arm Δ (median of per-page
 *               CER − base CER), catastrophic rate, loops, empty, W/L/T vs base, throughput from the arm's
 *               box.json / timings, €/page; gate verdicts → results/paddle-zh-5600/optimize.json + a table.
 *
 *   recall      body recall per arm (share of reference characters the reading contains, order-free — blind to
 *               extra margin text by construction) and which arms keep the 版心 margin (<header>/<page-num> lines
 *               after the lane writer's convertPaddle); paired Δ CER / recall of --pair=<a>,<b>. Reads the last
 *               `score` run in <dir> → results/paddle-zh-5600/recall[-fresh].json + a table.
 *   --fresh     (sample) the no-layout confirmation draw (prereg amendment 2026-10-02 ~21:40Z): same pool minus
 *               the 100 drawn pages, the #5547 pilot books and every book the #5600 fleet applied; makeRng(56001)
 *               → sample-fresh.json, acc.tsv only. `score`/`recall` take --sample=fresh to read it.
 *
 *   node scripts/eval/paddle-zh-5600-optimize.mjs sample [--dir=/root/paddle-zh-5600/bench] [--fresh]
 *   node scripts/eval/paddle-zh-5600-optimize.mjs score  [--dir=...] [--sample=fresh]
 *   node scripts/eval/paddle-zh-5600-optimize.mjs recall [--dir=...] [--sample=fresh] [--pair=nolayout,layout-on]
 * Arm metadata (written by the operator per arm): <dir>/arms/<arm>/arm.json
 *   { gpu: 'L4-1-24G', eur_per_hour: 0.7875, config: '…', tput: { pages, wall_secs } }
 */
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { makeRng } from './lib/paired-stats.mjs';
import { loopVerdict } from '../lib/ocr-loop-guard.mjs';
import { normalizeCJK } from './lib/metrics.mjs';
import { stripMarkupTags } from '../lib/strip-markup-tags.mjs';
import { convertPaddle, workTitleOf } from '../lib/paddle-zh-lane.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const argOf = (n, d) => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const CMD = process.argv[2];
const DIR = argOf('dir', '/root/paddle-zh-5600/bench');
const BENCH = '/root/ocr-bench/images/chinese-cohort-5547';
const BASE_OUT = path.join(BENCH, 'out', 'paddleocr-vl-1.6');
const PILOT = '/root/zh-ocr-eval-5547/pilot';
const RES = path.join(__dirname, 'results', 'paddle-zh-5600');
const REG = JSON.parse(fs.readFileSync(path.join(__dirname, 'benchmark', 'chinese-cohort-5547.json'), 'utf8'));
const REFS_BUNDLE = path.join(__dirname, 'benchmark', 'refs', 'chinese-cohort-5547.refs.jsonl');
const CLASS = path.join(__dirname, 'benchmark', 'script-class', 'chinese-cohort-5547.jsonl');
const ANCHORS = ['gemini-3.1-flash-lite', 'gemini-3-flash-preview'];
const N = 100, N_TPUT = 400, SEED = 5600, FRESH_SEED = 56001;
const LANE_DIR = '/root/paddle-zh-5600';
const FRESH = process.argv.includes('--fresh') || argOf('sample', '') === 'fresh';
const SUFFIX = FRESH ? '-fresh' : '';
const GATE = { delta: 0.01, catastrophic: 0.02 };
const jsonl = f => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const median = xs => { const s = xs.filter(x => x != null).sort((a, b) => a - b); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const r4 = x => x == null ? null : +x.toFixed(4);

function sample() {
  const refs = new Map(jsonl(REFS_BUNDLE).filter(r => r.text && r.text.trim()).map(r => [r.slug, r]));
  const cls = new Map(jsonl(CLASS).map(r => [r.slug, r.script_class]));
  let pool = REG.pages.filter(p => !p.retired && p.cohort === 'held' && cls.get(p.slug) === 'manuscript-regular' && refs.has(p.slug)).map(p => p.slug).sort();
  let note = null;
  if (FRESH) {
    // the fresh draw writes its own acc.tsv: never into the original bench's dir (its acc/tput sets are the benchmark's)
    if (!process.argv.some(x => x.startsWith('--dir=')) || path.resolve(DIR) === '/root/paddle-zh-5600/bench') { console.error('sample --fresh needs its own --dir= (not the original bench)'); process.exit(2); }
    // the no-layout confirmation (prereg amendment): never a page the 100 chose an arm on, never a pilot or fleet-applied book
    const drawn = new Set(JSON.parse(fs.readFileSync(path.join(RES, 'sample.json'), 'utf8')).slugs);
    const bookOf = new Map(REG.pages.map(p => [p.slug, p.book_id]));
    const pilot = new Set(fs.readFileSync(path.join(LANE_DIR, 'pilot-books.txt'), 'utf8').split('\n').filter(Boolean));
    const fleet = new Set(jsonl(path.join(LANE_DIR, 'applied-books.jsonl')).map(r => r.bid));
    const notDrawn = pool.filter(s => !drawn.has(s) && !pilot.has(bookOf.get(s)));
    const clean = notDrawn.filter(s => !fleet.has(bookOf.get(s)));
    note = { not_drawn_not_pilot: notDrawn.length, also_not_fleet: clean.length, fleet_books_at_draw: fleet.size };
    if (clean.length >= N) pool = clean;
    else { pool = notDrawn; note.fleet_exclusion = `dropped: only ${clean.length} pages outside fleet-applied books; ${notDrawn.length - clean.length} of the pool are in books the fleet has written (their stored text is not read here, only the sealed image)`; }
  }
  const rng = makeRng(FRESH ? FRESH_SEED : SEED), bag = [...pool], slugs = [];
  while (slugs.length < N && bag.length) slugs.push(bag.splice(Math.floor(rng() * bag.length), 1)[0]);
  fs.mkdirSync(RES, { recursive: true });
  fs.writeFileSync(path.join(RES, `sample${SUFFIX}.json`), JSON.stringify({ issue: 5600, seed: FRESH ? FRESH_SEED : SEED, drawn_at: new Date().toISOString(), rule: 'sealed chinese-cohort-5547 pages: cohort=held, eye manuscript-regular, with a reference text; slug-sorted, makeRng(seed) without replacement' + (FRESH ? '; minus the 100 of sample.json, the #5547 pilot books and the #5600 fleet-applied books (prereg amendment 2026-10-02)' : ''), pool: pool.length, ...(note ? { exclusions: note } : {}), slugs: slugs.sort() }, null, 1));
  // the box manifests: accuracy pages, then the throughput set
  fs.mkdirSync(path.join(DIR, 'img', '_bench'), { recursive: true });
  const acc = slugs.sort().map(s => { const dst = path.join(DIR, 'img', '_bench', `${s}.jpg`); if (!fs.existsSync(dst)) fs.copyFileSync(path.join(BENCH, `${s}.jpg`), dst); return `_bench\t${s}\timg/_bench/${s}.jpg`; });
  if (FRESH) { fs.writeFileSync(path.join(DIR, 'acc.tsv'), acc.join('\n') + '\n'); fs.writeFileSync(path.join(DIR, 'tput.tsv'), ''); console.log(`pool ${pool.length}; drew ${slugs.length}; ${JSON.stringify(note)}`); return; }
  const books = fs.readFileSync(path.join(PILOT, 'manifest.tsv'), 'utf8').split('\n').filter(l => l && !l.startsWith('_bench')).slice(0, N_TPUT);
  const tput = books.map(l => { const [bid, pn, rel] = l.split('\t'); const dst = path.join(DIR, rel); fs.mkdirSync(path.dirname(dst), { recursive: true }); if (!fs.existsSync(dst)) fs.copyFileSync(path.join(PILOT, rel), dst); return `${bid}\t${pn}\t${rel}`; });
  fs.writeFileSync(path.join(DIR, 'acc.tsv'), acc.join('\n') + '\n');
  fs.writeFileSync(path.join(DIR, 'tput.tsv'), tput.join('\n') + '\n');
  console.log(`pool ${pool.length}; drew ${slugs.length}; acc.tsv ${acc.length} rows, tput.tsv ${tput.length} rows (${new Set(tput.map(l => l.split('\t')[0])).size} books)`);
}

function score() {
  const { slugs } = JSON.parse(fs.readFileSync(path.join(RES, `sample${SUFFIX}.json`), 'utf8'));
  const armsDir = path.join(DIR, 'arms');
  const arms = fs.existsSync(armsDir) ? fs.readdirSync(armsDir).filter(a => fs.existsSync(path.join(armsDir, a, 'out', '_bench'))).sort() : [];
  // a scorer root: <root>/chinese-cohort-5547/{<slug>.jpg, out/<arm>/<slug>.txt}
  const root = path.join(DIR, 'score'), st = path.join(root, 'chinese-cohort-5547');
  fs.rmSync(root, { recursive: true, force: true });
  for (const s of slugs) { fs.mkdirSync(st, { recursive: true }); fs.symlinkSync(path.join(BENCH, `${s}.jpg`), path.join(st, `${s}.jpg`)); }
  const put = (arm, from) => { const d = path.join(st, 'out', arm); fs.mkdirSync(d, { recursive: true }); for (const s of slugs) { const f = path.join(from, `${s}.txt`); if (fs.existsSync(f)) fs.copyFileSync(f, path.join(d, `${s}.txt`)); } };
  put('base', BASE_OUT);
  // the scorer's reference-mismatch guard drops a page's reference when NO engine in the run gets within
  // CER 0.5 of it, so the set of usable references depends on which engines are present. The two #5547
  // Gemini arms are always included (anchors, never reported) so the usable set is #5547's, not a
  // function of how well the arms under test read.
  for (const a of ANCHORS) put(a, path.join(BENCH, 'out', a));
  for (const a of arms) put(a, path.join(armsDir, a, 'out', '_bench'));
  // the references, unpacked where the scorer reads them, and removed afterwards (they ship as the bundle)
  const refsDir = path.join(__dirname, 'benchmark', 'refs'); const made = [];
  for (const r of jsonl(REFS_BUNDLE).filter(r => slugs.includes(r.slug))) {
    for (const [ext, body] of [['json', JSON.stringify(r.record, null, 2)], ['txt', r.text]]) { const f = path.join(refsDir, `${r.slug}.${ext}`); if (body != null && !fs.existsSync(f)) { fs.writeFileSync(f, body); made.push(f); } }
  }
  const out = path.join(root, 'scored');
  try { execFileSync('node', [path.join(__dirname, 'benchmark-score.mjs'), `--root=${root}`, '--stratum=chinese-cohort-5547', '--ref=base', `--out=${out}`], { stdio: ['ignore', 'ignore', 'inherit'] }); }
  finally { for (const f of made) fs.rmSync(f, { force: true }); }
  const scored = JSON.parse(fs.readFileSync(path.join(out, fs.readdirSync(out).find(f => f.startsWith('chinese-cohort-5547-'))), 'utf8'));
  const byPage = new Map(scored.pages.map(p => [p.slug, p]));
  // scored pages = a usable reference (has_ref after the mismatch guard); textless and mismatched pages are listed, not averaged
  const refd = slugs.filter(s => byPage.get(s)?.has_ref);
  const cerOf = (s, arm) => { const e = byPage.get(s)?.engines?.[arm]; return e && !e.missing && e.cer != null ? e.cer : null; };
  const rows = [];
  const baseCat = refd.filter(s => cerOf(s, 'base') == null || cerOf(s, 'base') > 0.5).length;   // amendment 2: no worse than base
  for (const arm of ['base', ...arms]) {
    const meta = arm === 'base' ? { gpu: 'L4-1-24G', eur_per_hour: 0.7875, config: '#5547 pilot recipe: native, 2 runners, ≤2400 px wide, layout on', tput: { pages: 3225, wall_secs: 10810 }, note: '#5547 pilot throughput (3,422 pages incl. bench; 3.35 s/page on book pages)' }
      : JSON.parse(fs.readFileSync(path.join(armsDir, arm, 'arm.json'), 'utf8'));
    const cers = refd.map(s => cerOf(s, arm));
    const scoredN = cers.filter(c => c != null).length;
    const deltas = refd.map(s => (cerOf(s, arm) != null && cerOf(s, 'base') != null) ? cerOf(s, arm) - cerOf(s, 'base') : null).filter(d => d != null);
    const missing = cers.filter(c => c == null).length;
    // a page with no output counts as catastrophic (it would be an unread page)
    const cat = cers.filter(c => c == null || c > 0.5).length;
    const texts = slugs.map(s => { const f = path.join(st, 'out', arm, `${s}.txt`); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null; });
    const loops = texts.filter(t => t && loopVerdict(t).loop).length;
    const empty = texts.filter(t => t != null && [...t].filter(c => /\p{Script=Han}/u.test(c)).length < 10).length;
    const w = deltas.filter(d => d < -1e-9).length, l = deltas.filter(d => d > 1e-9).length;
    const sp = meta.tput?.pages ? meta.tput.wall_secs / meta.tput.pages : null;
    const eur = sp != null && meta.eur_per_hour ? sp * meta.eur_per_hour / 3600 : null;
    const d = arm === 'base' ? 0 : median(deltas);
    const pass = arm === 'base' ? null : (d != null && d <= GATE.delta && cat <= Math.max(GATE.catastrophic * refd.length, baseCat));
    rows.push({ arm, config: meta.config, gpu: meta.gpu, n: refd.length, scored: scoredN, missing, median_cer: r4(median(cers)), delta_vs_base: r4(d), catastrophic: cat, catastrophic_rate: r4(cat / refd.length), loops, empty, wlt_vs_base: arm === 'base' ? null : [w, l, deltas.length - w - l], s_per_page: r4(sp), eur_per_page: eur == null ? null : +eur.toFixed(6), gate: pass == null ? 'baseline' : pass ? 'PASS' : 'FAIL', note: meta.note || null });
  }
  fs.mkdirSync(RES, { recursive: true });
  const excluded = { textless: scored.summary.textless.filter(s => slugs.includes(s)), ref_mismatch: scored.summary.ref_mismatch.filter(s => slugs.includes(s)) };
  console.log(`${slugs.length} sample pages; ${refd.length} with a usable reference; excluded ${JSON.stringify(excluded)}`);
  fs.writeFileSync(path.join(RES, `optimize${SUFFIX}.json`), JSON.stringify({ generated_at: new Date().toISOString(), gate: GATE, sample: slugs.length, scored_pages: refd.length, excluded, anchors: ANCHORS, prereg: 'scripts/eval/PREREGISTRATION-paddle-zh-optimize-5600.md', scorer: 'benchmark-score.mjs (--ref=base)', rows }, null, 1));
  console.log('| arm | config | GPU | s/page | €/page | median CER | Δ vs base | catastrophic | loops | empty | W/L/T vs base | gate |\n|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of rows) console.log(`| ${r.arm} | ${r.config} | ${r.gpu} | ${r.s_per_page ?? '—'} | ${r.eur_per_page ?? '—'} | ${r.median_cer} | ${r.delta_vs_base} | ${r.catastrophic}/${r.n} | ${r.loops} | ${r.empty} | ${r.wlt_vs_base ? r.wlt_vs_base.join('/') : '—'} | ${r.gate} |`);
}

// ── body recall + margin retention (prereg amendment 2026-10-02 ~21:40Z) ──
// Recall = Σ_c min(n_hyp(c), n_ref(c)) / |ref| over Han characters (normalizeCJK after stripMarkupTags, 6,000-char
// cap as the scorer). The scorer's kyūjitai→shinjitai fold is not applied: it exists for NDL's modern forms, and
// here both the reading and the Kanripo reference are traditional. Extra text (the 版心 margin the reference
// omits) cannot lower it; only body text missing or misread does.
const hanNorm = t => normalizeCJK(stripMarkupTags(String(t || '')).normalize('NFC')).slice(0, 6000);
function bagRecall(hyp, ref) {
  const r = [...hanNorm(ref)]; if (!r.length) return null;
  const c = new Map(); for (const ch of hanNorm(hyp)) c.set(ch, (c.get(ch) || 0) + 1);
  let m = 0; for (const ch of r) { const n = c.get(ch); if (n) { m++; c.set(ch, n - 1); } }
  return m / r.length;
}
function recall() {
  const { slugs } = JSON.parse(fs.readFileSync(path.join(RES, `sample${SUFFIX}.json`), 'utf8'));
  const root = path.join(DIR, 'score'), st = path.join(root, 'chinese-cohort-5547'), out = path.join(root, 'scored');
  const scored = JSON.parse(fs.readFileSync(path.join(out, fs.readdirSync(out).find(f => f.startsWith('chinese-cohort-5547-'))), 'utf8'));
  const byPage = new Map(scored.pages.map(p => [p.slug, p]));
  const refd = slugs.filter(s => byPage.get(s)?.has_ref);
  const refText = new Map(jsonl(REFS_BUNDLE).map(r => [r.slug, r.text]));
  const title = new Map(REG.pages.map(p => [p.slug, p.title]));
  const arms = fs.readdirSync(path.join(st, 'out')).filter(a => !ANCHORS.includes(a)).sort();
  const read = (arm, s) => { const f = path.join(st, 'out', arm, `${s}.txt`); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null; };
  const cerOf = (s, arm) => { const e = byPage.get(s)?.engines?.[arm]; return e && !e.missing && e.cer != null ? e.cer : null; };
  const per = {}, rows = [];
  for (const arm of arms) {
    per[arm] = {};
    for (const s of refd) {
      const t = read(arm, s);
      const { stats } = convertPaddle(t || '', { workTitle: workTitleOf(title.get(s) || '') });
      // fold strip read in any form: 四庫全書 / 欽定…, or the lane's anchors (kana lines, garbled 全書)
      per[arm][s] = { recall: t == null ? 0 : bagRecall(t, refText.get(s)), cer: cerOf(s, arm), header: stats.header_lines, page_num: stats.page_num_lines, skqs: /四庫|全書/u.test(t || ''), juan: /^\s*卷[一二三四五六七八九十百上中下之首末0-9]+\s*$/mu.test(t || '') };
    }
    const v = Object.values(per[arm]);
    rows.push({ arm, n: v.length, median_recall: r4(median(v.map(x => x.recall))), mean_recall: r4(v.reduce((a, x) => a + (x.recall ?? 0), 0) / v.length), recall_below_0_8: v.filter(x => (x.recall ?? 0) < 0.8).length, median_cer: r4(median(v.map(x => x.cer))), catastrophic: v.filter(x => x.cer == null || x.cer > 0.5).length, pages_with_header: v.filter(x => x.header > 0).length, pages_with_page_num: v.filter(x => x.page_num > 0).length, pages_with_skqs_strip: v.filter(x => x.skqs).length, pages_with_juan_line: v.filter(x => x.juan).length });
  }
  const pair = argOf('pair', '');
  let paired = null;
  if (pair) {
    const [a, b] = pair.split(',');
    if (!per[a] || !per[b]) { console.error(`--pair: arms ${a},${b} not both scored (have ${arms})`); process.exit(2); }
    const dc = refd.map(s => (per[a][s].cer != null && per[b][s].cer != null) ? per[a][s].cer - per[b][s].cer : null).filter(d => d != null);
    const dr = refd.map(s => per[a][s].recall - per[b][s].recall);
    const w = dc.filter(d => d < -1e-9).length, l = dc.filter(d => d > 1e-9).length;
    const ranked = refd.map(s => ({ slug: s, d_cer: per[a][s].cer != null && per[b][s].cer != null ? r4(per[a][s].cer - per[b][s].cer) : null, d_recall: r4(per[a][s].recall - per[b][s].recall) })).sort((x, y) => (x.d_cer ?? 9) - (y.d_cer ?? 9));
    paired = { a, b, median_delta_cer: r4(median(dc)), median_delta_recall: r4(median(dr)), wlt_cer: [w, l, dc.length - w - l], biggest_wins: ranked.slice(0, 5), biggest_losses: ranked.filter(x => x.d_cer != null).slice(-5).reverse(), recall_drops_over_0_05: ranked.filter(x => x.d_recall < -0.05) };
  }
  fs.writeFileSync(path.join(RES, `recall${SUFFIX}.json`), JSON.stringify({ generated_at: new Date().toISOString(), prereg: 'scripts/eval/PREREGISTRATION-paddle-zh-optimize-5600.md (amendment 2026-10-02 ~21:40Z)', n: refd.length, rows, paired, pages: per }, null, 1));
  console.log(`${refd.length} referenced pages\n| arm | median recall | mean recall | recall < 0.8 | median CER | catastrophic | header | page-num | 四庫全書 strip | juan line |\n|---|---|---|---|---|---|---|---|---|---|`);
  for (const r of rows) console.log(`| ${r.arm} | ${r.median_recall} | ${r.mean_recall} | ${r.recall_below_0_8} | ${r.median_cer} | ${r.catastrophic} | ${r.pages_with_header} | ${r.pages_with_page_num} | ${r.pages_with_skqs_strip} | ${r.pages_with_juan_line} |`);
  if (paired) console.log(JSON.stringify(paired, null, 1));
}

if (CMD === 'sample') sample();
else if (CMD === 'score') score();
else if (CMD === 'recall') recall();
else { console.error('usage: sample [--fresh] | score [--sample=fresh] | recall [--sample=fresh] [--pair=a,b] [--dir=…]'); process.exit(2); }
