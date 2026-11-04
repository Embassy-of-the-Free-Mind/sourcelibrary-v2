#!/usr/bin/env node
// PRIOR ART: scripts/eval/confidence-7866/analyze.mjs --apply — wrote one study's verdicts into lane_judge_verdicts by
// hand-built records ($setOnInsert by _id); one study, no origin, no record of what varied. scripts/lib/book-checks.mjs
// recordPageVerdicts (#8069) — book_checks, another store. Searched scripts/eval/ for "backfill" + lane_judge_verdicts:
// none read test verdict files into the store.
/**
 * backfill-test-verdicts (#7263): the per-page verdicts of finished tests, as `origin: 'test'` rows of
 * lane_judge_verdicts (lib/judge-rows.mjs testRow). ADDITIVE ONLY: insert by deterministic _id; no update, no delete.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/backfill-test-verdicts.mjs [--only=<test,...>]
 *        dry run: builds every row, REPRODUCES each published k/n from the rows, writes the plan to --out (default
 *        $JOB_SCRATCH/backfill-test-verdicts), and reports what it would insert
 *   ... --apply   inserts the rows of every test whose k/n all reproduce. A test that does not reproduce is reported
 *                 and NOT written (never forced). Refuses unless every store reader filters origin (judge-rows.mjs).
 *
 * Tests (one adapter each): the Chinese re-read cell of 2026-11-03 (#8008) and its cheap arms (#8017); #7568's Step T
 * reader (its own scale: misleading / flawed / sound, outcome null); the route-judge folders of
 * route-judge-6740/results/* with key.json (the #7263 router tests and the route-judge pilots); eu-agy-translate-7263;
 * the V4 latin-lite test (#8000) and the Sonnet router test (#8011), whose files keep flags only (no judge words).
 * A verdict file reused by a later test (the same verdict id on the same page and route) is one row, with the later
 * test in `test.also_in`, never two.
 *
 * `router` on each row: the rules.json cell and route the test's (score file, cell, route) feeds, read back from
 * rules.json's own evidence entries; null where rules.json does not name it. For the Chinese files (not named), the
 * page's router cell follows from its stored model (3 Flash = chinese-flash3, Flash-Lite = zh-lite), basis stated.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { testRow, ROUTE_JUDGE, COLLECTION } from './lib/judge-rows.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const R = (p) => path.join(ROOT, p);
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const flag = (n) => process.argv.includes(`--${n}`);
const readJson = (p) => JSON.parse(p.endsWith('.gz') ? zlib.gunzipSync(fs.readFileSync(R(p))).toString() : fs.readFileSync(R(p), 'utf8'));
const readJsonl = (p) => (p.endsWith('.gz') ? zlib.gunzipSync(fs.readFileSync(R(p))).toString() : fs.readFileSync(R(p), 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l));
const EVID = 'scripts/eval/estimator/router-table/evidence/';
const sha = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
const NOW = new Date().toISOString();

/** rules.json evidence entries read backwards: (score basename, cell, route) -> {cell, route} of rules.json. */
export function routerIndex(rules) {
  const ix = new Map();
  for (const c of rules.cells) for (const r of c.routes) for (const e of r.evidence || [])
    ix.set(`${path.basename(e.score)}|${e.cell}|${e.route}`, { cell: c.id, route: r.id, basis: 'rules.json evidence entry' });
  return ix;
}
const RULES = readJson('scripts/eval/estimator/router-table/rules.json');
const RIX = routerIndex(RULES);
const routerOf = (score, cell, route) => RIX.get(`${path.basename(score)}|${cell}|${route}`) ?? null;
const ruleRoutes = new Map(RULES.cells.map((c) => [c.id, new Set(c.routes.map((r) => r.id))]));

const routeJudgeVerdict = (v) => (v && typeof v.accept === 'boolean' ? { accept: v.accept, fidelity: v.fidelity ?? null, defects: v.defects ?? [], reader_note: v.reader_note ?? null } : null);
const judgeOf = (v, instrument = ROUTE_JUDGE) => ({ instrument, model: v?.model ?? 'claude-opus-5-5', prompt_sha: v?.prompt_sha ?? null });
const usd = (v) => (v?.list_usd != null ? Number(v.list_usd) : null);

