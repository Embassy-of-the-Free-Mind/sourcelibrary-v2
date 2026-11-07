// PRIOR ART: none (reader-vs-reader agreement for #7243 references). node rr.mjs: median R1–R2 CER (view N) per page; needs $JOB_SCRATCH/refwork/R1|R2.
import fs from 'node:fs';
import { nview, views, cer, median } from './score.mjs';
const J = process.env.JOB_SCRATCH; const pages = JSON.parse(fs.readFileSync(J + '/pages.json')).pages;
const rows = [];
for (const p of pages) {
  const a = fs.readFileSync(`${J}/refwork/R1/${p.slug}.txt`, 'utf8'), b = fs.readFileSync(`${J}/refwork/R2/${p.slug}.txt`, 'utf8');
  const v = views(a, b); const c = cer(v.R.N, v.H.Nr);
  rows.push({ slug: p.slug, kind: p.observed.kind, c, n1: v.R.N.length, n2: v.H.N.length });
}
rows.sort((x, y) => y.c - x.c);
for (const r of rows) console.log(r.slug.padEnd(20), r.kind.padEnd(11), (r.c * 100).toFixed(1).padStart(5), r.n1, r.n2);
for (const k of ['print', 'manuscript']) console.log(k, 'median R1-R2 CER %', (median(rows.filter(r => r.kind === k).map(r => r.c)) * 100).toFixed(2));
