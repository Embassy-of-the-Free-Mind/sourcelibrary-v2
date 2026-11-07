#!/usr/bin/env node
// PRIOR ART: scripts/eval/route-judge-6740/judge.mjs — the instrument this is the recipe for: its draw (one page per
// book), its blind packet and key (key.json: kind item | wrong_page | planted, judged_as an opaque id), its verdict
// files (verdicts-<judge>.jsonl[.gz]) and its clusterCI are reused as they are. It does not fit as the recipe: its
// stages are wired to named cells (latin, tib-kangyur, zh-dice …) and its score() is one 170-line function per cell
// family, so 94 of 137 paired-arm runs rebuilt their own copy (experiment-kinds-6553 §6). This file adds only what a
// prose skill cannot enforce, over ANY run that writes judge.mjs's files. defect-rate.py stays the rule for defect
// rates per 1,000 words; this exports a simple-ratio file of the shape the experiments lint accepts, and says so.
/**
 * The paired-arm-judge recipe (#6553; skill: .claude/skills/paired-arm-judge/SKILL.md). Two or more arms (routes,
 * prompts, models) read the same pages; a blind judge scores each output against the page image.
 *
 *   node scripts/eval/route-judge-6740/paired-arm.mjs init     --out=DIR            # writes DIR/recipe.json to fill in
 *   node scripts/eval/route-judge-6740/paired-arm.mjs check    --out=DIR            # exit 1 if a rule below fails
 *   node scripts/eval/route-judge-6740/paired-arm.mjs score    --out=DIR [--compare=score.json]
 *   node scripts/eval/route-judge-6740/paired-arm.mjs skeleton --out=DIR --slug=<slug> [--date=YYYY-MM-DD]
 *
 * DIR holds judge.mjs's files: key.json, verdicts-<judge>.jsonl[.gz], and (when the packet was kept) packet.json and
 * sample.json; plus recipe.json, the run's stated design (init writes the template). `check` runs BEFORE judging
 * (on key.json and recipe.json) and again before scoring. Its rules, each a failure seen in the ledger:
 *   R1 one page per book per arm            (pooled pages from one book read as independent evidence)
 *   R2 arm names blind                       (judged_as / packet ids or fields carry no arm name)
 *   R3 a wrong-page control per arm          (a judge that accepts the wrong leaf is not reading the image)
 *   R4 a noise floor                         (`repeat` key rows: the same arm's output judged twice, >= 5 pages; or
 *                                             recipe.noise_floor.from naming an earlier measurement of this judge)
 *   R5 batch size stated                     (recipe.batch.pages_per_call; > 1 needs recipe.batch.tested: a path, or
 *                                             "not tested — <why>")
 *   R6 neighbouring scans for a leaf question (recipe.question = "leaf": every item carries `neighbours`)
 *   R7 the score file exported               (score: DIR/paired-score.json, the file the write-up cites)
 * A rule the run cannot meet is waived in recipe.json `waive: { R4: "<why>" }`; the waiver is printed in the skeleton.
 *
 * `score` reads every verdicts-*.jsonl[.gz] (one judge each) and writes DIR/paired-score.json: per judge, cell and arm,
 * accept and wrong_text k/n with Wilson and by-book intervals, mean fidelity, the controls, the noise floor (how often
 * the same arm's repeat flips accept), and each arm against recipe.baseline on shared pages (better / worse, accept
 * gained / lost, a sign test). With packet.json it adds misleads and wrong_text per 1,000 words (a simple ratio).
 * `--compare=<judge.mjs score.json>` checks every arm's accept and wrong_text k/n against it, and exits 1 on a mismatch.
 *
 * `skeleton` writes DIR/writeup.md: the header (feeds, router_evidence, defect_rates) and the tables, ready to copy to
 * scripts/eval/experiments/<date>-<slug>.md once the verdict and decision are written. No model calls, no database.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { clusterCI } from './judge.mjs';
import { wilson } from '../lib/agreement-stats.mjs';
import { mean, binomTwoSided } from '../lib/paired-stats.mjs';
import { serializeHeader, readExperiment } from '../lib/experiment-header.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');

const readMaybeGz = (f) => (f.endsWith('.gz') ? zlib.gunzipSync(fs.readFileSync(f)).toString('utf8') : fs.readFileSync(f, 'utf8'));
const jsonl = (t) => t.split('\n').filter(Boolean).map((l) => JSON.parse(l));
const r2 = (x) => (x == null ? null : +x.toFixed(2));
const words = (t) => String(t || '').split(/\s+/).filter(Boolean).length;

export const RECIPE_TEMPLATE = {
  question: 'route',            // "route" | "prompt" | "model" | "leaf" (which leaf/page does this text belong to)
  issue: null,
  stage: 'ocr',                 // the experiments-header stage
  languages: [],
  baseline: null,               // the arm the others are compared with: usually the live route
  arms: [],                     // every arm, as key.json names them
  batch: { pages_per_call: 1, tested: null },
  noise_floor: { repeat_kind: 'repeat', from: null },
  feeds: 'route',
  router_evidence: null,        // router-table cell ids this run adds evidence to, or "none — <why>"
  waive: {},
};

/** Load a run directory: key rows, packet (optional), recipe, and verdicts by judge. */
export function loadRun(dir) {
  const J = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const has = (f) => fs.existsSync(path.join(dir, f));
  const key = has('key.json') ? J('key.json') : [];
  const packet = has('packet.json') ? J('packet.json').items || [] : null;
  const recipe = has('recipe.json') ? J('recipe.json') : null;
  const verdicts = {};
  for (const f of fs.readdirSync(dir).filter((n) => /^verdicts-[\w-]+\.jsonl(\.gz)?$/.test(n)).sort()) {
    const judge = f.replace(/^verdicts-|\.jsonl(\.gz)?$/g, '');
    const m = (verdicts[judge] ??= new Map());
    for (const r of jsonl(readMaybeGz(path.join(dir, f)))) if (r.verdict && !m.has(r.id)) m.set(r.id, r.verdict);
  }
  return { key, packet, recipe, verdicts };
}