/** k/n per (cell, route) from built rows: kind item, the route judge's own accept, or a named rule over own words. */
function tally(rows, acceptOf = (r) => r.outcome?.accept) {
  const t = {};
  for (const r of rows.filter((x) => x.kind === 'item')) {
    const k = `${r.cell}|${r.route}`; t[k] ??= { k: 0, n: 0, books: new Set() };
    t[k].n++; if (acceptOf(r)) t[k].k++; t[k].books.add(r.book_id);
  }
  return t;
}
function reproduce(rows, published, acceptOf) {
  const t = tally(rows, acceptOf);
  return published.map((p) => { const g = t[`${p.cell}|${p.route}`]; const got = g ? `${g.k}/${g.n}` : '0/0';
    return { ...p, got, books: g?.books.size ?? 0, ok: got === p.accept }; });
}

// ---------- adapters ----------

/** #8008 / #8017: each arm's served text (texts.tar.gz) joined to its verdict by `${key}:${sha256(text)[:16]}`, as
 * zh-gemini-reocr-7263/analyze.mjs (router-confirm judgeItems) does; the last verdict of an id wins, as there. A text
 * judged once for several arms (an unchanged correction serves its draft) is one verdict and one row per arm. */
function textsOf(dir) {
  const out = path.join(process.env.TMPDIR || '/tmp', `bf-texts-${crypto.createHash('sha256').update(dir).digest('hex').slice(0, 8)}`);
  fs.mkdirSync(out, { recursive: true });
  spawnSync('tar', ['xzf', R(`${dir}/texts.tar.gz`), '-C', out], { stdio: 'inherit' });
  return (stratum, key, arm) => { const f = path.join(out, stratum, 'texts', `${key}.${arm}.txt`); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null; };
}
function zhReocr({ testId, dir, score, record, armsWanted, issue = 7263, parent = null }) {
  const rows = [], published = [];
  const S = readJson(EVID + score), T0 = textsOf(dir), TP = parent ? textsOf(parent) : () => null;
  const T = (st, k, a) => T0(st, k, a) ?? TP(st, k, a);   // the cheap arms re-judged #8008's Opus texts (the retest)
  for (const stratum of ['print', 'siku']) {
    const cell = `chinese-gemini-${stratum}-7263`;
    const plan = readJson(`${dir}/plan-${stratum}.json.gz`);
    const armRoute = new Map(plan.arms.map((a) => [a.arm, a]));
    const all = [...(parent ? readJsonl(`${parent}/verdicts-${stratum}.jsonl.gz`) : []), ...readJsonl(`${dir}/verdicts-${stratum}.jsonl.gz`)].filter((v) => v.verdict);
    const last = new Map(all.map((v) => [v.id, v]));
    const served = new Map(readJsonl(`${dir}/arms-${stratum}.jsonl.gz`).map((x) => [`${x.key}|${x.arm}`, x]));
    const wanted = armsWanted.map((a) => [a.replace('#retest', ''), a.endsWith('#retest') ? 1 : 0]);
    for (const s of plan.selected) for (const [arm, rep] of wanted) {
      const t = T(stratum, s.key, arm); if (t == null) continue;
      const h = sha(t).slice(0, 16), v = last.get(`${s.key}:${h}${rep ? '#retest' : ''}`);
      if (!v) { rows.push({ _error: `${testId} ${s.key} ${arm}${rep ? '#retest' : ''}: no verdict for its text` }); continue; }
      const a = armRoute.get(arm), x = served.get(`${s.key}|${arm}`);
      const base = /flash-lite/.test(s.stored_model) ? { cell: 'zh-lite', r: 'lite' } : /gemini-3-flash|3-flash/.test(s.stored_model) ? { cell: 'chinese-flash3', r: '3flash' } : null;
      const rr = base && { 'gemini-stored': base.r, 'gemini>opus': `${base.r}>opus`, 'gemini>agy-flash-low': `${base.r}>agy-flash-low`, 'gemini>sonnet': `${base.r}>sonnet` }[a.route];
      const router = !rep && base && rr && ruleRoutes.get(base.cell)?.has(rr)
        ? { cell: base.cell, route: rr, script: stratum === 'print' ? 'print' : null, basis: `stored model ${s.stored_model}; ${stratum === 'print' ? 'print stratum' : 'Siku stratum: script not settled, /unknown'}` } : null;
      rows.push(testRow({ kind: 'item', book_id: s.book_id, page_id: s.page_id, page_number: s.page_number, selection: 'random', cell, route: a.route, lang: 'Classical Chinese',
        script_type: stratum === 'print' ? 'print' : null,
        test: { id: testId, issue, record, arm, evidence: `${EVID}${score}`, stratum, served: x?.why ?? null, verdict_id: v.id, verdict_arms: v.arms ?? null }, rep,
        settings: { pages_per_call: a.calls_per_page ? 1 : null, draft_source: a.kind === 'correct' ? (a.route.startsWith('paddle') ? 'paddle' : s.stored_model) : null,
          draft_hash: a.kind === 'correct' && !a.route.startsWith('paddle') ? s.stored_sha ?? null : null, model: a.kind === 'stored' ? s.stored_model : null },
        judge: judgeOf(v), verdict: routeJudgeVerdict(v.verdict), cost: { judge_list_usd: usd(v) }, judged_at: v.at, backfilled_at: NOW, text_hash: h, router }));
    }
    // Wrong-page controls: this test's own (ids wp-...), on the image page.
    const byKey = new Map(plan.selected.map((x) => [x.key, x]));
    for (const v of readJsonl(`${dir}/verdicts-${stratum}.jsonl.gz`).filter((y) => y.set === 'wrong_page' && y.verdict)) {
      const rep = /#retest$/.test(v.id) ? 1 : 0, ctrlArm = (v.arms || [])[0] ?? 'control';
      if (!wanted.some(([arm, r]) => (arm === ctrlArm && r === rep) || (rep && r === 1))) continue;   // a retest's controls go with it
      const img = byKey.get(v.key);
      if (!img) { rows.push({ _error: `wrong_page ${v.id}: image page not in plan` }); continue; }
      rows.push(testRow({ kind: 'wrong_page', book_id: img.book_id, page_id: img.page_id, page_number: img.page_number, selection: 'random', cell, route: armRoute.get(ctrlArm)?.route ?? ctrlArm,
        lang: 'Classical Chinese', test: { id: testId, issue, record, arm: `${ctrlArm}:wrong_page:${v.text_of ?? ''}`, evidence: `${EVID}${score}`, stratum, verdict_id: v.id }, rep,
        judge: judgeOf(v), verdict: routeJudgeVerdict(v.verdict), cost: { judge_list_usd: usd(v) }, judged_at: v.at, backfilled_at: NOW, text_hash: v.text_sha ?? null }));
    }
    for (const [route, x] of Object.entries(S.cells[cell]?.routes ?? {}))
      if (wanted.some(([arm, r]) => !r && armRoute.get(arm)?.route === route)) published.push({ cell, route, accept: x.accept, source: `${EVID}${score}` });
  }
  return { rows, published };
}

