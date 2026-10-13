#!/usr/bin/env node
// PRIOR ART: scripts/eval/paddle-zh-qa-6388/prepare.mjs `controls` (planted errors in the OCR text); here the plant is
// in the ENGLISH, made by hand, so this file only picks the five host pages. No model call, no Mongo. $0.
// Rule: eligible pages (census) in books NOT in draw.json, old-vs-new CER < 0.05, English 1,200–3,000 characters;
// five books by seed 6390, one page each by the same rng. Out: $JOB_SCRATCH/control-bases.json.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { makeRng } from '../lib/paired-stats.mjs';
const HERE = path.dirname(new URL(import.meta.url).pathname);
const SCRATCH = process.env.JOB_SCRATCH;
const rows = zlib.gunzipSync(fs.readFileSync(path.join(SCRATCH, 'census.jsonl.gz'))).toString().split('\n').filter(Boolean).map(l => JSON.parse(l));
const drawn = new Set(JSON.parse(fs.readFileSync(path.join(HERE, 'draw.json'))).items.map(i => i.book_id));
const ok = rows.filter(r => !r.excluded && !drawn.has(r.book_id) && r.cer < 0.05 && r.english.length >= 1200 && r.english.length <= 3000);
const byBook = new Map(); for (const r of ok) (byBook.get(r.book_id) || byBook.set(r.book_id, []).get(r.book_id)).push(r);
const ids = [...byBook.keys()].sort(), rng = makeRng(6390);
for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
const out = ids.slice(0, 5).map(b => { const ps = byBook.get(b).sort((x, y) => x.page_number - y.page_number); return ps[Math.floor(rng() * ps.length)]; });
fs.writeFileSync(path.join(SCRATCH, 'control-bases.json'), JSON.stringify(out, null, 1));
for (const r of out) console.log(r.page_id, r.title, r.page_number, r.cer.toFixed(3));