/** The rules R1–R6. Returns [{ rule, ok, detail, waived }]. */
export function checkRun({ key, packet, recipe }) {
  const out = [];
  const waive = recipe?.waive || {};
  const push = (rule, ok, detail) => out.push({ rule, ok: ok || !!waive[rule], detail: waive[rule] && !ok ? `WAIVED: ${waive[rule]} (${detail})` : detail, waived: !ok && !!waive[rule] });
  const items = key.filter((k) => k.kind === 'item');
  const arms = [...new Set(items.map((k) => `${k.cell ?? '-'}\t${k.route}`))];
  if (!recipe) out.push({ rule: 'R0', ok: false, detail: 'no recipe.json: run `init` and state the design before judging' });
  if (!items.length) out.push({ rule: 'R0', ok: false, detail: 'key.json has no item rows' });

  // R1: one page per book per arm.
  const dup = [];
  for (const a of arms) {
    const [cell, route] = a.split('\t');
    const books = new Map();
    for (const k of items.filter((x) => (x.cell ?? '-') === cell && x.route === route)) books.set(k.book_id, (books.get(k.book_id) ?? 0) + 1);
    const over = [...books].filter(([, n]) => n > 1);
    if (over.length) dup.push(`${cell}/${route}: ${over.length} book(s) with more than one page (${over.slice(0, 3).map(([b, n]) => `${b}×${n}`).join(', ')})`);
  }
  push('R1', !dup.length, dup.length ? dup.join('; ') : `${arms.length} arm(s), one page per book each`);

  // R2: no arm name in the ids the judge sees, nor as a field value of a packet item.
  const routes = [...new Set(key.map((k) => k.route).filter(Boolean))];
  const leaks = [];
  const named = (s) => routes.find((r) => r.length >= 3 && String(s).toLowerCase().includes(r.toLowerCase()));
  for (const k of key) { const r = named(k.judged_as); if (r) leaks.push(`judged_as ${k.judged_as} names ${r}`); }
  if (packet) for (const it of packet) for (const [f, v] of Object.entries(it)) {
    if (f === 'text' || f === 'source' || f === 'prompt' || typeof v !== 'string') continue;
    if (routes.includes(v) || /^(route|arm|engine|model)$/i.test(f)) leaks.push(`packet item ${it.id} field '${f}' = ${String(v).slice(0, 40)}`);
  }
  push('R2', !leaks.length, leaks.length ? `${leaks.length} leak(s): ${leaks.slice(0, 3).join('; ')}` : `ids opaque${packet ? ', packet fields carry no arm name' : ' (no packet.json kept; ids only)'}`);

  // R3: a wrong-page control for every arm.
  const noCtl = arms.filter((a) => { const [cell, route] = a.split('\t'); return !key.some((k) => k.kind === 'wrong_page' && (k.cell ?? '-') === cell && k.route === route); });
  push('R3', !noCtl.length, noCtl.length ? `no wrong_page control for ${noCtl.map((a) => a.replace('\t', '/')).join(', ')}` : `controls for all ${arms.length} arm(s)`);

  // R4: a noise floor.
  const rk = recipe?.noise_floor?.repeat_kind || 'repeat';
  const reps = key.filter((k) => k.kind === rk);
  const from = recipe?.noise_floor?.from;
  const fromOk = from && fs.existsSync(path.join(ROOT, from));
  push('R4', reps.length >= 5 || fromOk, reps.length >= 5 ? `${reps.length} same-arm repeat rows` : fromOk ? `noise floor from ${from}` : `no noise floor: ${reps.length} '${rk}' rows (need >= 5) and no recipe.noise_floor.from${from ? ` (${from} does not exist)` : ''}`);

  // R5: batch size stated, and tested when > 1.
  const b = recipe?.batch;
  const ppc = b?.pages_per_call;
  const tested = b?.tested;
  const testedOk = tested && (/^not tested\s+[—-]+\s*\S/.test(tested) || fs.existsSync(path.join(ROOT, tested)));
  push('R5', Number.isInteger(ppc) && ppc >= 1 && (ppc === 1 || testedOk),
    !Number.isInteger(ppc) ? 'recipe.batch.pages_per_call not stated' : ppc === 1 ? '1 page a call' : testedOk ? `${ppc} pages a call; tested: ${tested}` : `${ppc} pages a call, and recipe.batch.tested is neither a path nor "not tested — <why>"`);

  // R6: neighbours for a leaf question.
  if (recipe?.question === 'leaf') {
    const src = packet || items;
    const bare = src.filter((x) => (packet ? true : x.kind === 'item') && !(Array.isArray(x.neighbours) && x.neighbours.length));
    push('R6', !bare.length, bare.length ? `${bare.length} item(s) without neighbouring scans: a which-leaf question needs the leaves either side` : 'every item carries its neighbours');
  }
  return out;
}