/** #7568 Step T: misleading / flawed / sound per arm, its own scale. The score file's rule (accept = not misleading) is
 * used only to REPRODUCE its k/n; the rows keep outcome null. */
function stepT() {
  const rows = [], published = [];
  const score = 'correct-vs-reread-7568.score.json', S = readJson(EVID + score);
  const ARM = { L: 'lite', C: 'lite>opus-correct', R: 'agy-flash-low-read' };
  for (const lang of ['zh', 'de', 'el', 'sa', 'ar']) {
    const cell = `${lang}-lite`, dir = `scripts/eval/flash-reread-5924/results-7568/${lang}`;
    const sample = readJson(`${dir}/sample.json`);
    const pid = new Map();
    for (const b of sample.books || []) for (const p of b.pages || []) pid.set(`${b.book_id ?? b.id}-p${p.page_number ?? p.n ?? p}`, p.page_id ?? p.id ?? null);
    for (const t of readJson(`${dir}/step-t.json`)) {
      const m = String(t.slug).match(/^([0-9a-f]{24})-p(\d+)$/);
      for (const [arm, route] of Object.entries(ARM)) {
        if (!t.V?.[arm]) continue;
        if (!m) { rows.push({ _error: `step-t ${lang} ${t.slug}: no book id in slug` }); continue; }
        rows.push(testRow({ kind: 'item', book_id: m[1], page_id: pid.get(t.slug) ?? null, page_number: Number(m[2]), selection: 'random', cell, route, lang,
          test: { id: 'correct-vs-reread-7568', issue: 7568, record: 'scripts/eval/flash-reread-5924/T-TASK.md', arm, evidence: `${EVID}${score}`, stratum: lang },
          judge: { instrument: 'step-t-7568 (flash-reread-5924/T-TASK.md, blind X/Y/Z with the image)', model: 'claude-opus' },
          verdict: { rating: t.V[arm], defects: t.defects?.[arm] ?? [], why: t.why ?? null, ntl: t.ntl?.[arm] ?? null, strip: t.strip?.[arm] ?? null, prefer: { CL: t.CL ?? null, CR: t.CR ?? null, RL: t.RL ?? null } },
          settings: arm === 'C' ? { draft_source: 'gemini-3.1-flash-lite' } : arm === 'R' ? { model: 'gemini-3.8-flash-low' } : { model: 'gemini-3.1-flash-lite' },
          judged_at: null, backfilled_at: NOW, router: routerOf(score, cell, route) }));
      }
    }
    for (const [route, x] of Object.entries(S.cells[cell]?.routes ?? {})) published.push({ cell, route, accept: x.accept, source: `${EVID}${score}`, rule: 'score file: accept = not misleading' });
  }
  return { rows, published, acceptOf: (r) => r.verdict?.rating && r.verdict.rating !== 'misleading' };
}

