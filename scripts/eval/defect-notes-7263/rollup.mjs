// PRIOR ART: scripts/eval/defect-notes-7263/census.mjs (this job) writes the rows this reads.
// scripts/eval/confidence-7866/expand-analyze.mjs reports sense errors per 1,000 words per language x script cell, not by
// defect class; scripts/eval/route-judge-6740/defect-rate.mjs is the router's per-route accept / wrong_text rate. Neither
// crosses class x severity, nor checks one book's share of a class.
/**
 * #7263 defect-notes rollup. Reads $JOB_SCRATCH/rows.jsonl.gz (census.mjs), writes $JOB_SCRATCH/rollup.json and prints
 * the tables. Frames:
 *   served  = stored text as served, drawn at random within strata: lane confidence-7866 (stratified by confidence,
 *             5 pages a book) and test:judged-expand-7263 (language x script cells, 1 page a book).
 *   arms    = every other route-judge row: router-test arms (random pages within a cell's frame, several arms a page,
 *             most arms never served) and live-lane samples. Evidence about routes, not a rate of the library.
 * Step-T rows (correct-vs-reread-7568) are left out: that instrument records no severity and no note.
 * serious = misleads + wrong_text (the two swap between runs on one page); cosmetic kept apart.
 */
import fs from 'node:fs';
import zlib from 'node:zlib';
import { clusterCI, mean, r3 } from '../lib/pareto-stats.mjs';
const S = process.env.JOB_SCRATCH;
const rows = zlib.gunzipSync(fs.readFileSync(`${S}/rows.jsonl.gz`)).toString().split('\n').map(JSON.parse)
  .filter((r) => !String(r.instrument || '').startsWith('step-t'));
const SERVED = new Set(['confidence-7866', 'test:judged-expand-7263']);
const LANG = { de: 'German', el: 'Greek', sa: 'Sanskrit', ar: 'Arabic', zh: 'Chinese', la: 'Latin', fr: 'French', 'Classical Chinese': 'Chinese' };
const langOf = (r) => LANG[r.lang] ?? r.lang ?? 'unknown';
const scriptOf = (r) => ({ printed: 'print', print: 'print', handwritten: 'manuscript', manuscript: 'manuscript' })[r.script_type] ?? (/\/print|\|print/.test(`${r.cell}|${r.stratum}`) ? 'print' : /manuscript/.test(`${r.cell}|${r.stratum}`) ? 'manuscript' : 'unknown');
const task = (r) => (r.task === 'translation' ? 'translation' : 'ocr');
const serious = (d) => d.severity === 'misleads' || d.severity === 'wrong_text';
const fam = (c) => (/^T/.test(c) ? 'T' : /^I/.test(c) ? 'I' : /^O/.test(c) ? 'O' : c);

