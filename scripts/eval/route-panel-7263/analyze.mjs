#!/usr/bin/env node
// PRIOR ART: scripts/eval/router-confirm/confirm.mjs per1k (severe defects per 1,000 words of the page, bootstrap over
// pages), scripts/eval/confidence-7866/regrade.mjs gradeOf/bandOf (the bands, imported), scripts/eval/lib/agreement-stats.mjs
// wilson, scripts/eval/route-judge-6740/paired-arm.mjs (key.json + verdicts files; this exports them and runs its score).
/**
 * The panel's results, as read from the run's files. No model call, no database write unless --store.
 *   node --env-file=... analyze.mjs                 OUT/results.json, and exports key.json + verdicts per cell
 *   node --env-file=... analyze.mjs --store         also upserts the verdicts into lane_judge_verdicts as origin 'test'
 */
import fs from 'node:fs';
import path from 'node:path';
import { OUT, CELLS, SEED, arg, flag, cellOf, selected, jsonl, sha, unit, readText, writeJ, costOf, category } from './lib.mjs';
import { wilson, aucLowerIsPositive } from '../lib/agreement-stats.mjs';
import { levenshtein } from '../lib/metrics.mjs';
import { stripMarkupTags } from '../../lib/strip-markup-tags.mjs';
import { gradeOf, bandOf, seriousSpans, BANDS, MANY_ERRORS_AT } from '../confidence-7866/regrade.mjs';
import { testRow, ROUTE_JUDGE, COLLECTION } from '../lib/judge-rows.mjs';

const GPU_S_PER_PAGE = (() => { try { const t = fs.readFileSync(path.join(OUT, 'latin/gpu/pero.log'), 'utf8'); return Number(/\(([\d.]+) s\/page\)/.exec(t)?.[1]) || null; } catch { return null; } })();
const TEST = { id: 'route-panel-1-7263', issue: 7263, record: 'scripts/eval/experiments/2026-11-04-route-panel-1-7263.md' };
const norm = (t) => String(t).trim();
const PRIVATE = (name) => `r2://sl-corpus-snapshots/eval-private/route-panel-1-7263/${name}.tar.gz`;
const r2 = (x) => (x == null ? null : +x.toFixed(2));
const bootCI = (rows, stat, salt, iters = 4000) => {
  if (rows.length < 2) return null;
  const xs = []; let c = 0;
  for (let i = 0; i < iters; i++) { const s = Array.from({ length: rows.length }, () => rows[Math.floor(unit(`${salt}:${c++}`) * rows.length)]); xs.push(stat(s)); }
  xs.sort((a, b) => a - b);
  return [r2(xs[Math.floor(0.025 * iters)]), r2(xs[Math.floor(0.975 * iters)])];
};
const rate = (rs, k) => { const w = rs.reduce((a, r) => a + r.words, 0); return w ? (1000 * rs.reduce((a, r) => a + r[k], 0)) / w : 0; };
const kn = (rows, f) => { const k = rows.filter(f).length; return { k, n: rows.length, wilson95: rows.length ? wilson(k, rows.length).map?.((x) => +x.toFixed(3)) ?? wilson(k, rows.length) : null }; };