/** route-judge-6740/results/<dir>: key.json items joined to verdicts-opus by judged_as (or id). */
function routeJudgeDir(dirName) {
  const dir = `scripts/eval/route-judge-6740/results/${dirName}`;
  const key = readJson(`${dir}/key.json`), V = new Map(readJsonl(`${dir}/verdicts-opus.jsonl.gz`).map((v) => [v.id, v]));
  const S = readJson(`${dir}/score.json`), scorePath = `${dir}/score.json`;
  const issue = Number(dirName.match(/-(\d{4})-/)?.[1] ?? 7263) || 7263;
  const rows = [], published = [];
  for (const k of key) {
    const v = V.get(k.judged_as ?? k.id);
    if (!v) continue;   // an item never judged (skipped packet): no row, and the tally says so
    if (!['item', 'wrong_page', 'draft', 'planted'].includes(k.kind)) continue;
    rows.push(testRow({ kind: k.kind, book_id: k.book_id, page_id: k.page_id ?? null, page_number: k.page_number ?? null, selection: 'random', cell: k.cell, route: k.route,
      lang: S.cells?.[k.cell]?.lang ?? null, task: S.cells?.[k.cell]?.task ?? 'ocr',
      test: { id: `route-judge:${dirName}`, issue, record: `${dir}/`, arm: k.route, evidence: scorePath, stratum: k.cell, verdict_id: v.id }, rep: 0,
      judge: judgeOf(v), verdict: routeJudgeVerdict(v.verdict), cost: { judge_list_usd: usd(v) }, judged_at: v.at ?? null, backfilled_at: NOW,
      settings: { model: null }, router: routerOf(scorePath, k.cell, k.route) }));
  }
  for (const [cell, C] of Object.entries(S.cells || {})) for (const [route, x] of Object.entries(C.routes || {}))
    if (x?.accept) published.push({ cell, route, accept: x.accept, source: scorePath });
  return { rows, published };
}

