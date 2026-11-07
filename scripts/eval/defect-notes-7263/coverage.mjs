// PRIOR ART: scripts/eval/defect-notes-7263/rollup.mjs (this job) gives served rates per cell and arm rates per route,
// but not side by side; scripts/eval/estimator/router-table/ decides per router cell from acceptance, not from where
// the served serious notes sit. This joins the two: for each served language x script cell, its share of all served
// serious notes, and which OCR routes the arms already measured in that LANGUAGE, any script (many arm rows carry no
// script; their own frames, not paired).
/**
 * #7263 step 5. Reads $JOB_SCRATCH/rows.jsonl.gz (census.mjs), writes $JOB_SCRATCH/coverage.json and prints a table.
 * Arm rates are each test's own pages: a lower rate than the served cell is a pointer, not a paired result.
 */
import fs from 'node:fs';
import zlib from 'node:zlib';
const S = process.env.JOB_SCRATCH;
const rows = zlib.gunzipSync(fs.readFileSync(`${S}/rows.jsonl.gz`)).toString().split('\n').map(JSON.parse)
  .filter((r) => !String(r.instrument || '').startsWith('step-t'));
const SERVED = new Set(['confidence-7866', 'test:judged-expand-7263']);
const LANG = { de: 'German', el: 'Greek', sa: 'Sanskrit', ar: 'Arabic', zh: 'Chinese', la: 'Latin', fr: 'French', 'Classical Chinese': 'Chinese' };
const langOf = (r) => LANG[r.lang] ?? r.lang ?? 'unknown';
const scriptOf = (r) => ({ printed: 'print', print: 'print', handwritten: 'manuscript', manuscript: 'manuscript' })[r.script_type]
  ?? (/\/print|\|print|-print/.test(`${r.cell}|${r.stratum}`) ? 'print' : /manuscript|-ms|\/ms/.test(`${r.cell}|${r.stratum}`) ? 'manuscript' : 'unknown');
const serious = (r) => r.defects.filter((d) => d.severity === 'misleads' || d.severity === 'wrong_text').length;
const cellOf = (r) => `${langOf(r)}|${scriptOf(r)}`;
const served = rows.filter((r) => SERVED.has(r.lane));
const arms = rows.filter((r) => !SERVED.has(r.lane) && r.task !== 'translation');
const total = served.reduce((a, r) => a + serious(r), 0);
const cells = {};
for (const r of served) {
  const c = (cells[cellOf(r)] ??= { pages: 0, books: new Set(), serious: 0, routes: {} });
  c.pages++; c.books.add(r.book_id); c.serious += serious(r); c.routes[r.route] = (c.routes[r.route] || 0) + 1;
}
const armCells = {};
for (const r of arms) {
  const a = ((armCells[langOf(r)] ??= {})[r.route] ??= { pages: 0, books: new Set(), serious: 0 });
  a.pages++; a.books.add(r.book_id); a.serious += serious(r);
}
const out = Object.entries(cells).filter(([, c]) => c.books.size >= 8).map(([k, c]) => ({
  cell: k, pages: c.pages, books: c.books.size, serious_per_page: +(c.serious / c.pages).toFixed(2),
  share_of_served_serious: +(c.serious / total).toFixed(3),
  served_routes: Object.entries(c.routes).sort((a, b) => b[1] - a[1]).map(([r, n]) => `${r}:${n}`).join(' '),
  arms: Object.entries(armCells[k.split('|')[0]] || {}).filter(([, a]) => a.pages >= 10)
    .map(([r, a]) => ({ route: r, pages: a.pages, books: a.books.size, serious_per_page: +(a.serious / a.pages).toFixed(2) }))
    .sort((a, b) => a.serious_per_page - b.serious_per_page),
})).sort((a, b) => b.share_of_served_serious - a.share_of_served_serious);
fs.writeFileSync(`${S}/coverage.json`, JSON.stringify({ total_served_serious: total, cells: out }, null, 1));
console.log(`served serious notes: ${total}`);
let cum = 0;
for (const c of out) {
  cum += c.share_of_served_serious;
  const best = c.arms[0];
  console.log(`${c.cell.padEnd(32)} ${String(c.pages).padStart(4)}pp ${String(c.books).padStart(4)}bk ser/pg ${String(c.serious_per_page).padStart(5)} share ${c.share_of_served_serious.toFixed(3)} cum ${cum.toFixed(2)} | served ${c.served_routes.slice(0, 60)} | arms ${c.arms.map((a) => `${a.route}(${a.pages}) ${a.serious_per_page}`).join('; ').slice(0, 200) || '-'}${best ? '' : ''}`);
}
