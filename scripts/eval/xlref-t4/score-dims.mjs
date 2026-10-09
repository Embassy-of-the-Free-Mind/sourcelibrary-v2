#!/usr/bin/env node
// PRIOR ART: scripts/eval/translation-vs-reference/score.mjs scores the blinded fidelity packet; nothing scores the addendum-B dimension pass (looked: scripts/eval/translation-vs-reference/, scripts/eval/lib/report.mjs). Reads build-dims-packet.mjs output; fidelity is COPIED from results.json, never re-scored.
/** Score the #5695 addendum-B dimension pass: a six-score profile per language for our served English and for the published reference, stance labels, and meaning disagreements. */
//   node scripts/eval/xlref-t4/score-dims.mjs --packet <dims dir> --results <results.json> --records <records.jsonl> --out <dims.json> [--arm served]
import fs from 'node:fs';
import path from 'node:path';
import { bootstrapCI } from '../lib/paired-stats.mjs';
import { readJsonl, itemId, clipDeep } from '../translation-vs-reference/common.mjs';
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const P = opt('packet'); const ARM = opt('arm', 'served');
const key = JSON.parse(fs.readFileSync(path.join(P, 'key.json'), 'utf8'));
const res = JSON.parse(fs.readFileSync(opt('results'), 'utf8'));
const recs = Object.fromEntries(readJsonl(opt('records')).map((r) => [itemId(r), r]));
const fid = Object.fromEntries(res.per_page.map((p) => [p.id, p.arms[ARM]?.fidelity ?? null]));
const DIMS = ['readability', 'register', 'terminology', 'ambiguity', 'transparency'];
const rows = [];
for (const f of fs.readdirSync(path.join(P, 'verdicts')).filter((x) => x.endsWith('.jsonl')).sort()) for (const v of readJsonl(path.join(P, 'verdicts', f))) {
  const k = key[v.id]; const r = recs[v.id]; if (!k || !r) continue;
  const oursL = k.A === ARM ? 'A' : 'B', refL = oursL === 'A' ? 'B' : 'A';
  const dis = (v.disagreements || []).map((d) => ({ source: d.source ?? d.latin, ours: d[oursL.toLowerCase()], reference: d[refL.toLowerCase()], right: d.right === oursL ? 'ours' : d.right === refL ? 'reference' : d.right, why: d.why }));
  const row = { id: v.id, book_id: r.book_id, page_number: r.page_number, lang: r.lang, genre: r.genre, reference_style: r.reference_meta.style, reference_private: r.reference_meta.private,
    ours: { fidelity: fid[v.id], ...v[oursL] }, reference: { fidelity: null, ...v[refL] }, disagreements: dis, legit_choice: !!v.legit_choice, legit_note: v.legit_note || '', reason: v.reason || '' };
  rows.push(r.reference_meta.private ? clipDeep(row, r.reference_text) : row);
}
const mean = (xs) => { const v = xs.filter((x) => x != null); if (!v.length) return null; const ci = bootstrapCI(v); return { mean: Math.round(1000 * v.reduce((a, b) => a + b, 0) / v.length) / 1000, ci: ci ? ci.map((x) => Math.round(1000 * x) / 1000) : null, n: v.length }; };
const profile = (set) => ({ pages: set.length,
  ours: Object.fromEntries(['fidelity', ...DIMS].map((d) => [d, mean(set.map((r) => r.ours[d]))])),
  reference: Object.fromEntries(DIMS.map((d) => [d, mean(set.map((r) => r.reference[d]))])),
  stance_ours: count(set.map((r) => r.ours.stance)), stance_reference: count(set.map((r) => r.reference.stance)) });
function count(xs) { const o = {}; for (const x of xs) o[x] = (o[x] || 0) + 1; return o; }
const groups = { all: rows }; for (const r of rows) (groups[`lang:${r.lang}`] ||= []).push(r);
const allDis = rows.flatMap((r) => r.disagreements.map((d) => ({ id: r.id, ...d })));
const out = { generated: new Date().toISOString(), arm: ARM, note: 'fidelity for our English is copied from results.json (the blind fidelity pass); the reference has no fidelity score — it is the guide the fidelity pass was judged against', n_pages: rows.length,
  profiles: Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, profile(v)])),
  disagreements: { n: allDis.length, by_right: count(allDis.map((d) => d.right)), pages_with_ours_right_reference_wrong: new Set(allDis.filter((d) => d.right === 'ours').map((d) => d.id)).size, pages_with_reference_right_ours_wrong: new Set(allDis.filter((d) => d.right === 'reference').map((d) => d.id)).size },
  legit_choice_pages: rows.filter((r) => r.legit_choice).map((r) => ({ id: r.id, lang: r.lang, note: r.legit_note, stance_ours: r.ours.stance, stance_reference: r.reference.stance })), per_page: rows };
fs.writeFileSync(opt('out'), JSON.stringify(out, null, 1));
console.log(JSON.stringify({ n: rows.length, profiles: Object.fromEntries(Object.entries(out.profiles).map(([k, p]) => [k, { n: p.pages, ours: Object.fromEntries(Object.entries(p.ours).map(([d, m]) => [d, m?.mean])), ref: Object.fromEntries(Object.entries(p.reference).map(([d, m]) => [d, m?.mean])), so: p.stance_ours, sr: p.stance_reference }])), dis: out.disagreements, legit: out.legit_choice_pages.length }, null, 1));