/** eu-agy-translate-7263: arms r (Flash-Lite English) and a (agy Flash-low, 4 a call), route judge translation form. */
function euAgy() {
  const dir = 'scripts/eval/eu-agy-translate-7263/results', score = 'eu-agy-translate-7263.score.json', S = readJson(EVID + score);
  const plan = readJson(`${dir}/plan.json`);
  const byKey = new Map(Object.values(plan.langs).flatMap((L) => (Array.isArray(L.selected) ? L.selected : [])).map((s) => [s.key, s]));
  const ARM = { r: 'flash-lite', a: 'agy-flash-low@4' };
  const rows = [], published = [];
  for (const v of readJsonl(`${dir}/verdicts.jsonl.gz`)) {
    const s = byKey.get(v.key);
    if (!s) { rows.push({ _error: `eu ${v.id}: key not in plan` }); continue; }
    const cell = `${String(s.lang).toLowerCase()}-tr-first`;
    const arms = v.set === 'wrong_page' ? ['control'] : v.arms || [];
    for (const arm of arms) {
      const route = ARM[arm] ?? arm;
      rows.push(testRow({ kind: v.set === 'wrong_page' ? 'wrong_page' : 'item', book_id: s.book_id, page_id: s.page_id ?? null, page_number: s.page_number ?? null, selection: 'random', cell, route, lang: s.lang, task: 'translation',
        test: { id: 'eu-agy-translate-7263', issue: 7263, record: 'scripts/eval/eu-agy-translate-7263/', arm, evidence: `${EVID}${score}`, stratum: s.lang },
        settings: { pages_per_call: arm === 'a' ? 4 : null, model: arm === 'a' ? 'gemini-3.8-flash-low' : arm === 'r' ? 'gemini-3.1-flash-lite' : null },
        judge: judgeOf(v), verdict: routeJudgeVerdict(v.verdict), cost: { judge_list_usd: usd(v) }, judged_at: v.at, backfilled_at: NOW, text_hash: v.text_sha ?? null, router: routerOf(score, cell, route) }));
    }
  }
  for (const [cell, C] of Object.entries(S.cells)) for (const [route, x] of Object.entries(C.routes)) published.push({ cell, route, accept: x.accept, source: `${EVID}${score}` });
  return { rows, published };
}

/** Flag-only files (no judge words kept): V4 latin-lite (#8000) and the Sonnet router test (#8011). */
function flagsOnly({ testId, file, score, cellOf, arms, record, issue = 7263 }) {
  const J = readJson(file), S = readJson(EVID + score), rows = [], published = [];
  const groups = Array.isArray(J.per_page) ? { _: J.per_page } : J;
  for (const [g, pages] of Object.entries(groups)) for (const p of pages) for (const [arm, route] of Object.entries(arms(g))) {
    const f = arm === '_' ? p : p[arm] ?? p.stored?.[arm];
    if (!f || typeof f.accept !== 'boolean') continue;
    const cell = cellOf(g);
    rows.push(testRow({ kind: 'item', book_id: p.book_id, page_id: p.page_id ?? null, page_number: p.page_number ?? null, selection: 'random', cell, route, script_type: p.script ?? (score.includes('v4') ? 'print' : null),
      test: { id: testId, issue, record, arm, evidence: `${EVID}${score}`, stratum: g === '_' ? null : g },
      judge: { instrument: ROUTE_JUDGE, model: 'claude-opus-5-5' },
      verdict: { accept: f.accept, fidelity: f.fidelity ?? null, defects: [], reader_note: null, words_kept: false, wrong_text: !!f.wrong },
      outcome: { accept: f.accept, wrong_text: !!f.wrong, mapped_by: 'own fields as the test kept them (accept, wrong); judge words not kept' },
      judged_at: null, backfilled_at: NOW, router: routerOf(score, cell, route) }));
  }
  for (const [cell, C] of Object.entries(S.cells)) for (const [route, x] of Object.entries(C.routes))
    if (rows.some((r) => r.cell === cell && r.route === route)) published.push({ cell, route, accept: x.accept, source: `${EVID}${score}` });
  return { rows, published };
}

