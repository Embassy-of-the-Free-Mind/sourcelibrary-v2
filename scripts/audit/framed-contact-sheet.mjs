#!/usr/bin/env node
/**
 * Before/after contact sheet for display-only page frames on covers and reader
 * strip thumbnails (#6010). Read-only: fetches the images and draws what the
 * card or strip shows today, the whole image with the frame outlined, and what
 * it shows with the frame applied. Look at it before any cover-frame write.
 *
 * Input is JSONL, one `{ id, url, frame: {x,y,w,h}, label? }` per line (the
 * cover-frame-backfill --out rows work as they are: `cover` is read as `url`).
 *
 * Usage: node scripts/audit/framed-contact-sheet.mjs --in=rows.jsonl --out=sheet.jpg \
 *          [--n=24] [--slot=0.75 (w/h of the slot; 0 = the image's own shape)] [--seed=1]
 *
 * PRIOR ART: scripts/audit/page-frame-dry-run.mjs — samples PAGES from Mongo and
 * draws full-size before/after; it has no notion of a card's 3:4 object-cover
 * slot, which is where a cover frame can cut something the page view would not.
 */
import fs from 'node:fs';
import sharp from 'sharp';

const arg = (k, d) => process.argv.find(a => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const N = Number(arg('n', '24'));
const SLOT = Number(arg('slot', '0.75'));
const SEED = Number(arg('seed', '1'));
const H = 220, COLS = 3, GAP = 6;
// Keep in step with PAGE_OVERFILL in src/components/FramedImg.tsx.
const OVERFILL = 1.03;

let s = SEED;
const rnd = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
const rows = fs.readFileSync(arg('in'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
  .map(r => ({ ...r, url: r.url ?? r.cover })).filter(r => r.frame && r.url);
const picked = rows.map(r => [rnd(), r]).sort((a, b) => a[0] - b[0]).slice(0, N).map(x => x[1]);

/** What an `object-cover` slot of shape `ar` shows of a w×h image: the centred crop. */
function coverCrop(w, h, ar) {
  const cw = Math.min(w, Math.round(h * ar)), ch = Math.min(h, Math.round(w / ar));
  return { left: Math.floor((w - cw) / 2), top: Math.floor((h - ch) / 2), width: cw, height: ch };
}

async function tiles(r) {
  const res = await fetch(r.url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`http ${res.status} ${r.url}`);
  const img = sharp(Buffer.from(await res.arrayBuffer())).rotate();
  const { width: w, height: h } = await img.metadata();
  const f = r.frame;
  const box = { left: Math.round(f.x * w), top: Math.round(f.y * h), width: Math.min(w, Math.round(f.w * w)), height: Math.min(h, Math.round(f.h * h)) };
  const ar = SLOT || w / h, arAfter = SLOT || box.width / box.height;
  const W = Math.round(H * (SLOT || 0.75));
  const fit = buf => sharp(buf).resize(W, H, { fit: 'contain', background: '#888' }).jpeg().toBuffer();
  const before = await fit(await img.clone().extract(coverCrop(w, h, ar)).toBuffer());
  const framed = await img.clone().extract(box).toBuffer();
  // FramedImg's `page` fit: fill the slot unless that overfills the page by more
  // than PAGE_OVERFILL; then the page is shown (nearly) whole on the card's ground.
  const pageAr = box.width / box.height;
  const whole = Math.min(W, H * pageAr), filled = Math.max(W, H * pageAr);
  const pw = Math.round(Math.min(filled, whole * OVERFILL)), ph = Math.round(pw / pageAr);
  const scaled = await sharp(framed).resize(pw, ph, { fit: 'fill' }).toBuffer();
  const vis = { left: Math.max(0, Math.floor((pw - W) / 2)), top: Math.max(0, Math.floor((ph - H) / 2)), width: Math.min(pw, W), height: Math.min(ph, H) };
  const after = SLOT
    ? await sharp(await sharp(scaled).extract(vis).toBuffer()).resize(W, H, { fit: 'contain', background: '#f5f0e8' }).jpeg().toBuffer()
    : await fit(await sharp(framed).extract(coverCrop(box.width, box.height, arAfter)).toBuffer());

  const t = Math.max(3, Math.round(w / 150));
  const outline = Buffer.from(`<svg width="${w}" height="${h}"><rect x="${box.left}" y="${box.top}" width="${box.width}" height="${box.height}" fill="none" stroke="red" stroke-width="${t}"/></svg>`);
  const outlined = await fit(await img.clone().composite([{ input: outline }]).toBuffer());
  return { W, bufs: [before, outlined, after] };
}

const cells = [];
for (const r of picked) {
  try { cells.push({ r, ...(await tiles(r)) }); } catch (e) { console.error(`skip ${r.id}: ${e.message}`); }
}
const W = cells[0].W, cellW = 3 * W + 2 * 2 + GAP * 3, cellH = H + 18;
const sheetRows = Math.ceil(cells.length / COLS);
const composites = [];
cells.forEach((c, i) => {
  const x0 = (i % COLS) * cellW + GAP, y0 = Math.floor(i / COLS) * cellH;
  c.bufs.forEach((b, k) => composites.push({ input: b, left: x0 + k * (W + 2), top: y0 + 16 }));
  const label = `${i + 1}. ${c.r.label ?? c.r.provider ?? ''} ${String(c.r.id).slice(0, 40)}`.replace(/[<&>]/g, '');
  composites.push({ input: Buffer.from(`<svg width="${cellW}" height="16"><text x="0" y="12" font-family="sans-serif" font-size="11" fill="#fff">${label}</text></svg>`), left: x0, top: y0 });
});
await sharp({ create: { width: COLS * cellW, height: sheetRows * cellH, channels: 3, background: '#222' } })
  .composite(composites).jpeg({ quality: 88 }).toFile(arg('out'));
console.log(`${cells.length} items -> ${arg('out')} (each: today | whole image, frame in red | with frame)`);
