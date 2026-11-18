#!/usr/bin/env node
/**
 * Stage 2 of the self-agreement test (PREREG-print.md): Chinese print, where there is no Kanripo leaf.
 * PRIOR ART: draw.mjs here (Siku, stage 1) and scripts/workers/paddle-print-lane.mjs (the lane whose leaves and crops
 * are reused unchanged: manifest.tsv rows <bid>\t<pn>-<side>\t<url>\t<crop>, reads in out/<bid>/<pn>-<side>.txt).
 *
 * Draws up to PER_BOOK random interior pages per Chinese frame book that the lane wrote (>= 40 characters), seed 6872,
 * and writes the leaves of those pages as a manifest for the layout-ON arm. Files only; no Mongo.
 *   node print-draw.mjs [--lane /root/jobs/paddle-print-6101] [--out /root/jobs/paddle-self-agree-6871/print]
 */
import fs from 'node:fs';
import path from 'node:path';
import { makeRng } from '../lib/paired-stats.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const LANE = arg('lane', '/root/jobs/paddle-print-6101'), OUT = arg('out', '/root/jobs/paddle-self-agree-6871/print');
const PER_BOOK = 3, SEED = 6872;
fs.mkdirSync(OUT, { recursive: true });
const zh = new Set(fs.readFileSync(path.join(LANE, 'frame-zh-ids.txt'), 'utf8').split('\n').map((s) => s.trim()).filter(Boolean));

const byBook = new Map();
for (const l of fs.readFileSync(path.join(LANE, 'applied.jsonl'), 'utf8').split('\n')) {
  if (!l) continue; const r = JSON.parse(l);
  if (!zh.has(r.bid) || r.chars < 40) continue;
  (byBook.get(r.bid) || byBook.set(r.bid, []).get(r.bid)).push(r);
}
const leaves = new Map();   // `${bid}/${pn}` → manifest rows, right leaf first
for (const l of fs.readFileSync(path.join(LANE, 'manifest.tsv'), 'utf8').split('\n')) {
  const c = l.split('\t'); if (c.length < 3) continue;
  const pn = c[1].replace(/-[A-Z]+$/, ''); const k = `${c[0]}/${pn}`;
  (leaves.get(k) || leaves.set(k, []).get(k)).push(c);
}
const sideRank = (n) => (/-R$/.test(n) ? 0 : /-L$/.test(n) ? 2 : 1);

const rnd = makeRng(SEED);
const pages = [], man = [];
for (const bid of [...byBook.keys()].sort()) {
  const ps = byBook.get(bid).sort((a, b) => a.pn - b.pn);
  const n = ps.length, inner = ps.filter((_, i) => i >= n * 0.15 && i < n * 0.95);
  const pool = (inner.length ? inner : ps).slice();
  for (let k = 0; k < PER_BOOK && pool.length; k++) {
    const p = pool.splice(Math.floor(rnd() * pool.length), 1)[0];
    const ls = (leaves.get(`${bid}/${p.pn}`) || []).sort((a, b) => sideRank(a[1]) - sideRank(b[1]));
    if (!ls.length || !ls.every((c) => fs.existsSync(path.join(LANE, 'out', bid, `${c[1]}.txt`)))) continue;
    pages.push({ bid, pn: p.pn, pid: p.pid, chars: p.chars, revision: p.revision, leaves: ls.map((c) => c[1]), image: ls[0][2] });
    for (const c of ls) man.push(c.join('\t'));
  }
}
fs.writeFileSync(path.join(OUT, 'pages.json'), JSON.stringify(pages, null, 1));
fs.writeFileSync(path.join(OUT, 'manifest.tsv'), man.join('\n') + '\n');
console.log(`${pages.length} pages from ${new Set(pages.map((p) => p.bid)).size} books, ${man.length} leaves → ${OUT}`);
