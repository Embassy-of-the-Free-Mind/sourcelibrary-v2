#!/usr/bin/env node
// PRIOR ART: scripts/eval/tibetan-mt-ab/score.mjs (per-page absolute scores → ranking, 22 pages); scripts/eval/lib/paired-stats.mjs
// (bootstrapCI). This aggregates single-candidate verdicts over the corpus draw: control catch rates first, then
// per-language / per-arm / per-period cells, a post-stratified corpus estimate, and inter-judge agreement.
//
//   node scripts/eval/translation-corpus-audit/score.mjs --dir scripts/eval/results/translation-corpus-audit-2026-09-30 --primary opus [--second sonnet]
// Reads <dir>/manifest.jsonl, <dir>/draw-log.json, <dir>/verdicts/<judge>/*.jsonl. Writes <dir>/report.json, <dir>/report.md.
// --gate: exit 3 when the blinded controls fail (monthly.sh reports nothing but the controls then). Thresholds
// below were set from the 2026-09-30 run (15/15, 15/15, 15/15 within one) with one miss of slack each.

import fs from 'node:fs';
import path from 'node:path';
import { bootstrapCI, resetSeed, seededRand } from '../lib/paired-stats.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true] : []).filter(Boolean));
const DIR = args.dir, PRIMARY = args.primary || 'opus', SECOND = args.second || null;
const FLAGS = ['omission', 'invention', 'inversion', 'untranslated', 'wrong_language', 'wrong_page', 'garble_passthrough', 'truncated', 'repetition'];

const readJsonl = (f) => fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter((l) => l.trim()).map((l) => { try { return JSON.parse(l); } catch { return { _bad: l.slice(0, 80) }; } }) : [];
const manifest = readJsonl(path.join(DIR, 'manifest.jsonl'));
const byId = Object.fromEntries(manifest.map((m) => [m.id, m]));
const drawLog = JSON.parse(fs.readFileSync(path.join(DIR, 'draw-log.json'), 'utf8'));

function loadVerdicts(judge) {
  const d = path.join(DIR, 'verdicts', judge);
  if (!fs.existsSync(d)) return {};
  const out = {}; let bad = 0, dup = 0;
  for (const f of fs.readdirSync(d).filter((x) => x.endsWith('.jsonl'))) {
    for (const v of readJsonl(path.join(d, f))) {
      if (v._bad || !v.id || !byId[v.id] || typeof v.fidelity !== 'number') { bad++; continue; }
      if (out[v.id]) dup++;
      v.flags = Object.fromEntries(FLAGS.map((k) => [k, !!(v.flags && v.flags[k])]));
      v.defects = Array.isArray(v.defects) ? v.defects : [];
      out[v.id] = v;
    }
  }
  console.error(`${judge}: ${Object.keys(out).length} verdicts (${bad} unparseable/unknown, ${dup} duplicates)`);
  return out;
}
const V = loadVerdicts(PRIMARY);
const V2 = SECOND ? loadVerdicts(SECOND) : null;

const pct = (k, n) => n ? +(100 * k / n).toFixed(1) : null;
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
const mean = (a) => a.length ? +(a.reduce((s, x) => s + x, 0) / a.length).toFixed(2) : null;

function cell(items, V) {
  const vs = items.map((m) => V[m.id]).filter(Boolean);
  const f = vs.map((v) => v.fidelity);
  const c = { n: vs.length, n_drawn: items.length, fidelity_mean: mean(f), fidelity_median: median(f), dist: [1, 2, 3, 4, 5].map((k) => f.filter((x) => x === k).length),
    pct_ge4: pct(f.filter((x) => x >= 4).length, f.length), pct_le2: pct(f.filter((x) => x <= 2).length, f.length), pct_5: pct(f.filter((x) => x === 5).length, f.length),
    flags: Object.fromEntries(FLAGS.map((k) => [k, pct(vs.filter((v) => v.flags[k]).length, vs.length)])),
    any_major: pct(vs.filter((v) => v.defects.some((d) => d.severity === 'major')).length, vs.length),
    confidence_mean: mean(vs.map((v) => v.confidence).filter((x) => typeof x === 'number')) };
  return c;
}
const groupBy = (arr, f) => { const o = {}; for (const x of arr) (o[f(x)] ||= []).push(x); return o; };