// Derek 2026-11-04: does disagreement between two reads predict judged sense errors? Stability and accuracy are kept apart:
// disagreement is a word-level edit share between two texts, sense errors are what the judge found against the image.
const toks = (t) => stripMarkupTags(String(t)).toLowerCase().split(/\s+/).filter(Boolean);
const editShare = (a, b) => { const x = toks(a), y = toks(b); return Math.max(x.length, y.length) ? levenshtein(x, y) / Math.max(x.length, y.length) : 0; };
const ranks = (xs) => { const o = xs.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]), r = []; for (let i = 0; i < o.length;) { let j = i; while (j + 1 < o.length && o[j + 1][0] === o[i][0]) j++; for (let k = i; k <= j; k++) r[o[k][1]] = (i + j) / 2 + 1; i = j + 1; } return r; };
const spearman = (rows) => { const x = ranks(rows.map((r) => r.d)), y = ranks(rows.map((r) => r.e)), m = (x.length + 1) / 2; const c = x.reduce((a, v, i) => a + (v - m) * (y[i] - m), 0), sx = Math.sqrt(x.reduce((a, v) => a + (v - m) ** 2, 0)), sy = Math.sqrt(y.reduce((a, v) => a + (v - m) ** 2, 0)); return sx && sy ? c / (sx * sy) : 0; };
const aucMany = (rows) => { const pos = rows.filter((r) => r.e >= MANY_ERRORS_AT).length; return pos && pos < rows.length ? aucLowerIsPositive(rows, (r) => -r.d, (r) => r.e >= MANY_ERRORS_AT) : null; };
const predicts = (rows, salt) => {
  const ds = rows.map((r) => r.d).sort((a, b) => a - b);
  return { pages: rows.length, many_errors_pages: rows.filter((r) => r.e >= MANY_ERRORS_AT).length, median_disagreement: rows.length ? +ds[Math.floor(ds.length / 2)].toFixed(3) : null,
    spearman: rows.length > 2 ? r2(spearman(rows)) : null, spearman_ci95_by_book: bootCI(rows, spearman, `${SEED}:rho:${salt}`, 2000),
    auc_many_errors: aucMany(rows) == null ? null : r2(aucMany(rows)), auc_many_errors_ci95_by_book: aucMany(rows) == null ? null : bootCI(rows, (x) => aucMany(x) ?? 0.5, `${SEED}:auc:${salt}`, 2000) };
};
const results = {}, store = [];
for (const name of Object.keys(CELLS)) {
  const cell = cellOf(name);
  if (!fs.existsSync(path.join(cell.dir, 'selected.json'))) continue;
  const S = selected(cell), logs = jsonl(path.join(cell.dir, 'arms.jsonl')).filter((r) => !r.quota && !r.superseded);
  const Vall = jsonl(path.join(cell.dir, 'verdicts-opus.jsonl')).filter((r) => r.verdict);
  // Amendment 2: guard-refused texts judged as read. Descriptive: outside every k/n, the export and the store.
  const V = Vall.filter((r) => r.set !== 'guard_refused'), GR = Vall.filter((r) => r.set === 'guard_refused');
  const abs = new Map(V.filter((r) => r.set !== 'wrong_page' && r.set !== 'judge_repeat').map((r) => [`${r.key}:${r.text_sha}`, r]));
  const looks = fs.existsSync(path.join(cell.dir, 'looks.json')) ? JSON.parse(fs.readFileSync(path.join(cell.dir, 'looks.json'), 'utf8')) : {};
  const last = new Map(); for (const r of logs.filter((x) => !x.rep)) last.set(`${r.arm}:${r.key}`, r);
  const R = { cell: cell.id, frame: JSON.parse(fs.readFileSync(path.join(cell.dir, 'selected.json'), 'utf8')).frame, looks, arms: {} };
  const key = [], verdictsOut = [], rowsBy = {};
  for (const [arm, A] of Object.entries(cell.arms)) {
    const rows = [];
    for (const s of S) {
      const lg = last.get(`${arm}:${s.key}`), t = readText(cell, s.key, arm);
      if (arm !== 'stored' && !lg) continue;
      if (t == null || !norm(t)) { if (lg) rows.push({ s, failed: true, cat: category(lg.why), why: lg.why, words: s.words, serious: 0, wrong: 0, lg }); continue; }
      const h = sha(norm(t)).slice(0, 16), j = abs.get(`${s.key}:${h}`);
      if (!j) continue;   // not judged (a decided arm's text, or stored past the look)
      const v = j.verdict;
      rows.push({ s, failed: false, cat: lg?.cat ?? 'stored', v, id: j.id, text_sha: h, words: s.words, serious: seriousSpans(v), wrong: (v.defects || []).filter((d) => d.severity === 'wrong_text').length, lg });
    }
    rowsBy[arm] = rows;
    const judged = rows.filter((r) => !r.failed);
    const bands = Object.fromEntries(BANDS.map((b) => [b, judged.filter((r) => bandOf(r.v) === b).length]));
    const dirs = new Set(rows.filter((r) => r.lg).map((r) => path.join(cell.dir, arm, r.s.book_id)));
    const cost = [...dirs].filter((d) => fs.existsSync(d)).map(costOf);
    const tokens = cost.reduce((a, c) => a + c.tokens, 0), pagesRead = cost.reduce((a, c) => a + c.pages_read, 0), calls = cost.reduce((a, c) => a + c.calls, 0);
    const accepted = rows.filter((r) => r.v?.accept).length;
    const pos = {}; for (const r of rows) if (r.lg?.call_position != null) { const k = `${r.lg.call_position}/${r.lg.call_pages}`; (pos[k] ??= { k: 0, n: 0 }).n++; if (r.v?.accept) pos[k].k++; }
    const seeded = {}; for (const r of rows.filter((x) => A.per_call > 1)) { const k = r.s.block_pos; (seeded[k] ??= { k: 0, n: 0, serious: 0, words: 0 }).n++; if (r.v?.accept) seeded[k].k++; seeded[k].serious += r.serious; seeded[k].words += r.failed ? 0 : r.words; }
    const judgedRows = judged.map((r) => ({ words: r.words, serious: r.serious, wrong: r.wrong, misleads: r.serious - r.wrong }));
    R.arms[arm] = {
      route: A.route, accept: kn(rows, (r) => r.v?.accept), wrong_text_pages: kn(rows, (r) => r.wrong > 0), failed: rows.filter((r) => r.failed).length,
      failed_by_kind: rows.filter((r) => r.failed).reduce((a, r) => (a[r.cat] = (a[r.cat] ?? 0) + 1, a), {}), failed_examples: rows.filter((r) => r.failed).slice(0, 8).map((r) => ({ page: r.s.page_id, cat: r.cat, why: r.why })),
      unchanged: rows.filter((r) => r.cat === 'unchanged').length, mean_fidelity: judged.length ? r2(judged.reduce((a, r) => a + Number(r.v.fidelity), 0) / judged.length) : null,
      sense_errors_per_1k: r2(rate(judgedRows, 'serious')), sense_errors_per_1k_ci95: bootCI(judgedRows, (x) => rate(x, 'serious'), `${SEED}:1k:${name}:${arm}`), misleads_per_1k: r2(rate(judgedRows, 'misleads')), wrong_text_per_1k: r2(rate(judgedRows, 'wrong')), serious_spans: judgedRows.reduce((a, r) => a + r.serious, 0), wrong_text_spans: judgedRows.reduce((a, r) => a + r.wrong, 0), words: judgedRows.reduce((a, r) => a + r.words, 0),
      bands, cost: arm === 'stored' ? null : { calls, tokens, pages_read: pagesRead, tokens_per_page_read: pagesRead ? Math.round(tokens / pagesRead) : null, tokens_per_usable_page: accepted && pagesRead ? Math.round(tokens / pagesRead / (accepted / rows.length)) : null, gpu_seconds_per_page: A.draft_source === 'pero' ? GPU_S_PER_PAGE : 0, gpu_seconds_per_usable_page: A.draft_source === 'pero' && accepted && GPU_S_PER_PAGE ? r2(GPU_S_PER_PAGE / (accepted / rows.length)) : 0 },
      call_pages: rows.reduce((a, r) => { if (r.lg) a[r.lg.call_pages ?? '?'] = (a[r.lg.call_pages ?? '?'] ?? 0) + 1; return a; }, {}), position_in_call: pos, seeded_position: seeded,
    };
    for (const r of rows) {
      const judged_as = r.failed ? `f${sha(`${r.s.key}:${arm}`).slice(0, 14)}` : r.id, id = `${judged_as}~${sha(arm).slice(0, 6)}`;
      key.push({ id, judged_as, cell: cell.id, route: A.route, kind: 'item', page_id: r.s.page_id, book_id: r.s.book_id });
      if (r.failed) verdictsOut.push({ id: judged_as, failed_read: r.cat, verdict: { accept: false, fidelity: 1, defects: [], failed_read: r.cat } });
      if (!r.failed) store.push(testRow({ book_id: r.s.book_id, page_id: r.s.page_id, page_number: r.s.page_number, selection: 'random', kind: 'item', verdict: r.v, cell: cell.id, route: A.route, lang: cell.lang, task: cell.task, script_type: 'print', test: { ...TEST, arm, evidence: PRIVATE(name), stratum: null }, judge: { instrument: ROUTE_JUDGE, model: 'opus' }, settings: { pages_per_call: r.lg?.call_pages ?? A.per_call ?? null, draft_source: A.draft_source ?? null, model: arm === 'stored' ? r.s.stored_model : 'gemini-3.8-flash-low', prompt_version: null }, text_hash: r.text_sha }));
    }
  }
  for (const r of V) if (r.set !== 'judge_repeat' && !verdictsOut.some((x) => x.id === r.id)) verdictsOut.push({ id: r.id, set: r.set, verdict: r.verdict });
  // controls
  const wp = V.filter((r) => r.set === 'wrong_page');
  for (const r of wp) { const a = r.labels[0], s = S.find((x) => x.key === r.key); key.push({ id: r.id, judged_as: r.id, cell: cell.id, route: cell.arms[a].route, kind: 'wrong_page', page_id: r.page_id, book_id: s.book_id });
    store.push(testRow({ book_id: s.book_id, page_id: r.page_id, selection: 'random', kind: 'wrong_page', verdict: r.verdict, cell: cell.id, route: cell.arms[a].route, lang: cell.lang, task: cell.task, test: { ...TEST, arm: a, evidence: PRIVATE(name) }, judge: { instrument: ROUTE_JUDGE, model: 'opus' }, rep: r.id })); }
  R.controls = { n: wp.length, passed: wp.filter((r) => !r.verdict.accept && Number(r.verdict.fidelity) <= 2).length, accepted: wp.filter((r) => r.verdict.accept).length, fidelities: wp.map((r) => Number(r.verdict.fidelity)) };
  // noise: route (same arm read twice, each judged) and judge (same text judged twice)
  const Rp = cell.repeat, repLogs = new Map(logs.filter((x) => x.rep && x.arm === Rp).map((r) => [r.key, r]));
  const rr = [];
  for (const s of S) {
    if (!repLogs.has(s.key)) continue;
    const a = readText(cell, s.key, Rp), b = readText(cell, s.key, `${Rp}#rep`);
    const acc = (t) => (t == null || !norm(t) ? false : abs.get(`${s.key}:${sha(norm(t)).slice(0, 16)}`)?.verdict?.accept);
    const x = acc(a), y = acc(b); if (x === undefined || y === undefined) continue;
    rr.push({ x, y, same_text: a != null && b != null && norm(a) === norm(b) });
  }
  R.noise_route = { arm: Rp, pages: rr.length, agree: rr.filter((r) => r.x === r.y).length, first_only: rr.filter((r) => r.x && !r.y).length, second_only: rr.filter((r) => !r.x && r.y).length, identical_text: rr.filter((r) => r.same_text).length };
  const jr = V.filter((r) => r.set === 'judge_repeat').map((r) => { const o = V.find((x) => x.id === r.of); return o ? [o.verdict, r.verdict, r] : null; }).filter(Boolean);
  R.noise_judge = { pages: jr.length, agree: jr.filter(([a, b]) => a.accept === b.accept).length, first_only: jr.filter(([a, b]) => a.accept && !b.accept).length, second_only: jr.filter(([a, b]) => !a.accept && b.accept).length, fidelity_abs_diff: jr.length ? r2(jr.reduce((t, [a, b]) => t + Math.abs(a.fidelity - b.fidelity), 0) / jr.length) : null, serious_spans_first: jr.reduce((t, [a]) => t + seriousSpans(a), 0), serious_spans_second: jr.reduce((t, [, b]) => t + seriousSpans(b), 0) };
  for (const s of S) {   // the repeat arm's second read, and the same text judged again: rep 1 and rep 2, so they join and never pool
    if (!repLogs.has(s.key)) continue;
    const t = readText(cell, s.key, `${Rp}#rep`), j = t == null || !norm(t) ? null : abs.get(`${s.key}:${sha(norm(t)).slice(0, 16)}`);
    if (j) store.push(testRow({ book_id: s.book_id, page_id: s.page_id, page_number: s.page_number, selection: 'random', kind: 'item', verdict: j.verdict, cell: cell.id, route: cell.arms[Rp].route, lang: cell.lang, task: cell.task, script_type: 'print', test: { ...TEST, arm: Rp, evidence: PRIVATE(name), stratum: null }, judge: { instrument: ROUTE_JUDGE, model: 'opus' }, settings: { pages_per_call: repLogs.get(s.key).call_pages ?? cell.arms[Rp].per_call ?? null, model: 'gemini-3.8-flash-low' }, text_hash: j.text_sha, rep: 1 }));
  }
  for (const [, b, r] of jr) { const s = S.find((x) => x.key === r.key); store.push(testRow({ book_id: s.book_id, page_id: s.page_id, page_number: s.page_number, selection: 'random', kind: 'item', verdict: b, cell: cell.id, route: cell.arms[Rp].route, lang: cell.lang, task: cell.task, script_type: 'print', test: { ...TEST, arm: Rp, evidence: PRIVATE(name), stratum: null }, judge: { instrument: ROUTE_JUDGE, model: 'opus' }, settings: { model: 'gemini-3.8-flash-low' }, text_hash: r.text_sha, rep: 2 })); }
  // Does disagreement between two reads predict the judged sense errors? Two reads of one arm, then the stored text and a fresh read.
  const senseOf = (s, t) => { const j = t == null || !norm(t) ? null : abs.get(`${s.key}:${sha(norm(t)).slice(0, 16)}`); return j ? seriousSpans(j.verdict) : null; };
  const pairRows = (armA, armB, judgedOf) => S.flatMap((s) => { const a = readText(cell, s.key, armA), b = readText(cell, s.key, armB); if (a == null || b == null || !norm(a) || !norm(b)) return []; const e = senseOf(s, judgedOf === 'a' ? a : b); return e == null ? [] : [{ d: editShare(a, b), e }]; });
  R.disagreement = { measure: 'word-level edit share between two texts (stability); sense errors = misleads + wrong_text found by the judge against the image (accuracy)', many_errors_at: MANY_ERRORS_AT,
    two_reads_vs_first_read_errors: predicts(pairRows(Rp, `${Rp}#rep`, 'a'), `rep:${name}`),
    two_reads_vs_second_read_errors: predicts(pairRows(Rp, `${Rp}#rep`, 'b'), `rep2:${name}`) };
  for (const arm of Object.keys(cell.arms).filter((a) => a !== 'stored')) {
    R.disagreement[`stored_vs_${arm}__errors_of_${arm}`] = predicts(pairRows(arm, 'stored', 'a'), `st:${name}:${arm}`);
    R.disagreement[`stored_vs_${arm}__errors_of_stored`] = predicts(pairRows(arm, 'stored', 'b'), `st2:${name}:${arm}`);
  }
  // Pairs: the decision is on accept (failed reads count against, in n); per 1,000 words on pages both arms' texts were judged.
  R.pairs = {};
  const armNames = Object.keys(cell.arms), pairList = [...cell.pairs.map(([a, b]) => [a, b]), ...armNames.filter((a) => a !== 'stored' && !cell.pairs.some((p) => p[0] === a && p[1] === 'stored')).map((a) => [a, 'stored'])];
  for (const [a, b] of pairList) {
    const by = new Map(rowsBy[b].map((r) => [r.s.key, r]));
    const both = rowsBy[a].filter((r) => by.has(r.s.key)).map((r) => ({ a: r, b: by.get(r.s.key) }));
    const full = both.filter((x) => !x.a.failed && !x.b.failed);
    const acc = (xs) => (xs.length ? xs.filter((x) => x.a.v?.accept).length / xs.length - xs.filter((x) => x.b.v?.accept).length / xs.length : 0);
    const per = (xs, side) => { const w = xs.reduce((t, x) => t + x[side].words, 0); return w ? (1000 * xs.reduce((t, x) => t + x[side].serious, 0)) / w : 0; };
    const dper = (xs) => per(xs, 'a') - per(xs, 'b');
    const dA = acc(both), dP = dper(full);
    R.pairs[`${a}|${b}`] = { n: both.length, a_accept: both.filter((x) => x.a.v?.accept).length, b_accept: both.filter((x) => x.b.v?.accept).length, a_only: both.filter((x) => x.a.v?.accept && !x.b.v?.accept).length, b_only: both.filter((x) => !x.a.v?.accept && x.b.v?.accept).length, d_accept: r2(dA), d_accept_ci95_by_book: bootCI(both, acc, `${SEED}:dA:${name}:${a}:${b}`),
      n_both_judged: full.length, a_per_1k: r2(per(full, 'a')), b_per_1k: r2(per(full, 'b')), d_per_1k: r2(dP), d_per_1k_ci95_by_book: bootCI(full, dper, `${SEED}:dP:${name}:${a}:${b}`),
      point_different_ways: (dA > 0 && dP > 0) || (dA < 0 && dP < 0) };
  }
  for (const [a, , r] of jr) { const b = S.find((x) => x.key === r.key); key.push({ id: r.of + '~r0', judged_as: r.of, cell: cell.id, route: cell.arms[Rp].route, kind: 'repeat', page_id: r.page_id, book_id: b.book_id }, { id: r.id + '~r1', judged_as: r.id, cell: cell.id, route: cell.arms[Rp].route, kind: 'repeat', page_id: r.page_id, book_id: b.book_id }); verdictsOut.push({ id: r.id, set: r.set, verdict: r.verdict }); }
  // second reader
  const sec = jsonl(path.join(cell.dir, 'second-opus.jsonl')).filter((r) => r.verdict);
  const pts = sec.flatMap((r) => r.points.map((p, i) => ({ first: p.severity_first, ...(r.verdict.points?.find((x) => Number(x.n) === i + 1) ?? {}) })));
  const tally = (f) => ({ spans: pts.filter(f).length, different_yes: pts.filter((p) => f(p) && p.different === 'yes').length, different_no: pts.filter((p) => f(p) && p.different === 'no').length, cannot_tell: pts.filter((p) => f(p) && p.different === 'cannot_tell').length, changes_sense_yes: pts.filter((p) => f(p) && p.changes_sense === 'yes').length });
  R.second_reader = { all: tally(() => true), wrong_text: tally((p) => p.first === 'wrong_text'), misleads: tally((p) => p.first === 'misleads') };
  R.guard_refused_judged = Object.fromEntries(Object.keys(cell.arms).map((a) => [a, GR.filter((r) => r.labels[0] === a)]).filter(([, g]) => g.length).map(([a, g]) => [a, { n: g.length, accepted: g.filter((r) => r.verdict.accept).length, wrong_text_pages: g.filter((r) => (r.verdict.defects || []).some((d) => d.severity === 'wrong_text')).length, serious_spans: g.reduce((n, r) => n + seriousSpans(r.verdict), 0) }]));
  // Opus calls, cost
  R.opus_calls = { verdicts: jsonl(path.join(cell.dir, 'verdicts-opus.jsonl')).filter((r) => r.verdict || r.usage).length, second: jsonl(path.join(cell.dir, 'second-opus.jsonl')).filter((r) => r.verdict || r.usage).length };
  results[name] = R;
  writeJ(path.join(cell.dir, 'key.json'), key);
  fs.writeFileSync(path.join(cell.dir, 'verdicts-opus-export.jsonl'), verdictsOut.map((x) => JSON.stringify(x)).join('\n') + '\n');
}
writeJ(path.join(OUT, 'results.json'), results);
// The committed copy carries no page or book id (Derek 2026-11-04): aggregates with n and intervals only.
const aggregate = JSON.parse(JSON.stringify(results, (k, v) => (k === 'failed_examples' ? (v || []).map(({ cat, why }) => ({ cat, why })) : k === 'fidelities' ? undefined : v)));
writeJ(path.join(OUT, 'results-aggregate.json'), aggregate);
if (/[0-9a-f]{24}/.test(JSON.stringify(aggregate))) { console.error('results-aggregate.json holds a page or book id: fix before committing'); process.exitCode = 1; }
for (const [n, R] of Object.entries(results)) {
  console.log(`\n== ${R.cell}: frame ${R.frame.census_pages} pages, ${R.frame.census_books} books; controls ${R.controls.passed}/${R.controls.n} passed; route noise ${R.noise_route.agree}/${R.noise_route.pages}; judge noise ${R.noise_judge.agree}/${R.noise_judge.pages}; Opus ${R.opus_calls.verdicts}+${R.opus_calls.second}`);
  for (const [a, x] of Object.entries(R.arms)) console.log(`${a.padEnd(7)} accept ${x.accept.k}/${x.accept.n}  wrong-text pages ${x.wrong_text_pages.k}  failed ${x.failed} ${JSON.stringify(x.failed_by_kind)}  sense/1k ${x.sense_errors_per_1k} ${JSON.stringify(x.sense_errors_per_1k_ci95)}  fid ${x.mean_fidelity}  tokens/page ${x.cost?.tokens_per_page_read ?? '-'}`);
  for (const [p, l] of Object.entries(R.looks)) console.log(`  ${p}: ${l.state ?? 'open'} ${JSON.stringify(l.hist.at(-1) ?? {})}`);
}
if (flag('store')) {
  const { MongoClient } = await import('mongodb');
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  const col = c.db('bookstore').collection(COLLECTION);
  const r = await col.bulkWrite(store.map((d) => ({ updateOne: { filter: { _id: d._id }, update: { $setOnInsert: d }, upsert: true } })));
  console.log(`stored ${r.upsertedCount} new test rows of ${store.length} in ${COLLECTION}`);
  await c.close();
}