export const TESTS = {
  'zh-gemini-reocr-7263': () => zhReocr({ testId: 'zh-gemini-reocr-7263', dir: 'scripts/eval/zh-gemini-reocr-7263/results', score: 'zh-gemini-reocr-7263.score.json',
    record: 'scripts/eval/experiments/2026-11-03-zh-gemini-reocr-cell-7263.md', armsWanted: ['served', 'P', 'O', 'Pu'] }),
  // The cheap-arms file re-lists #8008's verdicts (a new arm whose text equals an old one shares its verdict): only the
  // new arms and the Opus retest are taken from it, so #8008's arms are never two rows.
  'zh-reocr-cheap-arms-7263': () => zhReocr({ testId: 'zh-reocr-cheap-arms-7263', dir: 'scripts/eval/zh-gemini-reocr-7263/results/cheap-arms', score: 'zh-reocr-cheap-arms-7263.score.json',
    record: 'scripts/eval/experiments/2026-11-03-zh-reocr-cheap-arms-7263.md', armsWanted: ['PFL', 'PFM', 'SFL', 'PSN', 'SSN', 'O#retest'], parent: 'scripts/eval/zh-gemini-reocr-7263/results' }),
  'correct-vs-reread-7568': stepT,
  'eu-agy-translate-7263': euAgy,
  'router-v4-latin-lite-7263': () => flagsOnly({ testId: 'router-v4-latin-lite-7263', file: 'scripts/eval/results/router-v4-latin-lite/latin-lite-print-2026-11-03.json', score: 'router-v4-latin-lite-7263.score.json',
    cellOf: () => 'latin-lite-v4', arms: () => ({ served: 'lite', B: 'lite>agy-flash-low', C: 'agy-flash-low@4-read' }), record: 'scripts/eval/experiments/2026-11-03-router-v4-latin-lite-7263.md' }),
  'sonnet-router-7263': () => flagsOnly({ testId: 'sonnet-router-7263', file: 'scripts/eval/results/sonnet-router-7263/verdicts.json', score: 'sonnet-router-7263.score.json',
    cellOf: (g) => g, arms: (g) => ({ _: g === 'latin-lite' ? 'lite>sonnet' : 'sonnet-read' }), record: 'scripts/eval/experiments/2026-11-03-sonnet-router-7263.md' }),
  ...Object.fromEntries(['pilot-2026-10-26', 'router-tests-2026-10-26', 'tibetan-30-2026-10-27', 'router-tests-2026-10-28', 'router-next-2026-10-28', 'agy-opus-7545-2026-10-28', 'fresh-7517-2026-10-27',
    'first-read-7701-2026-10-29'].map((d) => [`route-judge:${d}`, () => routeJudgeDir(d)])),
};

/** Same verdict reused by a later test (route-judge folders reuse the pilot's): one row, the later test in also_in. */
export function dedupeAcross(built) {
  const seen = new Map(), out = [];
  for (const [testId, b] of built) for (const r of b.rows) {
    if (r._error) continue;
    // The same judgment: same page, route and kind, and the judge's own words identical (a flag-only verdict has no
    // words and is never merged). Route-judge folders copied earlier tests' verdicts under new ids (10-26 pilot ->
    // router tests -> fresh-7517), so the id alone does not find them.
    const words = r.verdict && (r.verdict.reader_note || r.verdict.why || (r.verdict.defects || []).length) ? sha(JSON.stringify(r.verdict)) : null;
    const vk = words && `${r.page_id ?? `${r.book_id}:${r.page_number}`}|${r.cell}|${r.route}|${r.kind}|${r.test.arm}|${words}`;
    if (vk && seen.has(vk)) { (seen.get(vk).test.also_in ??= []).push(testId); continue; }
    if (vk) seen.set(vk, r);
    out.push(r);
  }
  return out;
}

