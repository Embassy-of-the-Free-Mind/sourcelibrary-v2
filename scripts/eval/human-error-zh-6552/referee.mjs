#!/usr/bin/env node
// PRIOR ART: judge.mjs (this directory; panels of six at 500 px). A disputed span gets one fresh Opus look, alone, on a far larger crop, or the whole page when the locator could not place it.
// #6552: which items: Opus cannot_tell or neither; Opus says the leaf has the read against the typed text, not as a variant or a slip (a keying candidate); Gemini disagrees on a non-variant; an agreed span seen differently.
//   node referee.mjs --c=a --tags=a1,a2 [--conc=3]     appends $JOB_SCRATCH/<c>/referee.jsonl, images in $JOB_SCRATCH/<c>/referee/
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { RULES, parse, claudeCall } from './reader.mjs';
import { locate, foldCh } from './lib.mjs';
const arg = (n, d) => process.argv.find((x) => x.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const ROOT = path.join(process.env.JOB_SCRATCH, arg('c')), TAGS = arg('tags').split(','), CONC = +arg('conc', 3), DIR = path.join(ROOT, 'referee'), F = path.join(ROOT, 'referee.jsonl'); fs.mkdirSync(DIR, { recursive: true });
const said = (it, v) => { if (!v) return null; if (v.choice === 'A') return it.swap ? 'ocr' : 'typed'; if (v.choice === 'B') return it.swap ? 'typed' : 'ocr'; return v.choice; };
const done = new Set(fs.existsSync(F) ? fs.readFileSync(F, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).id) : []), todo = [];
for (const t of TAGS) {
  const OUT = path.join(ROOT, 'tags', t), key = JSON.parse(fs.readFileSync(path.join(OUT, 'key.json'))), V = {};
  for (const r of ['opus', 'gemini']) { V[r] = {}; const f = path.join(OUT, `verdicts-${r}.jsonl`); if (fs.existsSync(f)) for (const l of fs.readFileSync(f, 'utf8').split('\n').filter(Boolean)) { const row = JSON.parse(l); for (const it of row.items || []) V[r][`${row.packet}:${it.n}`] = it; } }
  for (const it of key) {
    if (done.has(it.id) || !['real', 'agreed'].includes(it.kind)) continue;
    const o = V.opus[`${it.packet}:${it.n}`], g = V.gemini[`${it.packet}:${it.n}`], so = said(it, o), sg = said(it, g);
    if (!o) continue;
    let why = null;
    if (it.kind === 'agreed') { if (o.choice === 'cannot_tell' || (o.seen && foldCh([...o.seen][0]) !== foldCh(it.ocr))) why = 'agreed-differs'; }
    else if (so === 'cannot_tell') why = 'cannot_tell';
    else if (so === 'neither') why = 'neither';
    else if (so === 'ocr' && !o.variant && !o.slip) why = 'keying-candidate';
    else if (g && sg !== so && !o.variant && !g.variant) why = 'split';
    if (why) todo.push({ it, why, tag: t });
  }
}
console.log('referee items', todo.length, Object.entries(todo.reduce((a, x) => (a[x.why] = (a[x.why] || 0) + 1, a), {})));
let next = 0;
await Promise.all(Array.from({ length: CONC }, async () => { while (next < todo.length) {
  const { it, why, tag } = todo[next++], img = path.join(ROOT, 'img', `${it.uid}.jpg`), m = await sharp(img).metadata(), lines = JSON.parse(fs.readFileSync(path.join(ROOT, 'lines', `${it.uid}.lines.json`))), loc = locate(lines, it.left, it.right); let box = { left: 0, top: 0, width: m.width, height: m.height };
  if (loc.score >= 4) { const [x0, y0, x1, y1] = loc.row.box, vert = y1 - y0 >= x1 - x0, cw = Math.min(x1 - x0, y1 - y0), fr = (loc.p + 0.5) / Math.max(1, loc.n), cx = vert ? (x0 + x1) / 2 : x0 + fr * (x1 - x0), cy = vert ? y0 + fr * (y1 - y0) : (y0 + y1) / 2, hw = Math.max(cw * 4, m.width * 0.12), hh = hw * 1.25; box = { left: Math.max(0, Math.round(cx - hw)), top: Math.max(0, Math.round(cy - hh)) }; box.width = Math.min(m.width - box.left, Math.round(hw * 2)); box.height = Math.min(m.height - box.top, Math.round(hh * 2)); }
  const file = path.join(DIR, `${it.id}.png`); await sharp(img).extract(box).resize(1200, 1500, { fit: 'inside' }).png().toFile(file);
  const A = it.swap ? it.ocr : it.typed, B = it.swap ? it.typed : it.ocr, line = it.kind === 'agreed' ? `[1] context: ${it.left}[?]${it.right} | no candidate readings: say what the leaf shows at [?]` : `[1] context: ${it.left}[?]${it.right} | Reading A: ${A || '(nothing)'} | Reading B: ${B || '(nothing)'}`;
  const prompt = `The image ${file} is cut from a page of a Chinese manuscript or print${loc.score >= 4 ? '' : ' (the whole page: find the passage in it)'}. Look at it first. Vertical columns read top to bottom, columns right to left; small double-line notes run inside a column.\n\n${RULES}\n\n${line}`;
  let r = await claudeCall(prompt, true, DIR), items = parse(r.text, 1); if (!items) { r = await claudeCall(prompt, true, DIR); items = parse(r.text, 1); }
  fs.appendFileSync(F, JSON.stringify({ id: it.id, tag, why, whole_page: loc.score < 4, item: items?.[0] ?? null, cost: r.cost ?? null, err: items ? null : (r.err || String(r.text).slice(0, 200)) }) + '\n'); console.log(it.id, why, items?.[0]?.choice ?? 'FAILED');
} }));
