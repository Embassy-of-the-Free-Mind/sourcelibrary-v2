#!/usr/bin/env node
// PRIOR ART: scripts/eval/latin-paired-6740/analyze.mjs (HT weights, the stratified bootstrap, the paired Dirichlet, the
// router check on a copy of origin/main with lane-judge-sampler.mjs addEvidence/rebuildInputs; restated here for one cell,
// four arms and the #7982 prereg rule, which is k/n, not #7862's defect rule) and the score files' cells-6553 /
// en-pre1800-gpu-6871 shape (evidence/<name>.score.json + evidence/by-script/<name>.score.json). exportScore
// (lane-judge-sampler.mjs) is not used: it reads lane records and their own plant scorer, not a study's arms.
/**
 * #7982 scoring (scripts/eval/experiments/2026-11-03-korean-ocr-cell-7982.md §Outcomes). No model calls, no Mongo.
 *   node scripts/eval/korean-cell-7982/score.mjs score     → results/score.json, results/router-evidence.score.json (+ by-script)
 *   node scripts/eval/korean-cell-7982/score.mjs router    → results/router-check.json (build.py on a copy; rules.json unchanged)
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { makeRng } from '../confidence-7866/lib.mjs';
import { OUT, RESULTS, J, jsonl, SEED } from './lib.mjs';
import { ARMS, caught, bare } from './judge.mjs';

const ROOT = path.resolve(RESULTS, '../../../..');
const RT = 'scripts/eval/estimator/router-table';
const EV = `${RT}/evidence/korean-cell-7982.score.json`, BY = `${RT}/evidence/by-script/korean-cell-7982.score.json`;
const CELL = 'korean-7982';
/** Router route ids: the stored read splits by its engine (Flash-Lite = the cell's live `lite`; gemini-3-flash-preview = `3flash`). */
const ROUTE = { 'agy-flash-low-read': 'agy-flash-low-read', 'paddle-vl': 'paddle', 'qwen3-vl-8b': 'qwen3-vl-8b' };
const INVENTED = ['O1', 'O2', 'I1', 'I2', 'I6', 'T14', 'invented'];
const CANDIDATES = ['paddle-vl', 'qwen3-vl-8b', 'agy-flash-low-read'];   // cheapest first: GPU (flat fee) before agy
const r3 = (x) => (x == null || Number.isNaN(x) ? null : Math.round(x * 1000) / 1000);
const R = (f, x) => { fs.mkdirSync(RESULTS, { recursive: true }); fs.writeFileSync(path.join(RESULTS, f), JSON.stringify(x, null, 1) + '\n'); };

// ── random draws (seeded) ──
function normal(rng) { let u = 0; while (u === 0) u = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng()); }
function gamma(rng, a) {
  if (a < 1) return gamma(rng, a + 1) * Math.pow(rng(), 1 / a);
  const d = a - 1 / 3, c = 1 / Math.sqrt(9 * d);
  for (;;) { let x, v; do { x = normal(rng); v = 1 + c * x; } while (v <= 0); v = v * v * v; const u = rng(); if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v; }
}
const beta = (rng, a, b) => { const x = gamma(rng, a); return x / (x + gamma(rng, b)); };
const N = 20000;
const pBeta = (k, n, f, seed, a0 = 1) => { const rng = makeRng(seed); let c = 0; for (let i = 0; i < N; i++) if (f(beta(rng, a0 + k, a0 + n - k))) c++; return r3(c / N); };
/** Paired Dirichlet(1 + both, 1 + a only, 1 + b only, 1 + neither) draws of acc_a - acc_b (build.py paired_draws). */
function pairedP(ps, a, b, f, seed) {
  const c = { both: 0, a: 0, b: 0, none: 0 };
  for (const p of ps) { const x = p.o[a].accept, y = p.o[b].accept; c[x && y ? 'both' : x ? 'a' : y ? 'b' : 'none']++; }
  const rng = makeRng(seed); let k = 0;
  for (let i = 0; i < N; i++) { const g = [c.both, c.a, c.b, c.none].map((v) => gamma(rng, 1 + v)); const s = g[0] + g[1] + g[2] + g[3]; if (f((g[1] - g[2]) / s)) k++; }
  return { counts: c, p: r3(k / N) };
}