// ── Controls first ───────────────────────────────────────────────────────────
const main = manifest.filter((m) => m.kind === 'main');
const controls = (kind) => manifest.filter((m) => m.kind === kind && V[m.id]);
const swap = controls('swap'), drop = controls('drop'), repeat = controls('repeat');
const ctrl = {
  swap: { n: swap.length, caught_fidelity_le2: swap.filter((m) => V[m.id].fidelity <= 2).length, flagged_wrong_page: swap.filter((m) => V[m.id].flags.wrong_page).length,
    missed: swap.filter((m) => V[m.id].fidelity >= 3).map((m) => ({ id: m.id, language: m.language, fidelity: V[m.id].fidelity, reason: V[m.id].reason })) },
  drop: { n: drop.length, flagged_omission: drop.filter((m) => V[m.id].flags.omission).length, fidelity_le3: drop.filter((m) => V[m.id].fidelity <= 3).length,
    missed: drop.filter((m) => !V[m.id].flags.omission).map((m) => ({ id: m.id, language: m.language, dropped_chars: m.dropped_chars, fidelity: V[m.id].fidelity, reason: V[m.id].reason })),
    original_fidelity: drop.map((m) => ({ id: m.id, language: m.language, drop_fidelity: V[m.id].fidelity })) },
  repeat: (() => {
    const pairs = repeat.filter((m) => V[m.repeat_of]).map((m) => ({ id: m.id, language: m.language, a: V[m.repeat_of].fidelity, b: V[m.id].fidelity, flags_same: FLAGS.every((k) => V[m.repeat_of].flags[k] === V[m.id].flags[k]) }));
    return { n: pairs.length, exact: pairs.filter((p) => p.a === p.b).length, within1: pairs.filter((p) => Math.abs(p.a - p.b) <= 1).length, flags_identical: pairs.filter((p) => p.flags_same).length, pairs };
  })(),
  // main items whose source is shared with a swap/drop control (same book page) — judged twice, informative for stability
};
// swap items: the *unswapped* extra is never judged; report drop controls vs their own text is not available. Fine.

// A run whose controls fail is not reported (#5301). Rates, not counts, so a run with a short control set
// is judged on what it has — and a control set under 10 of a kind fails outright: too few to certify.
const GATE = { swap_caught: 14 / 15, drop_flagged: 13 / 15, repeat_within1: 14 / 15, min_n: 10 };
const gateChecks = {
  swap: { n: ctrl.swap.n, rate: ctrl.swap.n ? ctrl.swap.caught_fidelity_le2 / ctrl.swap.n : 0, need: GATE.swap_caught },
  drop: { n: ctrl.drop.n, rate: ctrl.drop.n ? ctrl.drop.flagged_omission / ctrl.drop.n : 0, need: GATE.drop_flagged },
  repeat: { n: ctrl.repeat.n, rate: ctrl.repeat.n ? ctrl.repeat.within1 / ctrl.repeat.n : 0, need: GATE.repeat_within1 },
};
for (const c of Object.values(gateChecks)) c.pass = c.n >= GATE.min_n && c.rate >= c.need - 1e-9;
const controlsGate = { pass: Object.values(gateChecks).every((c) => c.pass), checks: gateChecks };