function group(rs, label) {
  const books = new Set(rs.map((r) => r.book_id));
  const per = (pred) => rs.map((r) => ({ book: r.book_id, v: r.defects.filter(pred).length }));
  const rate = (pred, seed) => { const it = per(pred); return { per_page: r3(mean(it.map((x) => x.v))), ci95: clusterCI(it, (x) => x.book, (xs) => mean(xs.map((x) => x.v)), seed) }; };
  const share = (pred, seed) => { const it = rs.map((r) => ({ book: r.book_id, v: r.defects.some(pred) ? 1 : 0 })); return { share: r3(mean(it.map((x) => x.v))), ci95: clusterCI(it, (x) => x.book, (xs) => mean(xs.map((x) => x.v)), seed) }; };
  const classes = {};
  for (const r of rs) for (const d of r.defects) { const c = (classes[d.class] ??= { serious: 0, wrong_text: 0, misleads: 0, cosmetic: 0, pagesSerious: new Set(), byBook: {} }); c[d.severity] = (c[d.severity] ?? 0) + 1; if (serious(d)) { c.serious++; c.pagesSerious.add(r.id); c.byBook[r.book_id] = (c.byBook[r.book_id] ?? 0) + 1; } }
  const cls = Object.entries(classes).map(([k, c]) => { const top = Math.max(0, ...Object.values(c.byBook)); return { class: k, serious: c.serious, wrong_text: c.wrong_text, misleads: c.misleads, cosmetic: c.cosmetic, serious_per_page: r3(c.serious / rs.length), pages_with_serious: c.pagesSerious.size, books_with_serious: Object.keys(c.byBook).length, top_book_share: c.serious ? r3(top / c.serious) : null }; }).sort((a, b) => b.serious - a.serious);
  return { label, pages: rs.length, books: books.size, accept: r3(mean(rs.filter((r) => r.accept != null).map((r) => (r.accept ? 1 : 0)))),
    serious: rate(serious, 7263), wrong_text: rate((d) => d.severity === 'wrong_text', 7264), cosmetic: rate((d) => d.severity === 'cosmetic', 7265),
    pages_any_serious: share(serious, 7266), classes: cls };
}
const by = (rs, f) => { const m = {}; for (const r of rs) (m[f(r)] ??= []).push(r); return m; };
const served = rows.filter((r) => SERVED.has(r.lane));
const arms = rows.filter((r) => !SERVED.has(r.lane));
const out = { served: {}, arms: {} };
out.served.all = group(served, 'served, all');
for (const [t, rs] of Object.entries(by(served, task))) out.served[`task:${t}`] = group(rs, t);
for (const [k, rs] of Object.entries(by(served, (r) => scriptOf(r)))) out.served[`script:${k}`] = group(rs, k);
for (const [k, rs] of Object.entries(by(served, (r) => `${langOf(r)}|${scriptOf(r)}`))) if (new Set(rs.map((r) => r.book_id)).size >= 8) out.served[`lang:${k}`] = group(rs, k);
for (const [k, rs] of Object.entries(by(served, (r) => r.route))) if (new Set(rs.map((r) => r.book_id)).size >= 8) out.served[`route:${k}`] = group(rs, k);
for (const [k, rs] of Object.entries(by(arms, task))) out.arms[`task:${k}`] = group(rs, k);
for (const [k, rs] of Object.entries(by(arms, (r) => `${task(r)}|${r.route}`))) if (rs.length >= 30) out.arms[`route:${k}`] = group(rs, k);
fs.writeFileSync(`${S}/rollup.json`, JSON.stringify(out, null, 1));
const line = (g) => `${g.label.padEnd(34)} pages ${String(g.pages).padStart(5)} books ${String(g.books).padStart(4)} accept ${g.accept} serious/pg ${g.serious.per_page} [${g.serious.ci95}] wt/pg ${g.wrong_text.per_page} cosm/pg ${g.cosmetic.per_page} any-serious ${g.pages_any_serious.share} [${g.pages_any_serious.ci95}]`;
for (const sec of ['served', 'arms']) { console.log(`\n##### ${sec}`); for (const g of Object.values(out[sec])) { console.log(line(g)); } }
console.log('\n##### served, all: classes by serious notes');
for (const c of out.served.all.classes.slice(0, 20)) console.log(`${c.class.padEnd(4)} serious ${String(c.serious).padStart(5)} (wt ${c.wrong_text}, mis ${c.misleads}) cosm ${c.cosmetic} /pg ${c.serious_per_page} pages ${c.pages_with_serious} books ${c.books_with_serious} topbook ${c.top_book_share}`);
for (const k of ['task:translation']) if (out.served[k]) { console.log(`\n##### served ${k} classes`); for (const c of out.served[k].classes.slice(0, 10)) console.log(`${c.class} ${c.serious} /pg ${c.serious_per_page} books ${c.books_with_serious}`); }
console.log('\n##### arms translation: classes'); for (const c of (out.arms['task:translation']?.classes || []).slice(0, 12)) console.log(`${c.class.padEnd(4)} serious ${c.serious} (wt ${c.wrong_text}) /pg ${c.serious_per_page} pages ${c.pages_with_serious} books ${c.books_with_serious} topbook ${c.top_book_share}`);
console.log('\n##### arms ocr: classes'); for (const c of out.arms['task:ocr'].classes.slice(0, 15)) console.log(`${c.class.padEnd(4)} serious ${c.serious} (wt ${c.wrong_text}) /pg ${c.serious_per_page} pages ${c.pages_with_serious} books ${c.books_with_serious} topbook ${c.top_book_share}`);