const pct = (k, n) => `${k}/${n}`;
const wrongText = (v) => (v.defects || []).some((d) => d.severity === 'wrong_text');
const misleads = (v) => (v.defects || []).filter((d) => d.severity === 'misleads').length;
const wrongTextN = (v) => (v.defects || []).filter((d) => d.severity === 'wrong_text').length;

/** Score every judge × cell × arm. Pure over loadRun()'s output. */
export function scoreRun({ key, packet, recipe, verdicts }) {
  const textOf = packet ? new Map(packet.map((it) => [it.id, it.text])) : null;
  const report = { generated_by: 'scripts/eval/route-judge-6740/paired-arm.mjs score (#6553)', recipe, judges: {} };
  const cells = [...new Set(key.map((k) => k.cell ?? '-'))];
  for (const [judge, V] of Object.entries(verdicts)) {
    const vOf = (k) => V.get(k.judged_as);
    const J = report.judges[judge] = { cells: {} };
    for (const cell of cells) {
      const ks = key.filter((k) => (k.cell ?? '-') === cell);
      const routes = [...new Set(ks.filter((k) => k.kind === 'item').map((k) => k.route))];
      const C = J.cells[cell] = { routes: {}, controls: {}, noise_floor: null, against_baseline: {} };
      for (const route of routes) {
        const got = ks.filter((k) => k.kind === 'item' && k.route === route && vOf(k));
        const acc = got.filter((k) => vOf(k).accept), wt = got.filter((k) => wrongText(vOf(k)));
        const wp = ks.filter((k) => k.kind === 'wrong_page' && k.route === route && vOf(k)).map(vOf);
        C.controls[route] = { n: wp.length, passed: wp.length > 0 && wp.every((v) => !v.accept && Number(v.fidelity) <= 2) };
        const R = C.routes[route] = {
          n: got.length, books: new Set(got.map((k) => k.book_id)).size, unjudged: ks.filter((k) => k.kind === 'item' && k.route === route && !vOf(k)).length,
          accept: pct(acc.length, got.length), accept_wilson: got.length ? wilson(acc.length, got.length).map((x) => +x.toFixed(3)) : null,
          accept_by_book: clusterCI(got.map((k) => ({ book: k.book_id, v: vOf(k).accept ? 1 : 0 })), 6740).ci95,
          wrong_text_pages: pct(wt.length, got.length), wrong_text_wilson: got.length ? wilson(wt.length, got.length).map((x) => +x.toFixed(3)) : null,
          fidelity_mean: got.length ? r2(mean(got.map((k) => Number(vOf(k).fidelity)))) : null,
          counts: C.controls[route].passed,
        };
        if (textOf) {
          const w = got.reduce((a, k) => a + words(textOf.get(k.judged_as)), 0);
          if (w) Object.assign(R, { words: w, misleads_per_1k: r2((1000 * got.reduce((a, k) => a + misleads(vOf(k)), 0)) / w), wrong_text_per_1k: r2((1000 * got.reduce((a, k) => a + wrongTextN(vOf(k)), 0)) / w) });
        }
      }
      // Noise floor: the same arm's output on the same page judged twice; how often does accept flip?
      const rk = recipe?.noise_floor?.repeat_kind || 'repeat';
      const pairs = ks.filter((k) => k.kind === rk && vOf(k)).map((r) => [ks.find((k) => k.kind === 'item' && k.route === r.route && k.page_id === r.page_id && vOf(k)), r]).filter(([a]) => a);
      if (pairs.length) {
        const flips = pairs.filter(([a, b]) => vOf(a).accept !== vOf(b).accept).length;
        C.noise_floor = { pairs: pairs.length, accept_flips: pct(flips, pairs.length), flip_rate: r2(flips / pairs.length), fidelity_abs_diff: r2(mean(pairs.map(([a, b]) => Math.abs(Number(vOf(a).fidelity) - Number(vOf(b).fidelity))))) };
      } else if (recipe?.noise_floor?.from) C.noise_floor = { from: recipe.noise_floor.from };
      // Each arm against the baseline, on the pages both have.
      const base = recipe?.baseline;
      if (base && routes.includes(base)) for (const route of routes.filter((r) => r !== base)) {
        const pp = ks.filter((k) => k.kind === 'item' && k.route === base && vOf(k)).map((a) => [a, ks.find((b) => b.kind === 'item' && b.route === route && b.page_id === a.page_id && vOf(b))]).filter(([, b]) => b);
        const d = pp.map(([a, b]) => Number(vOf(b).fidelity) - Number(vOf(a).fidelity));
        const gained = pp.filter(([a, b]) => !vOf(a).accept && vOf(b).accept).length, lost = pp.filter(([a, b]) => vOf(a).accept && !vOf(b).accept).length;
        C.against_baseline[`${base} -> ${route}`] = { shared_pages: pp.length, better: pct(d.filter((x) => x > 0).length, pp.length), worse: pct(d.filter((x) => x < 0).length, pp.length),
          accept_gained: gained, accept_lost: lost, accept_sign_test_p: gained + lost ? r2(binomTwoSided(gained, gained + lost)) : null, fidelity_diff: r2(mean(d)) };
      }
    }
  }
  return report;
}

