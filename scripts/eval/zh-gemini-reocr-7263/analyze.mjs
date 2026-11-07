#!/usr/bin/env node
// PRIOR ART: scripts/eval/router-confirm/confirm.mjs analyzeArms (v4Verdict, per1k, judgeItems imported; its results are per 1,000
// WORDS, and its word count reads a run of Han as one word, so it cannot state a Chinese rate) and
// scripts/eval/korean-cell-7982/score.mjs (the router-evidence export this copies the shape of).
/**
 * Score #7263's Chinese re-read cell test, per stratum: accept k/n, wrong text, severe per 1,000 characters, paired P−S, O−S.
 *   node scripts/eval/zh-gemini-reocr-7263/analyze.mjs --scratch=DIR --results=DIR --evidence=DIR [--tag=cheap-arms]
 * --tag writes score-<tag>.json and zh-reocr-<tag>-7263.score.json beside #8008's files, and adds each correct arm
 * against O (paired, #8008's verdicts) and against the #retest verdicts of O judged in the same sitting.
 */
import fs from 'node:fs';
import path from 'node:path';
import { judgeItems, judgeArmIds, v4Verdict, per1k, DEFAULT_SEED } from '../router-confirm/confirm.mjs';
import { wrongText } from '../correction-pass-7818/lib.mjs';

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const SCR = path.resolve(arg('scratch')), RES = path.resolve(arg('results')), EVID = path.resolve(arg('evidence'));
const jsonl = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const SEVERE = new Set(['misleads', 'wrong_text']);
const TAG = arg('tag');
const out = { at: new Date().toISOString(), issue: 7263, strata: {} };
const evid = {}, byScript = {};