function load() {
  const { drawn } = J('draw.json');
  const eye = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(RESULTS, 'by-eye.json'), 'utf8')).map((e) => [e.page_id, e]));
  const items = J('items.json'), vs = jsonl(path.join(OUT, 'verdicts.jsonl'));
  const main = new Map(vs.filter((r) => r.set === 'main' && r.verdict).map((r) => [r.id, r]));
  const ps = drawn.map((d) => {
    const o = {};
    for (const arm of ARMS) {
      const it = items.find((x) => x.page === d.page_id && x.arms.includes(arm));
      const v = it && main.get(it.id)?.verdict;
      const defects = v?.defects || [];
      o[arm] = !it ? { usable: false, judged: false, accept: false, wrong: false, invented: false, classes: [] }
        : !v ? { usable: true, judged: false, accept: false, wrong: false, invented: false, classes: [] }
        : { usable: true, judged: true, accept: v.accept === true, wrong: defects.some((x) => x.severity === 'wrong_text'), invented: defects.some((x) => INVENTED.includes(String(x.class).split(/[\s:]/)[0])),
          fidelity: Number(v.fidelity), classes: [...new Set(defects.map((x) => String(x.class).split(/[\s:]/)[0]))], n_wrong: defects.filter((x) => x.severity === 'wrong_text').length, n_misleads: defects.filter((x) => x.severity === 'misleads').length, note: v.reader_note };
    }
    const sb = d.stored.route === 'lite' ? 'stored-lite' : 'stored-3flash';
    return { ...d, eye: eye[d.page_id], o, stored_route: sb };
  });
  return { ps, vs, items };
}

const kn = (ps, arm, f) => ({ k: ps.filter((p) => f(p.o[arm])).length, n: ps.length });
const s = (x) => `${x.k}/${x.n}`;
/** HT-weighted accept, and a stratified bootstrap 95% CI (pages resampled within their stratum). */
function weighted(ps, arm, seed) {
  const wr = (xs) => xs.reduce((a, p) => a + p.w * (p.o[arm].accept ? 1 : 0), 0) / xs.reduce((a, p) => a + p.w, 0);
  const strata = [...new Set(ps.map((p) => p.stratum))], rng = makeRng(seed), bs = [];
  for (let i = 0; i < 4000; i++) { const xs = strata.flatMap((st) => { const h = ps.filter((p) => p.stratum === st); return h.map(() => h[Math.floor(rng() * h.length)]); }); bs.push(wr(xs)); }
  bs.sort((a, b) => a - b);
  return { est: r3(wr(ps)), ci95: [r3(bs[Math.floor(0.025 * bs.length)]), r3(bs[Math.floor(0.975 * bs.length) - 1])] };
}

function armBlock(ps, arm, seed) {
  const a = kn(ps, arm, (o) => o.accept), w = kn(ps, arm, (o) => o.wrong), inv = kn(ps, arm, (o) => o.invented);
  const fid = ps.map((p) => p.o[arm].fidelity).filter((x) => x != null && !Number.isNaN(x));
  const cls = {}; for (const p of ps) for (const c of p.o[arm].classes) cls[c] = (cls[c] ?? 0) + 1;
  return { usable: s(kn(ps, arm, (o) => o.usable)), judged: s(kn(ps, arm, (o) => o.judged)), accept: s(a), accept_mean: r3((1 + a.k) / (2 + a.n)), accept_weighted: weighted(ps, arm, seed),
    wrong_text_pages: s(w), invented_pages: s(inv), fidelity_mean: r3(fid.reduce((x, y) => x + y, 0) / (fid.length || 1)),
    wrong_text_defects: ps.reduce((t, p) => t + (p.o[arm].n_wrong || 0), 0), misleads_defects: ps.reduce((t, p) => t + (p.o[arm].n_misleads || 0), 0),
    p_acc_ge_080: pBeta(a.k, a.n, (x) => x >= 0.8, seed + 1), p_acc_ge_090: pBeta(a.k, a.n, (x) => x >= 0.9, seed + 2),
    hard_floor_p: inv.k >= 1 ? pBeta(inv.k, inv.n, (x) => x > 0.02, seed + 3, 0.5) : null, blocked: inv.k >= 1 && pBeta(inv.k, inv.n, (x) => x > 0.02, seed + 3, 0.5) >= 0.9,
    classes_k_of_n: Object.fromEntries(Object.entries(cls).sort((x, y) => y[1] - x[1]).map(([c, k]) => [c, `${k}/${ps.length}`])) };
}

