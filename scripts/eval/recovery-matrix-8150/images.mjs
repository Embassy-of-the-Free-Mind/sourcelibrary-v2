#!/usr/bin/env node
/**
 * PRIOR ART: scripts/audit/image-provenance-coverage.mjs (its robustness row: recompress, resize, centre
 * crop, on the raw detector; reused for those rows of the slice 9 matrix, not repeated here). It does not
 * read EXIF, does not try a crop that is not centred, and has no way back from a crop: a crop shifts the
 * block grid, so the keyed pairs land on the wrong blocks and the detector reads noise.
 *
 * Slice 9 of #8150, the rows the audit does not cover:
 *   EXIF        survives a byte copy only? (any re-encode through a normal tool drops it)
 *   EXIF strip  pixels kept, metadata gone: the watermark alone
 *   crops       raw, and REGISTERED: find the copy inside our own served image (a coarse-to-fine search
 *               over offsets), lay it back on a flat canvas at that offset, and detect. Flat blocks carry
 *               no pairs (the detector skips them), so only the part the copier kept is read. This needs
 *               a candidate page; in the wild it comes from the page's text (OCR the copy, then
 *               match-passage.mjs or the reader search on the OCR).
 *   edition     the watermark is keyed per edition: the same image read under another edition's id
 *   FP          the same treatments and the same registration on UNMARKED served images
 *
 * Usage: node --env-file=.env.production.local scripts/eval/recovery-matrix-8150/images.mjs --out=DIR --n=20
 */
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { MongoClient } from 'mongodb';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { detectWatermark } from '../../lib/provenance-mark.mjs';

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const OUT = arg('out', '/tmp/s9');
const N = Number(arg('n', 20));
const KEY = process.env.PROVENANCE_SECRET_KEY;
const R2_BASE = process.env.R2_PUBLIC_URL || 'https://images.sourcelibrary.org';
const BUCKET = process.env.R2_BUCKET_NAME || 'sourcelibrary';
const r2 = new S3Client({
  region: 'auto', maxAttempts: 5,
  endpoint: `https://${(process.env.R2_ACCOUNT_ID || '').trim()}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID || '', secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '' },
});
async function readObject(key) {
  const o = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const chunks = [];
  for await (const c of o.Body) chunks.push(c);
  return Buffer.concat(chunks);
}

async function exifEdition(buf) {
  const m = await sharp(buf, { failOn: 'none' }).metadata();
  const s = m.exif ? m.exif.toString('latin1') : '';
  const e = s.match(/\[edition ([0-9a-f]{4,12})\]/);
  return e ? e[1] : null;
}

/** Grey plane at a given width. */
async function grey(buf, width) {
  const { data, info } = await sharp(buf, { failOn: 'none' }).greyscale().resize({ width }).raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}

/** Find where `copy` (a crop at the same scale) sits inside `orig`: coarse SAD search, then refine. */
async function locate(orig, copy) {
  const om = await sharp(orig).metadata(), cm = await sharp(copy).metadata();
  const f = 8;
  const O = await grey(orig, Math.round(om.width / f)), C = await grey(copy, Math.max(8, Math.round(cm.width / f)));
  let best = { x: 0, y: 0, s: Infinity };
  for (let y = 0; y + C.h <= O.h; y++) for (let x = 0; x + C.w <= O.w; x++) {
    let s = 0;
    for (let j = 0; j < C.h; j += 2) for (let i = 0; i < C.w; i += 2) s += Math.abs(O.data[(y + j) * O.w + x + i] - C.data[j * C.w + i]);
    if (s < best.s) best = { x, y, s };
  }
  const Of = await grey(orig, om.width), Cf = await grey(copy, cm.width);
  let fine = { x: best.x * f, y: best.y * f, s: Infinity };
  for (let dy = -f; dy <= f; dy++) for (let dx = -f; dx <= f; dx++) {
    const x = best.x * f + dx, y = best.y * f + dy;
    if (x < 0 || y < 0 || x + Cf.w > Of.w || y + Cf.h > Of.h) continue;
    let s = 0;
    for (let j = 0; j < Cf.h; j += 7) for (let i = 0; i < Cf.w; i += 7) s += Math.abs(Of.data[(y + j) * Of.w + x + i] - Cf.data[j * Cf.w + i]);
    if (s < fine.s) fine = { x, y, s };
  }
  return { x: fine.x, y: fine.y, W: om.width, H: om.height };
}

/** Lay the copy back at its offset on a flat canvas the size of our image. */
async function register(orig, copy) {
  const at = await locate(orig, copy);
  return sharp({ create: { width: at.W, height: at.H, channels: 3, background: { r: 128, g: 128, b: 128 } } })
    .composite([{ input: await sharp(copy).jpeg({ quality: 95 }).toBuffer(), left: at.x, top: at.y }]).jpeg({ quality: 95 }).toBuffer();
}

async function crop(buf, frac, where = 'centre') {
  const m = await sharp(buf).metadata();
  const w = Math.round(m.width * frac), h = Math.round(m.height * frac);
  const left = where === 'centre' ? Math.round((m.width - w) / 2) : Math.round((m.width - w) * 0.83) + 3;
  const top = where === 'centre' ? Math.round((m.height - h) / 2) : Math.round((m.height - h) * 0.21) + 5;
  return sharp(buf).extract({ left, top, width: w, height: h }).jpeg({ quality: 85 }).toBuffer();
}

const TREAT = [
  { name: 'byte copy', f: async (b) => b },
  { name: 'EXIF stripped, pixels kept (re-encode q95)', f: (b) => sharp(b).jpeg({ quality: 95 }).toBuffer() },
  { name: 'PNG screenshot, same size', f: (b) => sharp(b).png().toBuffer() },
  { name: 'greyscale', f: (b) => sharp(b).greyscale().jpeg({ quality: 85 }).toBuffer() },
  { name: 'crop 90% centre', f: (b) => crop(b, 0.9), reg: true },
  { name: 'crop 70% off-centre', f: (b) => crop(b, 0.7, 'off'), reg: true },
  { name: 'crop 50% centre', f: (b) => crop(b, 0.5), reg: true },
];

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const client = await MongoClient.connect(process.env.MONGODB_URI);
  const db = client.db(process.env.MONGODB_DB || 'bookstore');
  const marked = [], unmarked = [];
  try {
    const cur = db.collection('pages').aggregate([
      { $sample: { size: 1500 } },
      { $match: { display_photo: { $regex: `^${R2_BASE.replace(/\./g, '\\.')}/` } } },
      { $project: { book_id: 1, page_number: 1, display_photo: 1 } },
    ]).batchSize(1000);
    for await (const p of cur) {
      if (marked.length >= N && unmarked.length >= N) break;
      const key = p.display_photo.slice(R2_BASE.length + 1).split('?')[0];
      let buf;
      try { buf = await readObject(key); } catch { continue; }
      const d = await detectWatermark(buf, { editionId: p.book_id, key: KEY }).catch(() => null);
      if (!d || !(d.pairs >= 16)) continue;
      if (d.present && marked.length < N) marked.push({ ...p, key, buf, z: d.z });
      else if (!d.present && unmarked.length < N) unmarked.push({ ...p, key, buf, z: d.z });
    }
  } finally { await client.close(); }
  console.error(`marked ${marked.length}, unmarked ${unmarked.length}`);
  const otherId = (id) => (id === unmarked[0]?.book_id ? marked[0].book_id : unmarked[0]?.book_id || '000000000000000000000000');
  const rows = [];
  for (const [set, pages] of [['ours (marked)', marked], ['FP: unmarked served images', unmarked]]) {
    for (const t of TREAT) {
      let exif = 0, exifEd = 0, wm = 0, wmReg = 0, wrongEd = 0;
      const zs = [], zr = [];
      for (const p of pages) {
        const copy = await t.f(p.buf);
        const e = await exifEdition(copy);
        if (e) { exif++; if (p.book_id.startsWith(e)) exifEd++; }
        const d = await detectWatermark(copy, { editionId: p.book_id, key: KEY });
        zs.push(d.z); if (d.present) wm++;
        if (t.reg) {
          const back = await register(p.buf, copy);
          const r = await detectWatermark(back, { editionId: p.book_id, key: KEY });
          zr.push(r.z); if (r.present) wmReg++;
        }
        if (t.name === 'byte copy' || t.name.startsWith('EXIF')) {
          const w = await detectWatermark(copy, { editionId: otherId(p.book_id), key: KEY });
          if (w.present) wrongEd++;
        }
      }
      const med = (xs) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null);
      const row = { set, treatment: t.name, n: pages.length, exif, exifEd, wm, wm_med_z: med(zs), wmReg: t.reg ? wmReg : null, reg_med_z: med(zr), wrongEdition: t.name === 'byte copy' || t.name.startsWith('EXIF') ? wrongEd : null };
      rows.push(row);
      console.log(JSON.stringify(row));
    }
  }
  fs.writeFileSync(path.join(OUT, 'images.json'), JSON.stringify(rows, null, 1));
}
main().catch((e) => { console.error(e); process.exit(1); });