for (const st of ['print', 'siku']) {
  const OUT = path.join(SCR, st), P = JSON.parse(fs.readFileSync(path.join(OUT, 'plan.json'), 'utf8'));
  const T = (k, a) => { const f = path.join(OUT, 'texts', `${k}.${a}.txt`); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null; };
  const { items, controls } = judgeItems(P.selected, T, DEFAULT_SEED, judgeArmIds(P));
  const last = new Map(jsonl(path.join(OUT, 'verdicts.jsonl')).filter((r) => r.verdict).map((r) => [r.id, r]));
  const vOf = (key, armName) => { const re = armName.endsWith('#retest'), arm = armName.replace('#retest', ''), it = items.find((x) => x.key === key && x.arms.includes(arm)), r = it && last.get(re ? `${it.id}#retest` : it.id); if (!r) return null;
    const d = r.verdict.defects || [];
    return { accept: !!r.verdict.accept, wrong: wrongText(r.verdict), fidelity: r.verdict.fidelity, severe: d.filter((x) => SEVERE.has(x.severity)).length, misleads: d.filter((x) => x.severity === 'misleads').length, wrong_defects: d.filter((x) => x.severity === 'wrong_text').length, classes: [...new Set(d.filter((x) => SEVERE.has(x.severity)).map((x) => x.class))], defects: d }; };
  const ctl = controls.map((c) => last.get(c.id)).filter(Boolean).map((r) => ({ accept: !!r.verdict.accept, fidelity: r.verdict.fidelity }));
  const arms = jsonl(path.join(OUT, 'arms.jsonl')), lastArm = new Map(arms.map((r) => [`${r.key}:${r.arm}`, r]));
  const cmp = 'served', res = { frame: P.frame, n: P.selected.length, by_stored_model: {}, controls: ctl, arms: {}, between: {}, per_page: [] };
  const rows = (arm, sel = P.selected) => sel.map((s) => ({ s, v: vOf(s.key, arm) })).filter((x) => x.v);
  const summary = (arm, sel = P.selected) => { const r = rows(arm, sel), k = r.filter((x) => x.v.accept).length, classes = {};
    for (const x of r) for (const c of x.v.classes) classes[c] = (classes[c] ?? 0) + 1;
    return { accepted: `${k}/${r.length}`, wrong_text_pages: r.filter((x) => x.v.wrong).length, fidelity_mean: r.length ? +(r.reduce((t, x) => t + x.v.fidelity, 0) / r.length).toFixed(2) : null, classes,
      per_1k_chars: per1k(r.map((x) => ({ words: x.s.han, severe: x.v.severe, wrong: x.v.wrong_defects }))) }; };
  const pair = (a, b) => { const v = v4Verdict(P.selected.map((s) => { const x = vOf(s.key, a), y = vOf(s.key, b); return x && y ? { win: x, cur: y } : null; }), ctl, P.rule);
    const pairsR = P.selected.map((s) => [vOf(s.key, a), vOf(s.key, b), s]).filter(([x, y]) => x && y);
    return { verdict: v.verdict, why: v.why, n: v.n, d: +v.d.toFixed(3), d_ci95: v.ci95.map((x) => +x.toFixed(3)), gained: v.gained, lost: v.lost, sign_test_p: +v.sign_test_p.toFixed(4), wrong: `${v.winner.wrong_text} vs ${v.current.wrong_text}`,
      made_wrong: pairsR.filter(([x, y]) => x.wrong && !y.wrong).length, cleared_wrong: pairsR.filter(([x, y]) => !x.wrong && y.wrong).length,
      severe_delta_per_1k: +(1000 * (pairsR.reduce((t, [x, y]) => t + x.severe - y.severe, 0) / pairsR.reduce((t, [, , s]) => t + s.han, 0))).toFixed(2) }; };
  for (const a of P.arms) {
    const outcomes = {}; for (const s of P.selected) { const r = lastArm.get(`${s.key}:${a.arm}`), w = r ? r.why : a.arm === 'Pu' ? 'noguard' : 'not run'; outcomes[w] = (outcomes[w] ?? 0) + 1; }
    res.arms[a.arm] = { route: a.route, ...summary(a.arm), served_outcomes: outcomes, ...(a.arm === cmp ? {} : { vs_stored: pair(a.arm, cmp) }) };
  }
  res.between.O_vs_P = pair('O', 'P');
  if (TAG) {
    for (const a of P.arms.filter((x) => !['served', 'P', 'Pu', 'O'].includes(x.arm))) { res.between[`${a.arm}_vs_O`] = pair(a.arm, 'O'); res.between[`${a.arm}_vs_O_retest`] = pair(a.arm, 'O#retest'); }
    const rt = P.selected.map((s) => [vOf(s.key, 'O'), vOf(s.key, 'O#retest')]).filter(([x, y]) => x && y);
    res.retest_O = { n: rt.length, accepted_first: rt.filter(([x]) => x.accept).length, accepted_retest: rt.filter(([, y]) => y.accept).length, accept_agree: rt.filter(([x, y]) => x.accept === y.accept).length, wrong_first: rt.filter(([x]) => x.wrong).length, wrong_retest: rt.filter(([, y]) => y.wrong).length };
    res.retest_controls = controls.map((c) => last.get(`${c.id}#retest`)).filter(Boolean).map((r) => ({ accept: !!r.verdict.accept, fidelity: r.verdict.fidelity }));
  }
  if (st === 'print') res.between.O_vs_Pu = pair('O', 'Pu');
  for (const m of [...new Set(P.selected.map((s) => (/flash-lite/.test(s.stored_model) ? 'lite' : '3flash')))]) {
    const sel = P.selected.filter((s) => (/flash-lite/.test(s.stored_model) ? 'lite' : '3flash') === m);
    res.by_stored_model[m] = { n: sel.length, ...Object.fromEntries(P.arms.map((a) => [a.arm, (({ accepted, wrong_text_pages, per_1k_chars }) => ({ accepted, wrong_text_pages, severe_per_1k: per_1k_chars.severe_per_1k }))(summary(a.arm, sel))])) };
  }
  res.per_page = P.selected.map((s) => ({ book_id: s.book_id, page_id: s.page_id, page_number: s.page_number, title: s.title, stored_model: s.stored_model, han: s.han, ...Object.fromEntries(P.arms.map((a) => { const v = vOf(s.key, a.arm), r = lastArm.get(`${s.key}:${a.arm}`); return [a.arm, v ? { accept: v.accept, wrong: v.wrong, fidelity: v.fidelity, severe: v.severe, classes: v.classes, why: r?.why ?? null } : null]; })) }));
  res.study_cells = Object.fromEntries(P.arms.map((a) => { const r = rows(a.arm), W = r.reduce((t, x) => t + x.s.han, 0), per = (k) => +((1000 * r.reduce((t, x) => t + x.v[k], 0)) / W).toFixed(2);
    return [`${P.cell} ${a.route}`, { route: a.route, pages: r.length, words: W, fidelity_mean: +(r.reduce((t, x) => t + x.v.fidelity, 0) / r.length).toFixed(2), misleads_per_1k: per('misleads'), wrong_text_per_1k: per('wrong_defects'), severe_per_1k: per('severe'), unit: 'defects in the judge verdict per 1,000 Han and kana characters of the stored page' }]; }));
  res.contain_candidates = P.selected.flatMap((s) => { const v = vOf(s.key, 'served'), r = lastArm.get(`${s.key}:O`); const inv = (v?.defects || []).filter((d) => d.severity === 'wrong_text' && /^(O1|O2|O3|I1)$/.test(d.class));
    return r?.why === 'contain' || inv.length ? [{ book_id: s.book_id, page_id: s.page_id, page_number: s.page_number, title: s.title, opus: r?.why === 'contain' ? r.reason : null, judge: inv.map((d) => `${d.class}: ${String(d.what || d.note || '').slice(0, 120)}`) }] : []; });
  out.strata[st] = res;
  const cellId = `chinese-gemini-${st}-7263`;
  const routeBlock = (a) => { const r = rows(a), classes = {}; for (const x of r) for (const c of x.v.classes) classes[c] = (classes[c] ?? 0) + 1;
    return { n: r.length, books: r.length, accept: `${r.filter((x) => x.v.accept).length}/${r.length}`, wrong_text_pages: `${r.filter((x) => x.v.wrong).length}/${r.length}`, classes_k_of_n: Object.fromEntries(Object.entries(classes).map(([c, n]) => [c, `${n}/${r.length}`])) }; };
  const block = { task: 'ocr', lang: 'Chinese', pages: P.selected.length, frame: P.frame.unit, controls: { wrong_page: ctl.map((c) => ({ ...c, passed: !c.accept })) }, routes: Object.fromEntries(P.arms.map((a) => [a.route, { ...routeBlock(a.arm), served: a.route }])) };
  evid[cellId] = block;
  byScript[`${cellId}/${st === 'print' ? 'print' : 'manuscript'}`] = block;
}
const head = { generated_by: 'scripts/eval/zh-gemini-reocr-7263/analyze.mjs', provenance: `#7263 Chinese re-read cell${TAG ? ` (${TAG}: cheaper correctors on the same pages)` : ''}: 30 + 30 books, one page each, seed 20261103, books PPS on frame pages; arms on the same pages; Opus judge blind to arm against the image, 2 wrong-page controls a stratum`, judge: 'claude-opus-5-5 (claude -p), route-judge-6740 judgePrompt against the page image', mapping: 'wrong_text = a wrong_text defect; accept = the judge accepts' };
out.cells = Object.fromEntries(Object.entries(out.strata).map(([st, r]) => [st, r.study_cells]));   // the shape experiments-lint reads
fs.mkdirSync(RES, { recursive: true });
const evidName = TAG ? `zh-reocr-${TAG}-7263.score.json` : 'zh-gemini-reocr-7263.score.json';
fs.writeFileSync(path.join(RES, TAG ? `score-${TAG}.json` : 'score.json'), JSON.stringify(out, null, 1) + '\n');
fs.writeFileSync(path.join(EVID, evidName), JSON.stringify({ ...head, cells: evid }, null, 1) + '\n');
fs.writeFileSync(path.join(EVID, 'by-script', evidName), JSON.stringify({ ...head, cells: byScript }, null, 1) + '\n');
// the file confirm.mjs writes for a run (router-confirm/results/<cell>-<date>.json): one per stratum, verdicts page by page
for (const [st, r] of Object.entries(out.strata)) fs.writeFileSync(path.join(RES, '../../router-confirm/results', `chinese-gemini-${st}${TAG ? `-${TAG}` : ''}-${out.at.slice(0, 10)}.json`), JSON.stringify({ at: out.at, cell: `chinese-gemini/${st}`, issue: 7263, rule: { within: 0.08, wrong_text_max: 0.04, source: 'rules.json switch' }, comparator: 'served', ...r }, null, 1) + '\n');
const show = (x) => JSON.stringify(x);
for (const [st, r] of Object.entries(out.strata)) {
  console.log(`\n== ${st} n=${r.n} controls ${show(r.controls)} `);
  for (const [a, v] of Object.entries(r.arms)) console.log(a, v.route, v.accepted, 'wrong', v.wrong_text_pages, 'sev/1k', v.per_1k_chars.severe_per_1k, show(v.per_1k_chars.severe_per_1k_ci95), 'wr/1k', v.per_1k_chars.wrong_text_per_1k, 'chars', v.per_1k_chars.words, show(v.served_outcomes), '\n   ', show(v.classes), v.vs_stored ? '\n   ' + show(v.vs_stored) : '');
  console.log('between', show(r.between)); console.log('by model', show(r.by_stored_model)); console.log('contain', show(r.contain_candidates));
}