function controlsBlock(vs, items) {
  const wp = vs.filter((r) => r.set === 'wrong' && r.verdict).map((r) => ({ id: r.id, arm: r.arms[0], accept: r.verdict.accept, fidelity: r.verdict.fidelity, passed: !r.verdict.accept && Number(r.verdict.fidelity) <= 2 }));
  const pl = vs.filter((r) => r.set === 'planted' && r.verdict).map((r) => ({ id: r.id, kind: r.plant.kind, arms: r.arms, accept: r.verdict.accept, caught: caught(r.verdict) }));
  const plantsRun = pl.length >= 3;
  const valid = wp.length === 8 && wp.every((x) => x.passed) && (!plantsRun || pl.filter((x) => x.caught).length / pl.length >= 2 / 3);
  return { wrong_page: wp, wrong_page_passed: `${wp.filter((x) => x.passed).length}/${wp.length}`, planted: pl, planted_caught: `${pl.filter((x) => x.caught).length}/${pl.length}`, plants_run: plantsRun, valid };
}

function decide(ps, arms, { ignoreFloor = false } = {}) {
  const cand = CANDIDATES.filter((a) => ignoreFloor || !arms[a].blocked);
  // every candidate blocked: the router's HOLD (hard floor) (rules.json no_served_privilege: no fallback to the served route)
  if (!cand.length) return { decision1: { candidates: [], blocked: CANDIDATES, pick: null, clears_floor: false, note: 'HOLD (hard floor): every candidate is blocked by invented / wrong-leaf pages' },
    decision2: { contrasts: [], passing: [], reread_arm: null, reread_scope: [], recommend: false, note: 'no candidate: every one is blocked by the hard floor' }, ...(ignoreFloor ? {} : { if_floor_ignored: decide(ps, arms, { ignoreFloor: true }) }) };
  const best = cand.reduce((m, a) => (arms[a].accept_mean > arms[m].accept_mean ? a : m), cand[0]);
  // a cheaper candidate wins when P(acc_cheap >= acc_best - 0.08) >= 0.9 (switch.within / switch.p), cheapest first
  const cheap = [];
  let pick = best;
  for (const a of cand) {
    if (a === best) break;
    const pr = pairedP(ps, a, best, (d) => d >= -0.08, SEED.bootstrap + 10 + CANDIDATES.indexOf(a));
    cheap.push({ arm: a, vs: best, ...pr });
    if (pr.p >= 0.9) { pick = a; break; }
  }
  const floor = arms[pick].p_acc_ge_080 >= 0.9;
  const d1 = { candidates: cand, blocked: CANDIDATES.filter((a) => arms[a].blocked), best_by_mean: best, cheaper_checks: cheap, pick, clears_floor: floor,
    note: floor ? 'clears the floor (P(acc >= 0.8) >= 0.9)' : 'no arm clears the floor (NEEDS-ENGINE flag; policy-1102 rule 1: does not block the pick for unread pages)' };
  // Decision 2: beats stored (P(acc_c > acc_stored) >= 0.95, wrong-text pages <= stored's, not blocked)
  const ws = kn(ps, 'stored', (o) => o.wrong).k;
  const d2c = cand.map((a) => { const pr = pairedP(ps, a, 'stored', (d) => d > 0, SEED.bootstrap + 20 + CANDIDATES.indexOf(a)); const wa = kn(ps, a, (o) => o.wrong).k;
    return { arm: a, ...pr, wrong_text_pages: wa, stored_wrong_text_pages: ws, passes: pr.p >= 0.95 && wa <= ws && (ignoreFloor || !arms[a].blocked) }; });
  const pass = d2c.filter((x) => x.passes).map((x) => x.arm);
  const re = pass.length ? (pass.includes(pick) ? pick : pass[0]) : null;
  const scope = re ? ['hanja/print', 'hanja/manuscript'].filter((st) => { const h = ps.filter((p) => p.stratum === st); return kn(h, re, (o) => o.accept).k >= kn(h, 'stored', (o) => o.accept).k; }) : [];
  return { decision1: d1, decision2: { contrasts: d2c, passing: pass, reread_arm: re, reread_scope: scope, recommend: Boolean(re && scope.length) },
    ...(ignoreFloor || !d1.blocked.length ? {} : { if_floor_ignored: decide(ps, arms, { ignoreFloor: true }) }) };
}

