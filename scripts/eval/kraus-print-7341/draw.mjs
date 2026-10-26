#!/usr/bin/env node
// PRIOR ART: scripts/eval/arabic-mss-gate-7341/draw.mjs — the gate's draw (seeded mulberry32 shuffle of a book's inner
// pages, first K downloaded from R2, contact sheets for a by-eye screen). It draws 2–4 pages per book from 14 books and
// skips the first/last 5%; this follow-up draws 25 pages from ONE book (Kraus 1935) over the WHOLE book, one per equal
// stratum so apparatus, later extracts and the end of the volume are all in, excluding the gate's pages and the anchor.
/**
 * Kraus 1935 print draw, 25 pages (#7341). Pages 1..582 are cut into 25 equal strata; each stratum's pages are shuffled
 * (seed 7341 ^ stratum) and the first 3 candidates downloaded to $JOB_SCRATCH/img/ with one labelled contact sheet per
 * 5 strata. The by-eye screen (finalize-draw.mjs) takes each stratum's first candidate that is a text page.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/kraus-print-7341/draw.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { MongoClient } from 'mongodb';

const BOOK = '6ade30b13326a0839b2d1c42';  // Kraus, Mukhtār rasāʾil Jābir ibn Ḥayyān, Cairo 1935
const SEED = 7341, STRATA = 25, K = 3;
// the gate's 4 pages and its blank skip (arabic-mss-gate-7341/finalize-draw.mjs), and the anchor passage pp.20–22 = images 30–32
const EXCLUDE = new Set([385, 231, 158, 320, 106, 30, 31, 32]);
const ROOT = process.env.JOB_SCRATCH;
if (!ROOT) throw new Error('JOB_SCRATCH not set');
for (const d of ['img', 'sheets']) fs.mkdirSync(path.join(ROOT, d), { recursive: true });

function rng(seed) {  // mulberry32, as the gate's draw
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const c = await MongoClient.connect(process.env.MONGODB_URI);
const db = c.db('bookstore');
const { pages_count: N } = await db.collection('books').findOne({ id: BOOK }, { projection: { pages_count: 1 } });
const strata = [];
for (let s = 0; s < STRATA; s++) {
  const lo = Math.floor((s * N) / STRATA) + 1, hi = Math.floor(((s + 1) * N) / STRATA);
  const pool = []; for (let p = lo; p <= hi; p++) if (!EXCLUDE.has(p)) pool.push(p);
  const r = rng(SEED ^ (s + 1));
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const cands = [];
  for (const pn of pool.slice(0, K)) {
    const pg = await db.collection('pages').findOne({ book_id: BOOK, page_number: pn }, { projection: { archived_photo: 1 } });
    const file = path.join(ROOT, 'img', `${BOOK}_${pn}.jpg`);
    if (!fs.existsSync(file)) {
      const res = await fetch(pg.archived_photo);
      if (!res.ok) throw new Error(`${pg.archived_photo} ${res.status}`);
      fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    }
    const m = await sharp(file).metadata();
    cands.push({ page: pn, url: pg.archived_photo, w: m.width, h: m.height });
  }
  strata.push({ stratum: s + 1, lo, hi, candidates: cands });
  console.log(`s${s + 1} [${lo}-${hi}]`, cands.map((x) => `${x.page}(${x.w}x${x.h})`).join(' '));
}
await c.close();

// contact sheets: 5 strata x 3 candidates, 600 px high, each tile labelled s<stratum> p<page>
const H = 600;
for (let g = 0; g < STRATA; g += 5) {
  const rows = [];
  for (const st of strata.slice(g, g + 5)) {
    const tiles = [];
    for (const x of st.candidates) {
      const t = await sharp(path.join(ROOT, 'img', `${BOOK}_${x.page}.jpg`)).resize({ height: H }).toBuffer({ resolveWithObject: true });
      const label = Buffer.from(`<svg width="${t.info.width}" height="40"><rect width="100%" height="40" fill="yellow"/><text x="8" y="30" font-size="28" font-family="sans-serif">s${st.stratum} p${x.page}</text></svg>`);
      tiles.push({ buf: await sharp(t.data).composite([{ input: label, left: 0, top: 0 }]).toBuffer(), w: t.info.width });
    }
    rows.push(tiles);
  }
  const W = Math.max(...rows.map((r) => r.reduce((s, t) => s + t.w + 10, 0)));
  const comp = []; rows.forEach((r, i) => { let x = 0; for (const t of r) { comp.push({ input: t.buf, left: x, top: i * (H + 10) }); x += t.w + 10; } });
  await sharp({ create: { width: W, height: rows.length * (H + 10), channels: 3, background: '#888' } }).composite(comp).jpeg({ quality: 80 }).toFile(path.join(ROOT, 'sheets', `strata-${g + 1}-${g + 5}.jpg`));
}
fs.writeFileSync(path.join(ROOT, 'candidates.json'), JSON.stringify({ book_id: BOOK, seed: SEED, strata: STRATA, k: K, exclude: [...EXCLUDE],
  rule: `pages 1..${N} in ${STRATA} equal strata; each shuffled (mulberry32, seed ${SEED} ^ stratum); first ${K}; screened by eye`, strata }, null, 1));
