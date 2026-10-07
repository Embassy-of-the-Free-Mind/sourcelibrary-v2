#!/usr/bin/env node
/**
 * By-eye recheck, step 2 of 2: render one sheet per pair from 9-recheck-plan.mjs's plan (#5689).
 *
 * PRIOR ART: 3-build-sheets.py renders cover + mid page at 330px — too small to read a running
 * header, a page number or an imprint line, which is why this recheck exists. It also needs PIL,
 * which this box does not have; sharp is already in node_modules.
 *
 * Per pair, in OUT/<cluster>-<copy_id>/ (keeper LEFT, copy RIGHT):
 *   t.jpg  title pages, full page, 1150px tall
 *   a.jpg  three aligned text pages, top 48% of each page (header, page number, first lines)
 *   l.jpg  last page with OCR text, and the physical tail (last non-blank page), 820px tall
 *   sheet.jpg  the three stacked (the "one sheet"; t/a/l are what the reviewer reads)
 * Originals come from images.sourcelibrary.org (never /_next/image) and are cached resized in
 * OUT/_img/. Images are NOT committed — rerun to regenerate.
 *
 *   node scripts/identity-evidence/collection-copies-2026-10-03.method/10-recheck-sheets.mjs [PLAN] [OUT] [cluster_no ...]
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';

const PLAN = process.argv[2] || '.scratch/recheck/plan.json';
const OUT = process.argv[3] || '.scratch/recheck/sheets';
const ONLY = new Set(process.argv.slice(4).map(Number));
const plan = JSON.parse(fs.readFileSync(PLAN, 'utf8'));
const IMG = path.join(OUT, '_img');
fs.mkdirSync(IMG, { recursive: true });

async function fetchImg(url, height) {
  if (!url) return null;
  if (url.includes('/_next/image')) throw new Error(`refusing billed /_next/image URL: ${url}`);
  const f = path.join(IMG, `${crypto.createHash('md5').update(url).digest('hex')}-${height}.jpg`);
  if (!fs.existsSync(f)) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(60000) });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const buf = Buffer.from(await r.arrayBuffer());
        await sharp(buf).rotate().resize({ height }).jpeg({ quality: 85 }).toFile(f);
        break;
      } catch (e) {
        if (attempt === 2) { console.error(`  fetch failed ${url}: ${e.message}`); return null; }
      }
    }
  }
  return f;
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const label = (w, h, text, color = '#000') => Buffer.from(
  `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#f0f0f0"/>`
  + `<text x="6" y="${h - 9}" font-family="DejaVu Sans" font-size="20" fill="${color}">${esc(text)}</text></svg>`);

/** One cell: a label strip over a page image, optionally cropped to the top `frac`. */
async function cell(pg, side, height, frac = 1) {
  const W = Math.round(height * 0.72);
  const LH = 32;
  const f = pg ? await fetchImg(pg.img, height) : null;
  let img; let w = W; let h = Math.round(height * frac);
  if (f) {
    const meta = await sharp(f).metadata();
    w = meta.width; h = Math.round(meta.height * frac);
    img = await sharp(f).extract({ left: 0, top: 0, width: w, height: h }).toBuffer();
  }
  const txt = pg ? `${side}  idx ${pg.index} · pnum ${pg.page_number} · OCR p.${pg.page_num ?? '–'} · ${pg.type ?? '?'}` : `${side}  (no page)`;
  const base = sharp({ create: { width: Math.max(w, 420), height: h + LH, channels: 3, background: '#cccccc' } });
  const comps = [{ input: label(Math.max(w, 420), LH, txt, side === 'KEEPER' ? '#00008b' : '#8b0000'), top: 0, left: 0 }];
  if (img) comps.push({ input: img, top: LH, left: 0 });
  return { buf: await base.composite(comps).jpeg().toBuffer(), w: Math.max(w, 420), h: h + LH };
}

async function row(cells, caption) {
  const CH = caption ? 30 : 0, GAP = 16;
  const W = cells.reduce((s, c) => s + c.w, 0) + GAP * (cells.length - 1);
  const H = Math.max(...cells.map((c) => c.h)) + CH;
  const comps = [];
  if (caption) comps.push({ input: label(W, CH, caption, '#333'), top: 0, left: 0 });
  let x = 0;
  for (const c of cells) { comps.push({ input: c.buf, top: CH, left: x }); x += c.w + GAP; }
  return { buf: await sharp({ create: { width: W, height: H, channels: 3, background: '#ffffff' } }).composite(comps).jpeg().toBuffer(), w: W, h: H };
}

async function stack(rows, file, maxW = null) {
  const GAP = 12;
  const W = Math.max(...rows.map((r) => r.w));
  const H = rows.reduce((s, r) => s + r.h, 0) + GAP * (rows.length - 1);
  const comps = []; let y = 0;
  for (const r of rows) { comps.push({ input: r.buf, top: y, left: 0 }); y += r.h + GAP; }
  let s = sharp({ create: { width: W, height: H, channels: 3, background: '#ffffff' } }).composite(comps);
  if (maxW && W > maxW) s = sharp(await s.jpeg().toBuffer()).resize({ width: maxW });
  await s.jpeg({ quality: 82 }).toFile(file);
  return { w: W, h: H };
}

for (const p of plan) {
  if (ONLY.size && !ONLY.has(p.cluster_no)) continue;
  const dir = path.join(OUT, `${String(p.cluster_no).padStart(3, '0')}-${p.copy_id}`);
  fs.mkdirSync(dir, { recursive: true });
  const head = `cl ${p.cluster_no}  ${p.keeper.title?.slice(0, 60)}  | keeper ${p.keeper_id} ${p.keeper.n_pages}pp  | copy ${p.copy_id} ${p.copy.n_pages}pp`;
  const T = await row([await cell(p.title.keeper, 'KEEPER', 1150), await cell(p.title.copy, 'COPY', 1150)], `${head}  | TITLE (${p.title.keeper?.why} / ${p.title.copy?.why})`);
  const A = [];
  for (const a of p.aligned) {
    A.push(await row([await cell(a.keeper, 'KEEPER', 1150, 0.48), await cell(a.copy, 'COPY', 1150, 0.48)], `ALIGNED f=${a.fraction}: ${a.how}`));
  }
  const L = await row([await cell(p.last.keeper, 'KEEPER', 820), await cell(p.last.copy, 'COPY', 820)], 'LAST PAGE WITH OCR TEXT');
  const TL = await row([await cell(p.tail.keeper, 'KEEPER', 820), await cell(p.tail.copy, 'COPY', 820)], 'PHYSICAL TAIL (last non-blank page)');
  await stack([T], path.join(dir, 't.jpg'));
  await stack(A, path.join(dir, 'a.jpg'));
  await stack([L, TL], path.join(dir, 'l.jpg'));
  await stack([T, ...A, L, TL], path.join(dir, 'sheet.jpg'), 1600);
  console.log(`cl ${p.cluster_no} → ${dir}`);
}
