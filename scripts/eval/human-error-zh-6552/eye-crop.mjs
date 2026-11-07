#!/usr/bin/env node
// PRIOR ART: referee.mjs (the same crop for a referee call). This writes the crop, and a sheet of them, for a human-style look by the session itself; no model call.
// #6552: node eye-crop.mjs --c=a --tag=a1,a2 --ids=a1-0008,a2-0064  → $JOB_SCRATCH/<c>/eye/<sheet>.png, panels left to right in id order
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { locate } from './lib.mjs';
const arg = (n, d) => process.argv.find((x) => x.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const ROOT = path.join(process.env.JOB_SCRATCH, arg('c')), key = arg('tag').split(',').flatMap((t) => JSON.parse(fs.readFileSync(path.join(ROOT, 'tags', t, 'key.json')))), ids = arg('ids').split(','), DIR = path.join(ROOT, 'eye'), W = 620, H = 760; fs.mkdirSync(DIR, { recursive: true });
const comps = [];
for (const [n, id] of ids.entries()) {
  const it = key.find((k) => k.id === id), img = path.join(ROOT, 'img', `${it.uid}.jpg`), m = await sharp(img).metadata(), lines = JSON.parse(fs.readFileSync(path.join(ROOT, 'lines', `${it.uid}.lines.json`))), loc = locate(lines, it.left, it.right); let box = { left: 0, top: 0, width: m.width, height: m.height };
  if (loc.score >= 4) { const [x0, y0, x1, y1] = loc.row.box, vert = y1 - y0 >= x1 - x0, cw = Math.min(x1 - x0, y1 - y0), fr = (loc.p + 0.5) / Math.max(1, loc.n), cx = vert ? (x0 + x1) / 2 : x0 + fr * (x1 - x0), cy = vert ? y0 + fr * (y1 - y0) : (y0 + y1) / 2, hw = Math.max(cw * 2.6, m.width * 0.09), hh = hw * (H / W); box = { left: Math.max(0, Math.round(cx - hw)), top: Math.max(0, Math.round(cy - hh)) }; box.width = Math.min(m.width - box.left, Math.round(hw * 2)); box.height = Math.min(m.height - box.top, Math.round(hh * 2)); }
  comps.push({ input: await sharp(img).extract(box).resize(W, H, { fit: 'contain', background: '#fff' }).png().toBuffer(), left: (n % 3) * (W + 8), top: Math.floor(n / 3) * (H + 8) });
  console.log(n + 1, id, it.kind, `${it.left}[${it.typed}|${it.ocr}]${it.right}`, 'score', loc.score);
}
const rows = Math.ceil(ids.length / 3), out = path.join(DIR, `${ids[0]}.png`);
await sharp({ create: { width: 3 * W + 16, height: rows * H + (rows - 1) * 8, channels: 3, background: '#888' } }).composite(comps).png().toFile(out); console.log(out);