/** Compare paired-score's k/n with a judge.mjs score.json (cells.<cell>.routes.<route>.accept / wrong_text_pages). */
export function compareScores(report, judgeScore, judge = 'opus') {
  const rows = [];
  for (const [cell, C] of Object.entries(judgeScore.cells || {})) for (const [route, x] of Object.entries(C.routes || {})) {
    const mine = report.judges[judge]?.cells[cell]?.routes[route];
    for (const f of ['accept', 'wrong_text_pages']) rows.push({ cell, route, field: f, published: x[f], rescored: mine?.[f] ?? null, ok: mine?.[f] === x[f] });
  }
  return rows;
}

/** The write-up skeleton: a valid header plus the tables. */
export function skeleton(report, { date, slug }) {
  const rc = report.recipe || {};
  const judges = Object.keys(report.judges);
  const first = report.judges[judges[0]] || { cells: {} };
  const allRoutes = Object.values(first.cells).flatMap((c) => Object.values(c.routes));
  const nPages = Math.max(0, ...allRoutes.map((r) => r.n));
  const nBooks = Math.max(0, ...allRoutes.map((r) => r.books));
  const scoreRel = `scripts/eval/route-judge-6740/results/${slug}/paired-score.json`;
  const hasRates = allRoutes.some((r) => 'wrong_text_per_1k' in r);
  const header = {
    stage: rc.stage || 'ocr', measure: 'judged', languages: rc.languages || [], scripts: [], canons: [], n_books: nBooks || null, n_pages: nPages || null,
    verdict: 'TODO: one line, what the run found, with k/n', status: 'undecided', decision: 'TODO: what changes, with the PR', feeds: rc.feeds || 'route',
    supersedes: [], superseded_by: null, issue: rc.issue ? [rc.issue] : [],
    ...(['ocr', 'translation'].includes(rc.stage || 'ocr') && {
      router_evidence: rc.router_evidence || 'none — TODO: name the router-table cells, or say why none',
      defect_rates: hasRates ? scoreRel : 'none — TODO: run defect-rate.py, or say why none',
    }),
  };
  const lines = [serializeHeader(header).trimEnd(), `PRIOR ART: TODO — the earlier tests of this question (grep scripts/eval/experiments/ for the cell).`, '',
    `## ${date} · TODO: the question (#${rc.issue ?? 'TODO'})`, '',
    `**Design.** ${rc.question || 'route'} question; arms ${(rc.arms || []).join(', ') || 'TODO'}; baseline ${rc.baseline ?? 'none'}; judges ${judges.join(', ')}; one page per book; ` +
    `${rc.batch?.pages_per_call ?? '?'} page(s) a call${rc.batch?.tested ? ` (batch: ${rc.batch.tested})` : ''}. Score file: \`${scoreRel}\` (paired-arm.mjs).`, ''];
  for (const j of judges) for (const [cell, C] of Object.entries(report.judges[j].cells)) {
    lines.push(`**${cell}, judge ${j}.**`, '', '| arm | accept | by-book 95% | wrong text | fidelity | control |', '|---|---|---|---|---|---|');
    for (const [route, x] of Object.entries(C.routes)) lines.push(`| ${route} | ${x.accept} | ${x.accept_by_book ? x.accept_by_book.join('–') : '—'} | ${x.wrong_text_pages} | ${x.fidelity_mean ?? '—'} | ${C.controls[route].passed ? 'pass' : `FAIL (${C.controls[route].n})`} |`);
    lines.push('');
    for (const [p, m] of Object.entries(C.against_baseline)) lines.push(`- ${p}: on ${m.shared_pages} shared pages better ${m.better}, worse ${m.worse}; accept gained ${m.accept_gained}, lost ${m.accept_lost} (sign test p ${m.accept_sign_test_p ?? '—'}).`);
    lines.push(`- Noise floor: ${C.noise_floor ? (C.noise_floor.pairs ? `the same arm judged twice flips accept on ${C.noise_floor.accept_flips} pages` : `from ${C.noise_floor.from}`) : 'NONE MEASURED'}.`, '');
  }
  const waived = Object.entries(rc.waive || {});
  if (waived.length) lines.push(`**Recipe rules waived.** ${waived.map(([r, w]) => `${r}: ${w}`).join('; ')}.`, '');
  lines.push('### Replicated?', '', 'TODO: no / a held-out draw / a second judge family.', '');
  return lines.join('\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const stage = process.argv[2];
  const dir = arg('out') && path.resolve(arg('out'));
  if (!dir || !['init', 'check', 'score', 'skeleton'].includes(stage)) { console.error('usage: paired-arm.mjs init|check|score|skeleton --out=DIR [--compare=score.json] [--slug=S]'); process.exit(2); }
  fs.mkdirSync(dir, { recursive: true });
  if (stage === 'init') {
    const f = path.join(dir, 'recipe.json');
    if (fs.existsSync(f)) { console.error(`${f} exists; edit it`); process.exit(2); }
    fs.writeFileSync(f, JSON.stringify(RECIPE_TEMPLATE, null, 2) + '\n');
    console.log(`wrote ${f}: state the arms, baseline, batch and noise floor BEFORE judging`);
    process.exit(0);
  }
  const run = loadRun(dir);
  const checks = checkRun(run);
  for (const c of checks) console.log(`${c.ok ? (c.waived ? 'WAIVED' : 'ok    ') : 'FAIL  '} ${c.rule} ${c.detail}`);
  const failed = checks.filter((c) => !c.ok);
  if (stage === 'check') process.exit(failed.length ? 1 : 0);
  if (!Object.keys(run.verdicts).length) { console.error('no verdicts-*.jsonl[.gz] in DIR'); process.exit(2); }
  const report = scoreRun(run);
  report.checks = checks;
  if (stage === 'score') {
    fs.writeFileSync(path.join(dir, 'paired-score.json'), JSON.stringify(report, null, 1) + '\n');
    for (const [j, J] of Object.entries(report.judges)) for (const [cell, C] of Object.entries(J.cells)) for (const [route, x] of Object.entries(C.routes))
      console.log(`${j} ${cell}/${route}: accept ${x.accept} [${x.accept_by_book?.join(', ') ?? '—'}] wrong_text ${x.wrong_text_pages} fid ${x.fidelity_mean} control ${C.controls[route].passed ? 'pass' : 'FAIL'}`);
    console.log(`wrote ${path.relative(ROOT, path.join(dir, 'paired-score.json'))}${failed.length ? `; ${failed.length} recipe rule(s) failed, printed above: the skeleton will say so` : ''}`);
    const cmp = arg('compare');
    if (cmp) {
      const rows = compareScores(report, JSON.parse(fs.readFileSync(path.resolve(cmp), 'utf8')));
      const bad = rows.filter((r) => !r.ok);
      console.log(`compare with ${cmp}: ${rows.length - bad.length}/${rows.length} k/n match`);
      for (const r of bad) console.log(`  MISMATCH ${r.cell}/${r.route} ${r.field}: published ${r.published}, rescored ${r.rescored}`);
      process.exit(bad.length ? 1 : 0);
    }
    process.exit(0);
  }
  // skeleton
  const slug = arg('slug');
  if (!slug) { console.error('--slug=<slug> required (the write-up and results directory name)'); process.exit(2); }
  const date = arg('date') || new Date().toISOString().slice(0, 10);
  let text = skeleton(report, { date, slug });
  if (failed.length) text = text.replace('### Replicated?', `**Recipe rules FAILED.** ${failed.map((c) => `${c.rule}: ${c.detail}`).join('; ')}.\n\n### Replicated?`);
  const { problems } = readExperiment(text, { name: `${date}-${slug}.md` });
  fs.writeFileSync(path.join(dir, 'writeup.md'), text);
  console.log(`wrote ${path.join(dir, 'writeup.md')}${problems.length ? `; header problems: ${problems.join('; ')}` : ' (header valid)'}; fill the TODOs, then copy it to scripts/eval/experiments/${date}-${slug}.md`);
}
