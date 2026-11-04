#!/usr/bin/env node
// PRIOR ART: draw-c.mjs --stage=taisho (fetches the leaves and CBETA's text per page); score.mjs (classes). This picks what goes to those leaves.
// #6552 collection C: a witness's leaf differing from CBETA says nothing about CBETA until CBETA's own leaf is opened. Every item where a final verdict
// has that witness's leaf away from CBETA goes to the Taisho leaf that holds it, on the page its context locates best. Text stays under $JOB_SCRATCH.
//   node taisho-items.mjs      after locate-lines over c-t/img into c-t/lines; writes c-t/only.json, and c-t/pages/*.ocr = the locator text (for control sites only)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { locate, foldCh, hanChars } from './lib.mjs';
const C = process.env.JOB_SCRATCH, T = path.join(C, 'c-t'), L = {}, TY = {};
for (const f of fs.readdirSync(path.join(T, 'lines'))) { const u = f.replace('.lines.json', ''); L[u] = JSON.parse(fs.readFileSync(path.join(T, 'lines', f))); const pf = path.join(T, 'pages', `${u}.json`), d = JSON.parse(fs.readFileSync(pf)); TY[u] = hanChars(d.typed).map(foldCh); const ys = L[u].flatMap((r) => [r.box[1], r.box[3]]), y0 = Math.min(...ys), band = (Math.max(...ys) - y0) / 3, reg = (r) => Math.min(2, Math.floor(((r.box[1] + r.box[3]) / 2 - y0) / band)); // the Taisho's three registers, right to left in each
  d.ocr = [...L[u]].sort((a, b) => reg(a) - reg(b) || Math.round((b.box[0] - a.box[0]) / 25) || a.box[1] - b.box[1]).map((r) => r.text).join(''); fs.writeFileSync(pf, JSON.stringify(d)); }
const out = [], seen = new Set(), SEND = new Set(['KEYING', 'EDITORIAL_NORM', 'EDITORIAL_CORR', 'NEITHER']);
for (const [c, tag] of [['c-f', 'f1'], ['c-o', 'o1']]) {
  const rows = JSON.parse(execFileSync('node', ['score.mjs', `--c=${c}`, `--tags=${tag}`, '--items'], { encoding: 'utf8', maxBuffer: 1e8, env: process.env }));
  for (const it of rows.filter((x) => SEND.has(x.cls) && !(tag === 'o1' && x.cls === 'EDITORIAL_NORM'))) { // the old print's short forms (尒, 来) say nothing about CBETA
    // the page whose CBETA text holds this span, masks as wildcards: a Taisho row is one short register, so the locator alone can pick the wrong leaf
    const hold = Object.keys(L).filter((u) => { const seq = [...it.left, ...it.typed, ...it.right].map(foldCh); return seq.length && TY[u].some((_, p) => seq.every((c, q) => c === '□' || TY[u][p + q] === c)); });
    let best = null; for (const u of hold.length ? hold : Object.keys(L)) { const s = locate(L[u], it.left, it.right).score; if (!best || s > best.s) best = { u, s }; } best.held = hold.length > 0;
    const k = `${it.left}|${it.typed}|${it.right}`; if (seen.has(k)) { out.find((o) => o.key === k).from.push(it.id); continue; } seen.add(k);
    out.push({ key: k, uid: best.u, typed: it.typed, ocr: it.ocr, left: it.left, right: it.right, loc: best.s, held: best.held, from: [it.id], declared_change: it.declared_change || undefined });
  }
}
fs.writeFileSync(path.join(T, 'only.json'), JSON.stringify(out));
console.log('items', out.length, 'on a page whose CBETA holds the span', out.filter((o) => o.held).length, 'poorly located', out.filter((o) => o.loc < 6).length, 'pages', new Set(out.map((o) => o.uid)).size);