// ── Cells ────────────────────────────────────────────────────────────────────
const judged = main.filter((m) => V[m.id]);
const byLang = groupBy(judged, (m) => m.language);
const report = {
  dir: DIR, primary_judge: PRIMARY, second_judge: SECOND, seed: drawLog.seed, drawn_at: drawLog.at,
  n_main_drawn: main.length, n_main_judged: judged.length, n_books: new Set(judged.map((m) => m.book_id)).size,
  controls: ctrl,
  controls_gate: controlsGate,
  overall_unweighted: cell(judged, V),
  by_language: Object.fromEntries(Object.entries(byLang).sort((a, b) => b[1].length - a[1].length).map(([k, v]) => [k, cell(v, V)])),
  by_arm: Object.fromEntries(Object.entries(groupBy(judged, (m) => m.arm)).map(([k, v]) => [k, cell(v, V)])),
  by_language_arm: Object.fromEntries(Object.entries(byLang).map(([k, v]) => [k, Object.fromEntries(Object.entries(groupBy(v, (m) => m.arm)).map(([a, w]) => [a, cell(w, V)]))])),
  by_period: Object.fromEntries(Object.entries(groupBy(judged, (m) => m.period)).map(([k, v]) => [k, cell(v, V)])),
  by_prompt: Object.fromEntries(Object.entries(groupBy(judged, (m) => `${m.arm}/${m.prompt_version || '?'}`)).map(([k, v]) => [k, cell(v, V)])),
  by_script_class: Object.fromEntries(Object.entries(groupBy(judged, (m) => ['Latin', 'English', 'German', 'French', 'Italian', 'Dutch', 'Spanish'].includes(m.language) ? 'latin-script' : 'non-latin-script')).map(([k, v]) => [k, cell(v, V)])),
  modernization: cell(judged.filter((m) => m.modernization), V),
  stale_translation: cell(judged.filter((m) => m.translation_older_than_ocr), V),
};

// ── Post-stratified corpus estimate (weights = live translated pages per language) ─
const W = drawLog.weights;
const totalPages = Object.values(W).reduce((s, w) => s + w.translated_pages, 0);
function weighted(pred) {
  let est = 0;
  for (const [lang, items] of Object.entries(byLang)) {
    const share = W[lang].translated_pages / totalPages;
    est += share * items.filter((m) => pred(V[m.id])).length / items.length;
  }
  return +(100 * est).toFixed(1);
}
// bootstrap over books within language (pages-as-books), 2000 iters, seeded
resetSeed(20260930);
function weightedCI(pred, iters = 2000) {
  const langs = Object.entries(byLang);
  const draws = [];
  for (let i = 0; i < iters; i++) {
    let est = 0;
    for (const [lang, items] of langs) {
      const share = W[lang].translated_pages / totalPages;
      let k = 0; for (let j = 0; j < items.length; j++) k += pred(V[items[Math.floor(seededRand() * items.length)].id]) ? 1 : 0;
      est += share * k / items.length;
    }
    draws.push(100 * est);
  }
  draws.sort((a, b) => a - b);
  return [+(draws[Math.floor(iters * 0.025)]).toFixed(1), +(draws[Math.floor(iters * 0.975)]).toFixed(1)];
}
report.corpus_estimate = {
  note: 'post-stratified by language (weights = live translated pages per language at draw time); languages outside the 15 sampled are not represented; CI = 95% bootstrap over pages-as-books within language',
  weights: Object.fromEntries(Object.entries(W).map(([k, w]) => [k, +(100 * w.translated_pages / totalPages).toFixed(1)])),
  pct_fidelity_ge4: { est: weighted((v) => v.fidelity >= 4), ci: weightedCI((v) => v.fidelity >= 4) },
  pct_fidelity_5: { est: weighted((v) => v.fidelity === 5), ci: weightedCI((v) => v.fidelity === 5) },
  pct_fidelity_le2: { est: weighted((v) => v.fidelity <= 2), ci: weightedCI((v) => v.fidelity <= 2) },
  flags: Object.fromEntries(FLAGS.map((k) => [k, { est: weighted((v) => v.flags[k]), ci: weightedCI((v) => v.flags[k]) }])),
  any_major_defect: { est: weighted((v) => v.defects.some((d) => d.severity === 'major')), ci: weightedCI((v) => v.defects.some((d) => d.severity === 'major')) },
};

