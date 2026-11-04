#!/usr/bin/env node
// PRIOR ART: the #5924 by-eye picks (Mulberry32(1026) over corrected pages, inline in the job) — never committed as a
//   script; this is the #7568 prereg's "2 random pages where C and R differ", Mulberry32(seed + 5), Fisher–Yates.
// w-byeye.mjs — LANG7568=<lang>. Prints the 2 slugs and the paths of the image and the three texts.
import fs from 'node:fs'; import path from 'node:path';
import { lite, servedC, readR } from './w-packets.mjs';
import { LANGS } from './w-draw.mjs';
const L = process.env.LANG7568, S = path.join(process.env.JOB_SCRATCH, L), HERE = path.dirname(new URL(import.meta.url).pathname);
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const sample = JSON.parse(fs.readFileSync(path.join(HERE, 'results-7568', L, 'sample.json'), 'utf8'));
const pool = sample.books.flatMap(b => b.pages).filter(p => { const l = lite(p.slug); return servedC(p.page_id, l).text !== readR(p.page_id).text; });
const r = mulberry32(LANGS[L].seed + 5);
for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
for (const p of pool.slice(0, 2)) console.log(JSON.stringify({ slug: p.slug, img: path.join(S, 'draw', `${p.slug}.jpg`), full: path.join(S, 'draw', `${p.slug}.full.jpg`), L: path.join(S, 'draw', `${p.slug}.lite.txt`), C: path.join(S, 'set/reads', `${p.page_id}.txt`), R: path.join(S, 'R', `${p.page_id}.txt`) }));