function score() {
  const { ps, vs, items } = load();
  const out = { generated_at: new Date().toISOString(), pages: ps.length, items: items.length,
    calls: { main: vs.filter((r) => r.set === 'main').length, controls: vs.filter((r) => r.set !== 'main').length, unparsed: vs.filter((r) => !r.verdict).length, list_usd_equiv: +vs.reduce((a, r) => a + (r.list_usd || 0), 0).toFixed(2) } };
  out.instrument = controlsBlock(vs, items);
  out.arms = Object.fromEntries(ARMS.map((a, i) => [a, armBlock(ps, a, SEED.bootstrap + 100 * (i + 1))]));
  Object.assign(out, decide(ps, out.arms));
  const cut = (key) => Object.fromEntries([...new Set(ps.map(key))].sort().map((g) => { const h = ps.filter((p) => key(p) === g); return [g, { pages: h.length, ...Object.fromEntries(ARMS.map((a) => [a, { accept: s(kn(h, a, (o) => o.accept)), wrong_text_pages: s(kn(h, a, (o) => o.wrong)) }])) }]; }));
  out.by_stratum = cut((p) => p.stratum);
  out.by_eye = cut((p) => `${p.eye.eye_mix}/${p.eye.eye_form}`);
  out.by_eye_form = cut((p) => p.eye.eye_form);
  out.by_stored_engine = cut((p) => p.stored_route);
  // per route, the header's defect_rates shape (study_cells): defects per 1,000 CHARACTERS (CJK has no word spaces; the
  // judge's defect counts over the arm's judged text, tags removed), named per_1k for the lint
  out.study_cells = Object.fromEntries(ARMS.map((a) => {
    const js = ps.filter((p) => p.o[a].judged), ch = js.reduce((t, p) => t + bare(fs.readFileSync(path.join(OUT, 'arms', a, `${p.page_id}.txt`), 'utf8')).length, 0);
    const wt = js.reduce((t, p) => t + p.o[a].n_wrong, 0), ml = js.reduce((t, p) => t + p.o[a].n_misleads, 0);
    return [`korean-7982/${a}`, { n: js.length, books: js.length, unit: 'characters', chars: ch, fidelity_mean: out.arms[a].fidelity_mean, wrong_text_per_1k: r3(1000 * wt / ch), misleads_per_1k: r3(1000 * ml / ch), accept: out.arms[a].accept }];
  }));
  out.paired_vs_stored = Object.fromEntries(CANDIDATES.map((a) => [a, pairedP(ps, a, 'stored', (d) => d > 0, SEED.bootstrap + 20 + CANDIDATES.indexOf(a))]));
  out.per_page = ps.map((p) => ({ page_id: p.page_id, book: p.book, stratum: p.stratum, eye: `${p.eye.eye_mix}/${p.eye.eye_form}`, w: p.w, stored: p.stored_route,
    ...Object.fromEntries(ARMS.map((a) => [a, p.o[a].judged ? `${p.o[a].accept ? 'A' : '-'} f${p.o[a].fidelity} wt${p.o[a].n_wrong}` : p.o[a].usable ? 'unjudged' : 'none'])) }));
  out.notes = Object.fromEntries(ps.map((p) => [p.page_id, Object.fromEntries(ARMS.map((a) => [a, p.o[a].note ?? null]))]));
  R('score.json', out);
  R('router-evidence.score.json', evidence(ps, out));
  console.log(`instrument: wrong-page ${out.instrument.wrong_page_passed}, planted ${out.instrument.planted_caught}, valid ${out.instrument.valid}`);
  for (const a of ARMS) { const b = out.arms[a]; console.log(`  ${a.padEnd(19)} usable ${b.usable} accept ${b.accept} (w ${b.accept_weighted.est} ${JSON.stringify(b.accept_weighted.ci95)}) wrong ${b.wrong_text_pages} invented ${b.invented_pages} fid ${b.fidelity_mean} P(>=.8) ${b.p_acc_ge_080} blocked ${b.blocked}`); }
  console.log('D1', JSON.stringify(out.decision1)); console.log('D2', JSON.stringify(out.decision2));
  if (out.if_floor_ignored) { console.log('D1 (floor ignored)', JSON.stringify(out.if_floor_ignored.decision1)); console.log('D2 (floor ignored)', JSON.stringify(out.if_floor_ignored.decision2)); }
  for (const [k, v] of Object.entries(out.by_stratum)) console.log(`  ${k.padEnd(18)} ${ARMS.map((a) => `${a.slice(0, 6)} ${v[a].accept}`).join('  ')}`);
}

