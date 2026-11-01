#!/usr/bin/env node
// PRIOR ART: the #5771 Neyphug dry-run contact sheet (scratchpad/_ney-*.mjs, never committed: crop + proposed order per
// photo pair) and scripts/eval/opus-tib-sa-6948/audit.mjs tile() (sharp resizing). This draws one row per FRAME: the
// frame with its cut lines, then each leaf crop with a zoom of its left margin, where a recto carries its folio label.
/**
 * contact.mjs — $0, files only. Contact sheets for the split of job split-leaves-5771 (#5771).
 *   node scripts/eval/split-leaf-5771/contact.mjs --frames=frames.jsonl --crops=DIR --uids=a008,a010,... --out=sheet.jpg
 * DIR holds <uid>.json (the cut actually used, from yig_leaf_read.py) and <uid>-L<i>.jpg. Writes one JPEG per 5 frames
 * (sheet-1.jpg, sheet-2.jpg, ...) so each opens at a readable size.
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const frames = new Map(fs.readFileSync(arg('frames'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).map((f) => [f.uid, f]));
const D = arg('crops'), uids = arg('uids').split(','), out = arg('out');
const ROW_H = 420, FRAME_W = 560, LEAF_W = 700, ZOOM_W = 260, PAD = 10;

const label = (text, w, h = 26) => Buffer.from(`<svg width="${w}" height="${h}"><rect width="100%" height="100%" fill="#fff"/><text x="4" y="${h - 8}" font-family="sans-serif" font-size="18" fill="#000">${text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text></svg>`);

async function row(uid) {
  const f = frames.get(uid), meta = JSON.parse(fs.readFileSync(path.join(D, `${uid}.json`), 'utf8'));
  const leaves = fs.readdirSync(D).filter((x) => x.startsWith(`${uid}-L`) && x.endsWith('.jpg')).sort();
  // The frame, rebuilt from its leaves (they partition it), with a red line at every cut.
  const parts = await Promise.all(leaves.map((x) => sharp(path.join(D, x)).resize({ width: FRAME_W }).toBuffer({ resolveWithObject: true })));
  const fh = parts.reduce((a, p) => a + p.info.height, 0);
  let y = 0; const comp = [];
  for (const [i, p] of parts.entries()) { comp.push({ input: p.data, top: y, left: 0 }); y += p.info.height; if (i < parts.length - 1) comp.push({ input: Buffer.from(`<svg width="${FRAME_W}" height="4"><rect width="100%" height="100%" fill="red"/></svg>`), top: y - 2, left: 0 }); }
  const frame = await sharp({ create: { width: FRAME_W, height: fh, channels: 3, background: '#fff' } }).composite(comp).jpeg().toBuffer();
  const frameS = await sharp(frame).resize({ width: FRAME_W, height: ROW_H - 30, fit: 'inside' }).toBuffer({ resolveWithObject: true });
  const cells = [{ input: label(`${uid} ${f.stratum} p.${f.page_number} stored:${f.stored.read_mode} ${f.before.verdict} spans ${f.before.ocr_spans} | cut ${meta.cut.replace('yigdzin-leaf-', '')}`, FRAME_W + LEAF_W + ZOOM_W + 3 * PAD), top: 0, left: 0 },
    { input: frameS.data, top: 30, left: 0 }];
  // Each leaf: the crop, and a zoom of its leftmost 12% (the margin label on a recto).
  const lh = Math.floor((ROW_H - 30) / leaves.length);
  for (const [i, x] of leaves.entries()) {
    const src = sharp(path.join(D, x)); const m = await src.metadata();
    const leaf = await sharp(path.join(D, x)).resize({ width: LEAF_W, height: lh - 4, fit: 'inside' }).toBuffer();
    const zoom = await sharp(path.join(D, x)).extract({ left: 0, top: 0, width: Math.round(m.width * 0.12), height: m.height }).resize({ width: ZOOM_W, height: lh - 4, fit: 'inside' }).toBuffer();
    cells.push({ input: leaf, top: 30 + i * lh, left: FRAME_W + PAD }, { input: zoom, top: 30 + i * lh, left: FRAME_W + LEAF_W + 2 * PAD });
    cells.push({ input: label(`L${i + 1}`, 40, 22), top: 30 + i * lh, left: FRAME_W + PAD });
  }
  return sharp({ create: { width: FRAME_W + LEAF_W + ZOOM_W + 3 * PAD, height: ROW_H, channels: 3, background: '#ddd' } }).composite(cells).jpeg({ quality: 85 }).toBuffer();
}

for (let s = 0; s < uids.length; s += 5) {
  const rows = await Promise.all(uids.slice(s, s + 5).map(row));
  const W = FRAME_W + LEAF_W + ZOOM_W + 3 * PAD;
  const sheet = await sharp({ create: { width: W, height: rows.length * (ROW_H + PAD), channels: 3, background: '#888' } }).composite(rows.map((b, i) => ({ input: b, top: i * (ROW_H + PAD), left: 0 }))).jpeg({ quality: 85 }).toBuffer();
  const f = out.replace(/\.jpg$/, `-${s / 5 + 1}.jpg`);
  fs.writeFileSync(f, sheet);
  console.log(f);
}
