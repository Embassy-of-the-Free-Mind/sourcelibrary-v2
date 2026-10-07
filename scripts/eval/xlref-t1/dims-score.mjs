#!/usr/bin/env node
// PRIOR ART: scripts/eval/translation-vs-reference/score.mjs scores the fidelity pass (blind, two judges, controls). The #5695 addendum-B dimensions pass is one judge, unblinded as to kind, two translations per page — a different verdict shape; this unkeys it, copies fidelity for the served side from the fidelity results, and bootstraps the profile with lib/paired-stats.
/** Unkey and aggregate the #5695 addendum-B dimensions pass: six-dimension profile for served vs reference, stance, who-is-right at disagreements, legit-choice pages. */
//   node scripts/eval/xlref-t1/dims-score.mjs <dims-dir> <results-pass1.json> <out.json>
import fs from 'node:fs';
import path from 'node:path';
import { bootstrapCI, mean } from '../lib/paired-stats.mjs';
const [DIR, P1, OUT] = process.argv.slice(2);
const key = JSON.parse(fs.readFileSync(path.join(DIR, 'key.json')));
const p1 = JSON.parse(fs.readFileSync(P1));
const fid = Object.fromEntries(p1.per_page.map((p) => [`${p.book_id}_${p.page_number}`, { fidelity: p.arms.served?.fidelity, style: p.style, canonical: p.canonical }]));
const rows = [];
for (const f of fs.readdirSync(path.join(DIR, 'verdicts/j3')).sort()) for (const l of fs.readFileSync(path.join(DIR, 'verdicts/j3', f), 'utf8').trim().split('\n')) {
  const v = JSON.parse(l); const k = key[v.id]; if (!k) continue;
  const side = (who) => v[k.A === who ? 'A' : 'B'];
  const who = (x) => (x === 'A' ? k.A : x === 'B' ? k.B : x);
  rows.push({ id: v.id, served: { fidelity: fid[v.id]?.fidelity ?? null, ...side('served') }, reference: side('reference'), style: fid[v.id]?.style, canonical: fid[v.id]?.canonical,
    disagreements: (v.disagreements || []).map((d) => ({ latin: d.latin, served: k.A === 'served' ? d.a : d.b, reference: k.A === 'served' ? d.b : d.a, right: who(d.right), why: d.why })), legit_choice: !!v.legit_choice, legit_note: v.legit_note || '', reason: v.reason });
}
const DIMS = ['readability', 'register', 'terminology', 'ambiguity', 'transparency'];
const prof = (sel, who) => Object.fromEntries(DIMS.map((d) => { const xs = sel.map((r) => r[who][d]).filter((x) => typeof x === 'number'); const [lo, hi] = bootstrapCI(xs); return [d, { mean: +mean(xs).toFixed(2), ci: [+lo.toFixed(2), +hi.toFixed(2)], n: xs.length }]; }));
const stance = (sel, who) => sel.reduce((a, r) => { a[r[who].stance] = (a[r[who].stance] || 0) + 1; return a; }, {});
const fx = rows.map((r) => r.served.fidelity).filter((x) => x != null); const [flo, fhi] = bootstrapCI(fx);
const dis = rows.flatMap((r) => r.disagreements.map((d) => ({ id: r.id, ...d })));
const right = dis.reduce((a, d) => { a[d.right] = (a[d.right] || 0) + 1; return a; }, {});
const pagesOursRight = new Set(dis.filter((d) => d.right === 'served').map((d) => d.id)).size;
const pagesRefRight = new Set(dis.filter((d) => d.right === 'reference').map((d) => d.id)).size;
const out = { n: rows.length, note: 'one Opus judge, not blind to kind; fidelity for served copied from the fidelity pass (two blind judges); the reference has no fidelity score by construction',
  profile: { served: { fidelity: { mean: +mean(fx).toFixed(2), ci: [+flo.toFixed(2), +fhi.toFixed(2)], n: fx.length }, ...prof(rows, 'served') }, reference: prof(rows, 'reference') },
  by_style: Object.fromEntries([...new Set(rows.map((r) => r.style))].map((s) => { const sel = rows.filter((r) => r.style === s); return [s, { n: sel.length, served: prof(sel, 'served'), reference: prof(sel, 'reference') }]; })),
  stance: { served: stance(rows, 'served'), reference: stance(rows, 'reference') },
  disagreements: { n: dis.length, right, pages_with_served_right_reference_wrong: pagesOursRight, pages_with_reference_right_served_wrong: pagesRefRight },
  legit_choice_pages: rows.filter((r) => r.legit_choice).map((r) => ({ id: r.id, note: r.legit_note, stance_served: r.served.stance, stance_reference: r.reference.stance })), rows };
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log(JSON.stringify({ n: out.n, profile: out.profile, stance: out.stance, disagreements: out.disagreements, legit: out.legit_choice_pages.length }, null, 0));