// ── Sensitivity: the draw quota-sampled the model ARM within each language (≈50/50), so the plain
// language-weighted estimate over-represents each language's minority arm; and one page per BOOK is
// book-weighted, not page-weighted. Two corrected estimates, when the weight files exist:
//   arm-shares.json   → post-stratify by language × arm (true arm share of live translated pages)
//   book-weights.json → weight each sampled book by its pages_translated within its language (random PAGE)
const armShares = fs.existsSync(path.join(DIR, 'arm-shares.json')) ? JSON.parse(fs.readFileSync(path.join(DIR, 'arm-shares.json'), 'utf8')) : null;
const bookW = fs.existsSync(path.join(DIR, 'book-weights.json')) ? JSON.parse(fs.readFileSync(path.join(DIR, 'book-weights.json'), 'utf8')) : null;
function weightedBy(pred, mode) {
  let est = 0;
  for (const [lang, items] of Object.entries(byLang)) {
    const share = W[lang].translated_pages / totalPages;
    if (mode === 'arm' && armShares && armShares[lang]) {
      let langRate = 0, covered = 0;
      for (const arm of ['lite', 'flash']) {
        const cell = items.filter((m) => m.arm === arm);
        if (!cell.length) continue;
        langRate += armShares[lang][arm] * cell.filter((m) => pred(V[m.id])).length / cell.length; covered += armShares[lang][arm];
      }
      est += share * (covered ? langRate / covered : items.filter((m) => pred(V[m.id])).length / items.length);
    } else if (mode === 'page' && bookW) {
      const ws = items.map((m) => Math.max(1, bookW[m.book_id]?.pages_translated || 1));
      const tot = ws.reduce((s, x) => s + x, 0);
      est += share * items.reduce((s, m, i) => s + (pred(V[m.id]) ? ws[i] : 0), 0) / tot;
    } else est += share * items.filter((m) => pred(V[m.id])).length / items.length;
  }
  return +(100 * est).toFixed(1);
}
report.sensitivity = {
  note: 'corrected estimates; see comment in score.mjs. "language" = the headline weighting; "language_x_arm" re-weights the quota-sampled arm to its true share; "page_weighted" weights each book by its translated pages (random page rather than random book)',
  ...Object.fromEntries([['pct_fidelity_ge4', (v) => v.fidelity >= 4], ['pct_fidelity_5', (v) => v.fidelity === 5], ['pct_fidelity_le2', (v) => v.fidelity <= 2], ['any_major_defect', (v) => v.defects.some((d) => d.severity === 'major')], ['omission', (v) => v.flags.omission], ['invention', (v) => v.flags.invention], ['garble_passthrough', (v) => v.flags.garble_passthrough]]
    .map(([k, p]) => [k, { language: weightedBy(p, 'language'), language_x_arm: armShares ? weightedBy(p, 'arm') : null, page_weighted: bookW ? weightedBy(p, 'page') : null }])),
  by_language_arm_weighted: armShares ? Object.fromEntries(Object.entries(byLang).map(([lang, items]) => {
    const f = (pred) => { let r = 0, c = 0; for (const arm of ['lite', 'flash']) { const cell = items.filter((m) => m.arm === arm); if (!cell.length || !armShares[lang]) continue; r += armShares[lang][arm] * cell.filter((m) => pred(V[m.id])).length / cell.length; c += armShares[lang][arm]; } return c ? +(100 * r / c).toFixed(1) : null; };
    return [lang, { pct_ge4: f((v) => v.fidelity >= 4), pct_le2: f((v) => v.fidelity <= 2), any_major: f((v) => v.defects.some((d) => d.severity === 'major')) }];
  })) : null,
};

