#!/usr/bin/env node
// #6740 read-surface, Amendment 6: the admin page's data (src/data/ocr-read-surface-6740-a6.json) from analysis6.json,
// the German confirmation score and the backlog projection. Cells and verdicts only: no page text, no per-book rows.
// PRIOR ART: fit.mjs --data (this directory: the same job for the first run's surface.json; kept as it ran).
//   node scripts/eval/read-surface-6740/export-a6.mjs --analysis=FILE --confirm=confirm-de/score.json --backlog=FILE --out=src/data/ocr-read-surface-6740-a6.json
import fs from 'node:fs';
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const A = JSON.parse(fs.readFileSync(arg('analysis'), 'utf8'));
const C = arg('confirm') && fs.existsSync(arg('confirm')) ? JSON.parse(fs.readFileSync(arg('confirm'), 'utf8')) : null;
const B = arg('backlog') && fs.existsSync(arg('backlog')) ? JSON.parse(fs.readFileSync(arg('backlog'), 'utf8')) : null;
const lean = (S) => S && { books: S.books, cells: S.cells, optimum: S.optimum, verdict: S.verdict, frontier: S.frontier, base_live: S.base_live };
const out = {
  built_at: A.built_at ?? new Date().toISOString(), versions: A.versions, boot: A.boot, margin_pp: A.margin_pp, min_saving: A.min_saving, cost_unit: A.cost_unit,
  langs: Object.fromEntries(Object.entries(A.langs).map(([l, R]) => [l, {
    rows: R.rows, books: R.books, ib_books: R.ib_books, weighted: lean(R.weighted), unweighted: lean(R.unweighted), lack_of_fit: R.lack_of_fit_ib, a_vs_a: R.a_vs_a,
    by_century: R.by_century,
    effects: Object.fromEntries(['cer_logit', 'log_cost'].map((m) => [m, R.models[m]?.coef ? Object.fromEntries(['x1', 'x3', 'x1sq', 'x3sq', 'x1x3'].map((k) => [k, { b: R.models[m].coef[k], se: R.models[m].se[k] }])) : null])),
  }])),
  robust: A.robust,
  confirmation_de: C && (() => { const st = C.strata.all; return { n_drawn: st.n_drawn, passes: C.decision.passes, planted: `${st.planted.caught}/${st.planted.n}`,
    routes: Object.fromEntries(Object.entries(st.routes).map(([r, x]) => [r, { written: x.written.accept, wrong_text: x.written.wrong_text, p_acc_ge_080: x.written.p_acc_ge_080, eligible: x.eligible, calls: x.agy_calls_per_page, usd_1k_pages: x.quota_usd_per_1k_pages, usd_1k_accepted: x.quota_usd_per_1k_accepted, not_written: x.not_written }])),
    paired: Object.values(st.paired)[0] }; })(),
  backlog: B && { week_of_quota_at_least_usd: B.week_of_quota_at_least_usd, queue_measured: B.queue_measured, rows: B.rows, note: B.note },
};
fs.writeFileSync(arg('out'), JSON.stringify(out, (k, v) => (typeof v === 'number' && !Number.isInteger(v) ? Number(v.toPrecision(4)) : v)));
console.log(`${arg('out')}: ${Object.keys(out.langs).join(', ')}`);