async function main() {
  const only = arg('only')?.split(',');
  const OUT = path.resolve(arg('out') || path.join(process.env.JOB_SCRATCH || process.env.TMPDIR || '/tmp', 'backfill-test-verdicts'));
  fs.mkdirSync(OUT, { recursive: true });
  const built = [], report = { at: NOW, tests: {} };
  for (const [id, fn] of Object.entries(TESTS)) {
    if (only && !only.includes(id)) continue;
    let b; try { b = fn(); } catch (e) { report.tests[id] = { error: String(e.message || e) }; console.log(`${id}: ERROR ${e.message}`); continue; }
    const errors = b.rows.filter((r) => r._error).map((r) => r._error);
    const rep = reproduce(b.rows.filter((r) => !r._error && (r.test.rep ?? 0) === 0), b.published.filter((p) => p.accept != null), b.acceptOf);
    const kinds = {}; for (const r of b.rows.filter((x) => !x._error)) kinds[r.kind] = (kinds[r.kind] || 0) + 1;
    const ok = rep.length > 0 && rep.every((x) => x.ok) && !errors.length;
    report.tests[id] = { rows: b.rows.length - errors.length, kinds, books: new Set(b.rows.filter((r) => !r._error).map((r) => r.book_id)).size, errors: errors.slice(0, 5), errors_n: errors.length,
      reproduced: rep.filter((x) => x.ok).length, published: rep.length, not_reproduced: rep.filter((x) => !x.ok), ok,
      unmapped_outcome: b.rows.filter((r) => !r._error && r.outcome == null).length, no_router: b.rows.filter((r) => !r._error && r.kind === 'item' && !r.router).length };
    console.log(`${ok ? 'OK ' : 'NO '} ${id}: ${report.tests[id].rows} rows ${JSON.stringify(kinds)}, k/n reproduced ${report.tests[id].reproduced}/${rep.length}${errors.length ? `, ${errors.length} errors` : ''}`);
    for (const x of rep.filter((y) => !y.ok)) console.log(`     ${x.cell} / ${x.route}: published ${x.accept}, rows give ${x.got}`);
    if (ok) built.push([id, b]);
  }
  const rows = dedupeAcross(built);
  report.insert = { rows: rows.length, tests: built.map(([id]) => id), also_in: rows.filter((r) => r.test.also_in).length };
  fs.writeFileSync(path.join(OUT, 'plan.jsonl.gz'), zlib.gzipSync(rows.map((r) => JSON.stringify(r)).join('\n') + '\n'));
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1) + '\n');
  console.log(`\n${rows.length} rows from ${built.length} reproduced tests (${report.insert.also_in} carry also_in); plan ${OUT}/plan.jsonl.gz`);
  if (!flag('apply')) { console.log('DRY RUN: nothing written; --apply to insert'); return; }
  // Readers first (#7263): no test row is written until origin/main's readers filter them.
  const { execFileSync } = await import('node:child_process');
  try { execFileSync('git', ['fetch', '-q', 'origin', 'main'], { cwd: ROOT }); execFileSync('git', ['cat-file', '-e', 'origin/main:scripts/eval/lib/judge-rows.mjs'], { cwd: ROOT }); }
  catch { console.error('REFUSED: origin/main has no scripts/eval/lib/judge-rows.mjs: the readers do not filter test rows yet'); process.exit(3); }
  const { MongoClient } = await import('mongodb');
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  try {
    const col = c.db('bookstore').collection(COLLECTION);
    // Another session may have exported the same test (zh-print-arms-7263 and others): never a second copy.
    const held = new Set((await col.distinct('test.id', { origin: 'test' })).filter(Boolean));
    const todo = rows.filter((r) => !held.has(r.test.id));
    if (held.size) console.log(`already in the store, skipped: ${[...held].join(', ')}`);
    let inserted = 0, dup = 0;
    for (let i = 0; i < todo.length; i += 500) {
      try { const res = await col.insertMany(todo.slice(i, i + 500), { ordered: false }); inserted += res.insertedCount; }
      catch (e) { if (e.code !== 11000 && !e.writeErrors) throw e; inserted += e.result?.insertedCount ?? e.insertedCount ?? 0; dup += (e.writeErrors || []).length; }
    }
    console.log(`inserted ${inserted}, already there ${dup}`);
    report.applied = { inserted, already_there: dup, skipped_tests: [...held] };
    fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1) + '\n');
  } finally { await c.close(); }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) await main();
