#!/usr/bin/env node
// PRIOR ART: none (first #6740 severity aggregate). sevagg.mjs <sev dir> [--out sev.json]: grades.json per page + key.json → counts per arm and cell.
import fs from 'node:fs';
import path from 'node:path';
const dir = process.argv[2]; const outI = process.argv.indexOf('--out');
const pages = JSON.parse(fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), 'pages.json'), 'utf8')).pages;
const key = JSON.parse(fs.readFileSync(path.join(dir, 'key.json'), 'utf8'));
const W = [0, 1, 3, 3, 10];   // #6740 example weights, illustration only
const res = { per_page: {}, cells: {} };
for (const p of pages) {
  const f = path.join(dir, p.slug, 'grades.json'); if (!fs.existsSync(f)) continue;
  const g = JSON.parse(fs.readFileSync(f, 'utf8')); res.per_page[p.slug] = {};
  for (const [L, v] of Object.entries(g)) res.per_page[p.slug][key[p.slug][L]] = { ...v, kind: p.observed.kind };
}
for (const cell of ['all', 'print', 'manuscript']) {
  const c = {}; for (const [slug, arms] of Object.entries(res.per_page)) for (const [a, v] of Object.entries(arms)) {
    if (cell !== 'all' && v.kind !== cell) continue;
    c[a] ??= { n: 0, DNR: 0, g: [0, 0, 0, 0, 0], ge2: 0, loss: 0 }; const s = c[a]; s.n++;
    if (v.grade === 'DNR') { s.DNR++; continue; } const gi = Number(v.grade); s.g[gi]++; if (gi >= 2) s.ge2++; s.loss += W[gi];
  }
  for (const s of Object.values(c)) { const graded = s.n - s.DNR; s.share_ge2_of_all = +(((s.ge2 + s.DNR) / s.n)).toFixed(3); s.mean_loss_graded = graded ? +(s.loss / graded).toFixed(2) : null; }
  res.cells[cell] = c;
}
if (outI > 0) fs.writeFileSync(process.argv[outI + 1], JSON.stringify(res, null, 1));
for (const [cell, c] of Object.entries(res.cells)) { console.log(`\n${cell}\narm\tn\tDNR\tg0\tg1\tg2\tg3\tg4\t≥2 or DNR\tmean loss`); for (const [a, s] of Object.entries(c).sort()) console.log([a, s.n, s.DNR, ...s.g, s.share_ge2_of_all, s.mean_loss_graded].join('\t')); }