// ── Defect types ─────────────────────────────────────────────────────────────
const defects = judged.flatMap((m) => V[m.id].defects.map((d) => ({ ...d, id: m.id, language: m.language, arm: m.arm })));
report.defect_types = Object.fromEntries(Object.entries(groupBy(defects, (d) => `${d.type}/${d.severity}`)).map(([k, v]) => [k, v.length]).sort((a, b) => b[1] - a[1]));
report.worst = judged.map((m) => ({ id: m.id, language: m.language, arm: m.arm, fidelity: V[m.id].fidelity, url: m.url, flags: FLAGS.filter((k) => V[m.id].flags[k]), reason: V[m.id].reason })).sort((a, b) => a.fidelity - b.fidelity).slice(0, 25);

// ── Inter-judge agreement ────────────────────────────────────────────────────
if (V2) {
  const both = judged.filter((m) => V2[m.id]);
  const d = both.map((m) => V[m.id].fidelity - V2[m.id].fidelity);
  report.agreement = {
    n: both.length, exact: pct(d.filter((x) => x === 0).length, d.length), within1: pct(d.filter((x) => Math.abs(x) <= 1).length, d.length),
    primary_minus_second_mean: mean(d),
    flag_agreement: Object.fromEntries(FLAGS.map((k) => { const a = both.filter((m) => V[m.id].flags[k] === V2[m.id].flags[k]).length; const pos1 = both.filter((m) => V[m.id].flags[k]).length, pos2 = both.filter((m) => V2[m.id].flags[k]).length; return [k, { agree_pct: pct(a, both.length), primary_pos: pos1, second_pos: pos2 }]; })),
    second_cells: { overall: cell(both, V2), by_language: Object.fromEntries(Object.entries(groupBy(both, (m) => m.language)).map(([k, v]) => [k, cell(v, V2)])), by_arm: Object.fromEntries(Object.entries(groupBy(both, (m) => m.arm)).map(([k, v]) => [k, cell(v, V2)])) },
    second_controls: { swap_caught: manifest.filter((m) => m.kind === 'swap' && V2[m.id]).map((m) => V2[m.id].fidelity <= 2), drop_flagged: manifest.filter((m) => m.kind === 'drop' && V2[m.id]).map((m) => V2[m.id].flags.omission) },
    disagreements_ge2: both.filter((m) => Math.abs(V[m.id].fidelity - V2[m.id].fidelity) >= 2).map((m) => ({ id: m.id, language: m.language, url: m.url, primary: V[m.id].fidelity, second: V2[m.id].fidelity, primary_reason: V[m.id].reason, second_reason: V2[m.id].reason })),
  };
}

fs.writeFileSync(path.join(DIR, 'report.json'), JSON.stringify(report, null, 2));

