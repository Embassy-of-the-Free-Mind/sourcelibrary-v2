#!/usr/bin/env node
// #5660 resume: run scripts/lib/first-ocr-guard.mjs over a directory of reads. Never writes to Mongo.
//   node first-ocr-guard-run.mjs --texts <dir of <stem>.txt> [--images <dir of <stem>.jpg>] --out <file.jsonl>
import fs from 'node:fs';
import { firstOcrVerdict } from '../../lib/first-ocr-guard.mjs';
const arg = (k) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : null; };
const texts = arg('texts'), images = arg('images'), out = arg('out');
const stems = fs.readdirSync(texts).filter(f => f.endsWith('.txt')).map(f => f.slice(0, -4));
const rows = [];
for (const s of stems) {
  const img = images && fs.existsSync(`${images}/${s}.jpg`) ? fs.readFileSync(`${images}/${s}.jpg`) : null;
  rows.push({ stem: s, ...(await firstOcrVerdict(fs.readFileSync(`${texts}/${s}.txt`, 'utf8'), img)) });
}
fs.writeFileSync(out, rows.map(r => JSON.stringify(r)).join('\n') + '\n');
const by = {}; for (const r of rows) for (const f of r.flags) by[f] = (by[f] || 0) + 1;
console.log(JSON.stringify({ pages: rows.length, flagged: rows.filter(r => r.flag).length, rate: +(rows.filter(r => r.flag).length / rows.length).toFixed(4), by }));