/** The score-file shape build.py reads (cells-6553 / en-pre1800-gpu-6871), every drawn page, unweighted k/n. */
function evidence(ps, out) {
  const block = (h, arm) => { const b = armBlock(h, arm, SEED.bootstrap); const n = h.length; return { n, books: n, accept: b.accept, wrong_text_pages: b.wrong_text_pages, classes_k_of_n: b.classes_k_of_n, invented_pages: b.invented_pages }; };
  const routes = (h) => {
    const r = {};
    for (const a of CANDIDATES) r[ROUTE[a]] = { ...block(h, a), served: { 'agy-flash-low-read': 'cli-ocr.mjs read, agy gemini-3.8-flash-low, one page a call, live OCR prompt', 'paddle-vl': 'PaddleOCR-VL-1.6 genai server, layout off (the zh lane P0) on gex45', 'qwen3-vl-8b': 'Qwen3-VL-8B-Instruct-FP8, vLLM, korean prompt (read.py kore), temperature 0' }[a] };
    for (const [id, eng] of [['lite', 'stored-lite'], ['3flash', 'stored-3flash']]) { const g = h.filter((p) => p.stored_route === eng); if (g.length) r[id] = { ...block(g, 'stored'), served: `the stored read (${id}), as live` }; }
    return r;
  };
  const hand = (p) => ({ printed: 'print', mixed: 'print', handwritten: 'manuscript' }[p.script_type] ?? 'unknown');
  const by = {};
  for (const t of ['print', 'manuscript', 'unknown']) { const h = ps.filter((p) => hand(p) === t); if (h.length) by[`${CELL}|${t}`] = { routes: Object.fromEntries(Object.entries(routes(h)).map(([k, v]) => [k, { ...v, script_basis: { page: h.length } }])) }; }
  return { generated_by: 'scripts/eval/korean-cell-7982/score.mjs score (job korean-ocr-cell-7982, #7982; no model calls in this step)',
    provenance: '#7982 Korean OCR cell test: one interior page per book, 30 books of 267 Korean books with a stored read (live and hidden), PPS on eligible pages inside script-mix x form strata (seed 79821); four arms on the same page; Opus judge blind to arm against the image, wrong-page and planted controls. Preregistered: scripts/eval/experiments/2026-11-03-korean-ocr-cell-7982.md',
    judge: 'claude-opus-5-5 (claude -p), route-judge-6740 judgePrompt against the page image',
    mapping: 'wrong_text = a wrong_text defect; accept = the judge accepts; an arm with no usable output (empty, < 20 characters without tags, error) = not accepted, not wrong text',
    cells: { [CELL]: { task: 'ocr', lang: 'Korean', pages: ps.length, controls: out.instrument, routes: routes(ps) } }, by_script_cells: by };
}