// ── Store rows (eval-design.md §5.2). One row per (item, judge). `measure: judged` — a single-candidate,
// source-grounded judge rating; NOT `accuracy` (no independent reference) and NOT `preference` (not pairwise).
// The §2 enum has no value for this yet; the PR that lands this run proposes `judged` as the fifth value.
if (args.store) {
  const runId = `translation-corpus-audit-${DIR.split('/').pop().replace(/^translation-corpus-audit-/, '')}`;
  const month = (drawLog.at || '').slice(0, 7) || '2026-09';
  const rows = [];
  for (const [judge, VV] of [[PRIMARY, V], [SECOND, V2]]) {
    if (!judge || !VV) continue;
    const scorer = `translation-corpus-audit-judge@1`;
    for (const m of manifest) {
      const v = VV[m.id]; if (!v) continue;
      rows.push({ slug: `tca-${m.language.toLowerCase()}-${m.book_id.slice(-6)}-p${m.page_number}`, item_id: m.id, kind: m.kind, book_id: m.book_id, page_number: m.page_number,
        language: m.language, period: m.period, engine: m.model, arm: m.arm, prompt_version: m.prompt_version, prompt_hash: m.prompt_hash,
        measure: 'judged', against: { judge: `claude-${judge}`, judge_packet_id: `${runId}/${judge}`, source_hash: m.ocr_hash, translation_hash: m.translation_hash },
        metric: { fidelity: v.fidelity, ...v.flags, n_defects_major: v.defects.filter((d) => d.severity === 'major').length, n_defects_minor: v.defects.filter((d) => d.severity === 'minor').length },
        control_expected: m.expected || null, repeat_of: m.repeat_of || null,
        scorer, scorer_version: 1, rubric: 'scripts/eval/translation-corpus-audit/JUDGE-PROMPT.md', run_id: runId, abstain: false, at: drawLog.at, provenance_captured: false, cost_usd: 0, issue: Number(args.issue || 5274) });
    }
  }
  const sdir = path.join('scripts/eval/store/scores', 'translation-corpus-audit-judge@1');
  fs.mkdirSync(sdir, { recursive: true });
  // A month file can hold more than one run (the 2026-09-30 one-off and the first monthly run share September):
  // replace this run's rows, keep every other run's.
  const sfile = path.join(sdir, `${month}.jsonl`);
  const kept = readJsonl(sfile).filter((r) => !r._bad && r.run_id !== runId);
  fs.writeFileSync(sfile, [...kept, ...rows].map((r) => JSON.stringify(r)).join('\n') + '\n');
  console.error(`store: ${rows.length} score rows → ${sfile} (${kept.length} rows of other runs kept)`);
}

