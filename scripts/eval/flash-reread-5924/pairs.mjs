#!/usr/bin/env node
// PRIOR ART: scripts/batch/reread-gate.mjs (blind A/B against the image, through claude -p) — it judges one BOOK's
//   re-read for an apply gate and keeps no per-read misleading verdict; the prereg here needs both, per page.
// pairs.mjs — Step C packets (#5924): per page the image and two transcriptions, X/Y order from Mulberry32(1023)
//   drawn in sample order. Writes $JOB_SCRATCH/agents/C-in-<book>.json (no arm names) and $JOB_SCRATCH/keys/c-key.json.
import fs from 'node:fs'; import path from 'node:path'; import zlib from 'node:zlib';
const J = process.env.JOB_SCRATCH; const HERE = path.dirname(new URL(import.meta.url).pathname);
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rnd = mulberry32(1023);
const sample = JSON.parse(fs.readFileSync(path.join(HERE, 'results/sample.json'), 'utf8'));
const F = new Map(zlib.gunzipSync(fs.readFileSync(path.join(HERE, 'results/F-reads.jsonl.gz'))).toString('utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).map(r => [r.page_id, r]));
fs.mkdirSync(path.join(J, 'keys'), { recursive: true }); fs.mkdirSync(path.join(J, 'pairs'), { recursive: true });
const key = {};
sample.books.forEach((b, i) => {
  const pages = b.pages.map(p => {
    const L = fs.readFileSync(path.join(J, 'draw', `${p.slug}.lite.txt`), 'utf8'), f = F.get(p.page_id)?.text || '';
    const fFirst = rnd() < 0.5; key[p.slug] = fFirst ? 'XF' : 'XL';
    const [x, y] = fFirst ? [f, L] : [L, f];
    const xp = path.join(J, 'pairs', `${p.slug}.X.txt`), yp = path.join(J, 'pairs', `${p.slug}.Y.txt`);
    fs.writeFileSync(xp, x); fs.writeFileSync(yp, y);
    return { slug: p.slug, page_number: p.page_number, img: path.join(J, 'draw', `${p.slug}.jpg`), full_img: path.join(J, 'draw', `${p.slug}.full.jpg`), X: xp, Y: yp };
  });
  fs.writeFileSync(path.join(J, 'agents', `C-in-${i}.json`), JSON.stringify({ book_id: b.book_id, title: b.title, year: b.year, pages }, null, 1));
});
fs.writeFileSync(path.join(J, 'keys', 'c-key.json'), JSON.stringify(key));
console.log(JSON.stringify({ pages: Object.keys(key).length, f_first: Object.values(key).filter(v => v === 'XF').length, f_empty: sample.books.flatMap(b => b.pages).filter(p => !(F.get(p.page_id)?.text || '').trim()).length }));