/** build.py on a copy of origin/main with this export added to korean-lite (lite, agy-flash-low-read; paddle and qwen3-vl-8b as new stage-none routes). */
function router() {
  const sh = (cmd, args, o = {}) => { const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 28, ...o }); if (r.status) throw new Error(`${cmd} ${args.slice(0, 3).join(' ')}: ${r.stderr}`); return r.stdout; };
  sh('git', ['-C', ROOT, 'fetch', '-q', 'origin', 'main']);
  const rulesText = sh('git', ['-C', ROOT, 'show', `origin/main:${RT}/rules.json`]), rules = JSON.parse(rulesText);
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'kc7982-router-'));
  return import('../lane-judge-sampler.mjs').then(({ rebuildInputs }) => {
    const tar = spawnSync('git', ['-C', ROOT, 'archive', '--format=tar', 'origin/main', ...rebuildInputs(rules, RT)], { maxBuffer: 1 << 30 });
    sh('tar', ['-x', '-C', dir], { input: tar.stdout, encoding: undefined });
    const ev = JSON.parse(fs.readFileSync(path.join(RESULTS, 'router-evidence.score.json'), 'utf8'));
    for (const [f, body] of [[EV, ev], [BY, { source: ev.generated_by, of: EV, cells: ev.by_script_cells }]]) for (const base of [dir, ROOT]) { fs.mkdirSync(path.dirname(path.join(base, f)), { recursive: true }); fs.writeFileSync(path.join(base, f), JSON.stringify(body, null, 1) + '\n'); }
    const py = (name, extra = []) => sh('python3', [`${RT}/build.py`, '--name', name, ...extra], { cwd: dir });
    py('baseline');
    const r2 = JSON.parse(rulesText), cell = r2.cells.find((c) => c.id === 'korean-lite');
    const e = (route) => ({ score: EV, cell: CELL, route });
    for (const rt of cell.routes) if (['lite', 'agy-flash-low-read'].includes(rt.id)) rt.evidence = [...(rt.evidence || []), e(rt.id)];
    cell.routes.push({ id: 'paddle', stage: 'none', evidence: [e('paddle')] }, { id: 'qwen3-vl-8b', stage: 'none', evidence: [e('qwen3-vl-8b')] });
    fs.writeFileSync(path.join(dir, RT, 'rules.json'), JSON.stringify(r2, null, 1));
    py('with-7982', ['--before', `${RT}/baseline.json`]);
    const rows = (n) => JSON.parse(fs.readFileSync(path.join(dir, RT, `${n}.json`), 'utf8')).rows.filter((r) => /^korean/.test(r.id))
      .map((r) => ({ id: r.id, pages_waiting: r.pages_waiting, decision: r.decision, route: r.route, decision_kn: r.decision_kn, route_kn: r.route_kn, flags: r.flags ?? null, routes: r.routes.map((x) => ({ id: x.id, k: x.k, n: x.n, wrong: x.wrong, mean: x.mean })) }));
    const res = { main_sha: sh('git', ['-C', ROOT, 'rev-parse', '--short', 'origin/main']).trim(), baseline: rows('baseline'), with_7982: rows('with-7982'),
      note: "what build.py decides with this export added to korean-lite (the stored-lite and agy rows as evidence; paddle and qwen3-vl-8b as new stage-none routes); the checkout's rules.json is NOT changed" };
    R('router-check.json', res);
    for (const k of ['baseline', 'with_7982']) for (const r of res[k]) console.log(`${k} ${r.id}: ${r.decision} → ${r.route} | ${r.routes.map((x) => `${x.id} ${x.k}/${x.n}`).join(', ')}`);
  });
}

const cmd = process.argv[2];
if (cmd === 'score') score();
else if (cmd === 'router') await router();
else console.log('usage: score.mjs score|router');
