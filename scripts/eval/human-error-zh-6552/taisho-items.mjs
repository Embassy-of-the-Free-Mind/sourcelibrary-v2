#!/usr/bin/env node
// PRIOR ART: draw-c.mjs --stage=taisho (fetches the leaves and CBETA's text per page); score.mjs (classes). This picks what goes to those leaves.
// #6552 collection C: a witness's leaf differing from CBETA says nothing about CBETA until CBETA's own leaf is opened. Every item where a final verdict
// has that witness's leaf away from CBETA goes to the Taisho leaf that holds it, on the page its context locates best. Text stays under $JOB_SCRATCH.
//   node taisho-items.mjs      after locate-lines over c-t/img into c-t/lines; writes c-t/only.json, and c-t/pages/*.ocr = the locator text (for control sites only)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { locate } from './lib.mjs';
const C = process.env.JOB_SCRATCH, T = path.join(C, 'c-t'), L = {};
for (const f of fs.readdirSync(path.join(T, 'lines'))) { const u = f.replace('.lines.json', ''); L[u] = JSON.parse(fs.readFileSync(path.join(T, 'lines', f))); const pf = path.join(T, 'pages', `${u}.json`), d = JSON.parse(fs.readFileSync(pf)); d.ocr = L[u].map((r) => r.text).join(''); fs.writeFileSync(pf, JSON.stringify(d)); }
const out = [], seen = new Set(), SEND = new Set(['KEYING', 'EDITORIAL_NORM', 'EDITORIAL_CORR', 'NEITHER']);
for (const [c, tag] of [['c-f', 'f1'], ['c-o', 'o1']]) {
  const rows = JSON.parse(execFileSync('node', ['score.mjs', `--c=${c}`, `--tags=${tag}`, '--items'], { encoding: 'utf8', maxBuffer: 1e8, env: process.env }));
  for (const it of rows.filter((x) => SEND.has(x.cls))) {
    let best = null; for (const u of Object.keys(L)) { const s = locate(L[u], it.left, it.right).score; if (!best || s > best.s) best = { u, s }; }
    const k = `${it.left}|${it.typed}|${it.right}`; if (seen.has(k)) { out.find((o) => o.key === k).from.push(it.id); continue; } seen.add(k);
    out.push({ key: k, uid: best.u, typed: it.typed, ocr: it.ocr, left: it.left, right: it.right, loc: best.s, from: [it.id], declared_change: it.declared_change || undefined });
  }
}
fs.writeFileSync(path.join(T, 'only.json'), JSON.stringify(out));
console.log('items', out.length, 'poorly located', out.filter((o) => o.loc < 6).length, 'pages', new Set(out.map((o) => o.uid)).size);