// ── Markdown ─────────────────────────────────────────────────────────────────
const row = (name, c) => `| ${name} | ${c.n} | ${c.fidelity_mean ?? '—'} | ${c.fidelity_median ?? '—'} | ${c.dist.join(' / ')} | ${c.pct_5 ?? '—'} | ${c.pct_ge4 ?? '—'} | ${c.pct_le2 ?? '—'} | ${c.flags.omission ?? '—'} | ${c.flags.invention ?? '—'} | ${c.flags.untranslated ?? '—'} | ${c.any_major ?? '—'} |`;
const hdr = '| cell | n books | mean | median | 1/2/3/4/5 | %5 | %≥4 | %≤2 | %omission | %invention | %untransl. | %any major |\n|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|';
let md = `# Translation corpus audit — ${DIR.split('/').pop()}\n\nJudge: ${PRIMARY} (source-grounded, reference-free, single candidate; measure = judge rating, NOT accuracy). ${report.n_main_judged} pages from ${report.n_books} books, one interior page per book, seed ${report.seed}.\n\n`;
md += `**Controls gate: ${controlsGate.pass ? 'PASS' : 'FAIL — this run is not reported'}** (swap ≥ ${Math.round(GATE.swap_caught * 100)}% rated ≤2, drop ≥ ${Math.round(GATE.drop_flagged * 100)}% flagged omission, repeat ≥ ${Math.round(GATE.repeat_within1 * 100)}% within one; ≥ ${GATE.min_n} of each).\n\n`;
md += `## Controls (read first)\n- swap (translation of another page): ${ctrl.swap.caught_fidelity_le2}/${ctrl.swap.n} rated ≤2, ${ctrl.swap.flagged_wrong_page}/${ctrl.swap.n} flagged wrong_page\n- drop (middle ~35% removed): ${ctrl.drop.flagged_omission}/${ctrl.drop.n} flagged omission, ${ctrl.drop.fidelity_le3}/${ctrl.drop.n} rated ≤3\n- repeat (same item twice): ${ctrl.repeat.exact}/${ctrl.repeat.n} exact, ${ctrl.repeat.within1}/${ctrl.repeat.n} within 1, ${ctrl.repeat.flags_identical}/${ctrl.repeat.n} identical flags\n\n`;
md += `## Corpus estimate (post-stratified by language; 95% CI)\n| statistic | est % | CI |\n|---|---:|---|\n| fidelity 5 | ${report.corpus_estimate.pct_fidelity_5.est} | ${report.corpus_estimate.pct_fidelity_5.ci.join('–')} |\n| fidelity ≥ 4 | ${report.corpus_estimate.pct_fidelity_ge4.est} | ${report.corpus_estimate.pct_fidelity_ge4.ci.join('–')} |\n| fidelity ≤ 2 | ${report.corpus_estimate.pct_fidelity_le2.est} | ${report.corpus_estimate.pct_fidelity_le2.ci.join('–')} |\n| any major defect | ${report.corpus_estimate.any_major_defect.est} | ${report.corpus_estimate.any_major_defect.ci.join('–')} |\n` + FLAGS.map((k) => `| ${k} | ${report.corpus_estimate.flags[k].est} | ${report.corpus_estimate.flags[k].ci.join('–')} |`).join('\n') + '\n\n';
md += `## By language\n${hdr}\n` + Object.entries(report.by_language).map(([k, c]) => row(k, c)).join('\n') + '\n\n';
md += `## By translation model arm (unpaired: different pages per arm, model follows the book)\n${hdr}\n` + Object.entries(report.by_arm).map(([k, c]) => row(k, c)).join('\n') + '\n\n';
md += `## By language × arm\n${hdr}\n` + Object.entries(report.by_language_arm).flatMap(([l, o]) => Object.entries(o).map(([a, c]) => row(`${l} / ${a}`, c))).join('\n') + '\n\n';
md += `## By period\n${hdr}\n` + Object.entries(report.by_period).map(([k, c]) => row(k, c)).join('\n') + '\n\n';
md += `## By arm / prompt label\n${hdr}\n` + Object.entries(report.by_prompt).map(([k, c]) => row(k, c)).join('\n') + '\n\n';
md += `## Script class\n${hdr}\n` + Object.entries(report.by_script_class).map(([k, c]) => row(k, c)).join('\n') + '\n\n';
md += `## Defect types (primary judge, main items)\n| type/severity | n |\n|---|---:|\n` + Object.entries(report.defect_types).map(([k, v]) => `| ${k} | ${v} |`).join('\n') + '\n\n';
if (report.agreement) md += `## Inter-judge agreement (${PRIMARY} vs ${SECOND}, n=${report.agreement.n})\nexact ${report.agreement.exact}%, within 1: ${report.agreement.within1}%, mean(primary−second) ${report.agreement.primary_minus_second_mean}. Second judge controls: swap caught ${report.agreement.second_controls.swap_caught.filter(Boolean).length}/${report.agreement.second_controls.swap_caught.length}, drop flagged ${report.agreement.second_controls.drop_flagged.filter(Boolean).length}/${report.agreement.second_controls.drop_flagged.length}.\n\n| flag | agree % | primary + | second + |\n|---|---:|---:|---:|\n` + FLAGS.map((k) => `| ${k} | ${report.agreement.flag_agreement[k].agree_pct} | ${report.agreement.flag_agreement[k].primary_pos} | ${report.agreement.flag_agreement[k].second_pos} |`).join('\n') + '\n\n';
md += `## Worst 25 (primary judge)\n| fidelity | language | arm | flags | url | reason |\n|---:|---|---|---|---|---|\n` + report.worst.map((w) => `| ${w.fidelity} | ${w.language} | ${w.arm} | ${w.flags.join(', ')} | ${w.url} | ${String(w.reason || '').replace(/\|/g, '/').slice(0, 200)} |`).join('\n') + '\n';
fs.writeFileSync(path.join(DIR, 'report.md'), md);
console.error(`report → ${DIR}/report.{json,md}; controls gate ${controlsGate.pass ? 'PASS' : 'FAIL'}`);
if (args.gate && !controlsGate.pass) process.exit(3);
