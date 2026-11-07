#!/usr/bin/env node
// PRIOR ART: none — the #6561 and #6560 harnesses ran one read per page and have no repeat draw (looked in
// paddle-correct-6561/draw.mjs and tibetan-correct-6560/prep.py). The seeded pick of the PREREG's repeat pages.
// Usage: draw-r2.mjs <zh sets.json> <tib req/corr.jsonl> <out dir>  → r2-zh.json, r2-tib.json
import fs from 'node:fs';
import { makeRng } from '../ground-truth-5935/lib.mjs';

const [, , ZH, TIB, OUT] = process.argv;
const pick = (arr, n, seed) => { const r = makeRng(seed), a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a.slice(0, n).sort(); };
const sets = JSON.parse(fs.readFileSync(ZH, 'utf8'));
const zh = [...pick(sets.filter((s) => s.stratum === 'A').map((s) => s.uid), 5, 7263), ...pick(sets.filter((s) => s.stratum === 'B-rand').map((s) => s.uid), 5, 7263)];
const tib = pick(fs.readFileSync(TIB, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).uid), 10, 7263);
fs.writeFileSync(`${OUT}/r2-zh.json`, JSON.stringify(zh));
fs.writeFileSync(`${OUT}/r2-tib.json`, JSON.stringify(tib));
console.log({ zh, tib });
