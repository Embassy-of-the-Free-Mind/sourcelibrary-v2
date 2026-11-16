#!/usr/bin/env node
/**
 * PRIOR ART: scripts/audit/image-provenance-coverage.mjs — its robustness row re-encodes a served
 * display the way a copier would (q85/q70/q50, WebP q75) and counts detections; it does not regenerate
 * from the master, record bytes, or let the marker choose its strength for the new encoding, so it
 * cannot price a smaller display. scripts/eval/recovery-matrix-8150/images.mjs is the same row plus
 * crops. scripts/maintenance/backfill-display-marks.mjs is the writer whose recipe this would change.
 *
 * display-reencode-4406 — can the reader's display image be much smaller and still carry the mark?
 *
 * LOCAL ONLY. Reads Mongo and R2 (HTTPS from images.sourcelibrary.org, plus one S3 GET per page to
 * compare the served bytes with the stored ones). Writes nothing to Mongo or R2.
 *
 * The mark and the detector are the repo's own (scripts/lib/provenance-mark.mjs). Nothing here
 * re-implements either. Two families of variant per page:
 *
 *   regen     master -> resize to W -> mark -> encode. markImage() can only emit JPEG, and it picks
 *             the weakest nudge that reads back at z 10 in ITS OWN encoding. So each rung of its
 *             ladder is rendered with markImage({ delta, jpegQuality: 100 }) (its documented tuning
 *             hook), encoded to the target format, read back with detectWatermark(), and the rung is
 *             chosen by markImage's own rule: first rung at z >= 10, else the strongest that detects,
 *             else the weakest. That is what a writer changed to emit WebP or AVIF would produce.
 *   transcode the display as served today -> re-encode at the same width. No master read, no
 *             re-mark; a generation of loss on top of the existing JPEG. The cheap backfill.
 *
 * Also per page: an unmarked copy and a wrong key (negative controls, must not detect), each chosen
 * variant after a JPEG q70 recompress (what a copier does to it), PSNR against the unmarked raster at
 * the same width (a legibility floor, not a perceptual score), and whether the bytes Cloudflare
 * serves are the bytes R2 holds.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/eval/display-reencode-4406/run.mjs \
 *     --out=DIR [--n=40] [--seed=4406] [--concurrency=4] [--save-images=3]
 *   ... --out=DIR --summary          re-print the tables from DIR/results.jsonl
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { MongoClient } from 'mongodb';
import sharp from 'sharp';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { markImage, detectWatermark } from '../../lib/provenance-mark.mjs';
import { READER_DISPLAY_FIELDS, readerServesDisplay } from '../../lib/reader-display.mjs';

const arg = (n, d) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.split('=').slice(1).join('=') : d; };
const has = (n) => process.argv.includes(`--${n}`);
const OUT = arg('out', null);
const N = Number(arg('n', 40));
const SEED = Number(arg('seed', 4406));
const CONCURRENCY = Number(arg('concurrency', 4));
const SAVE_IMAGES = Number(arg('save-images', 0));
if (!OUT) { console.error('--out=DIR is required'); process.exit(2); }

const KEY = process.env.PROVENANCE_SECRET_KEY;
const WRONG_KEY = 'display-reencode-negative-control';
const BUCKET = process.env.R2_BUCKET_NAME || 'sourcelibrary';
const R2_BASE = process.env.R2_PUBLIC_URL || 'https://images.sourcelibrary.org';
const keyOf = (u) => (typeof u === 'string' && u.startsWith(`${R2_BASE}/`) ? u.slice(R2_BASE.length + 1).split('?')[0] : null);
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex').slice(0, 16);

// markImage's own constants (provenance-mark.mjs). Kept in step by the control below: the default
// markImage() call and this ladder at JPEG q82 must agree on z to within noise.
const LADDER = [2, 3, 4, 5, 8];
const NARROW_DELTA = 12, NARROW_BLOCK_PX = 7, GRID = 128, TARGET_Z = 10;

const WIDTHS = [2000, 1600, 1200];
const ENCODERS = {
  'jpeg q85': (i) => i.jpeg({ quality: 85, progressive: true }),
  'jpeg q80': (i) => i.jpeg({ quality: 80, progressive: true }),
  'jpeg q75': (i) => i.jpeg({ quality: 75, progressive: true }),
  'webp q80': (i) => i.webp({ quality: 80 }),
  'webp q75': (i) => i.webp({ quality: 75 }),
  'avif q50': (i) => i.avif({ quality: 50, effort: 4 }),
};
const TRANSCODES = ['jpeg q80', 'jpeg q75', 'webp q80', 'webp q75', 'avif q50'];

// ---- seeded draw -----------------------------------------------------------------------------
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rnd = mulberry32(SEED);
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

const SCRIPT_OF = {
  la: 'Latn', en: 'Latn', de: 'Latn', fr: 'Latn', it: 'Latn', es: 'Latn', nl: 'Latn', pt: 'Latn', pl: 'Latn', cs: 'Latn', sv: 'Latn', da: 'Latn', hu: 'Latn', ca: 'Latn',
  latin: 'Latn', english: 'Latn', german: 'Latn', french: 'Latn', italian: 'Latn', spanish: 'Latn', dutch: 'Latn', portuguese: 'Latn',
  grc: 'Grek', el: 'Grek', greek: 'Grek', 'ancient greek': 'Grek',
  he: 'Hebr', heb: 'Hebr', hebrew: 'Hebr', yi: 'Hebr', arc: 'Hebr', aramaic: 'Hebr',
  ar: 'Arab', arabic: 'Arab', fa: 'Arab', persian: 'Arab', ota: 'Arab', ur: 'Arab',
  zh: 'Hani', lzh: 'Hani', chinese: 'Hani', 'classical chinese': 'Hani', ja: 'Hani', japanese: 'Hani', ko: 'Hani',
  sa: 'Deva', sanskrit: 'Deva', hi: 'Deva', pi: 'Deva', bo: 'Tibt', tibetan: 'Tibt', syr: 'Syrc', syriac: 'Syrc',
  ru: 'Cyrl', cu: 'Cyrl', russian: 'Cyrl',
};
const scriptOf = (b) => b.book_class?.script_family || SCRIPT_OF[String(b.language || '').toLowerCase().trim()] || 'other';
function providerOf(b, page) {
  const named = [b.image_source?.provider, b.provider].find((x) => typeof x === 'string' && x);
  if (named) return named.toLowerCase().slice(0, 24);
  if (b.ia_identifier || /archive\.org/.test(`${page?.photo_original || ''} ${page?.photo || ''}`)) return 'ia';
  return 'unknown';
}

// ---- IO ----------------------------------------------------------------------------------------
const r2 = new S3Client({
  region: 'auto', maxAttempts: 4,
  endpoint: `https://${(process.env.R2_ACCOUNT_ID || '').trim()}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID || '', secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '' },
});
async function r2Object(key) {
  const o = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const chunks = []; for await (const c of o.Body) chunks.push(c);
  return { buf: Buffer.concat(chunks), contentType: o.ContentType, metadata: o.Metadata || {} };
}
// What a browser sends for an <img>. The image host answers by Accept if a transform is on.
const BROWSER = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
  Referer: 'https://sourcelibrary.org/',
};
async function retry(fn, tries = 4) {
  for (let i = 1; ; i++) { try { return await fn(); } catch (e) { if (i >= tries) throw e; await new Promise((r) => setTimeout(r, 3000 * i)); } }
}
const https = (url) => retry(() => httpsOnce(url));
async function httpsOnce(url) {
  const res = await fetch(url, { headers: BROWSER, signal: AbortSignal.timeout(180000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  const h = (n) => res.headers.get(n);
  return { buf: Buffer.from(await res.arrayBuffer()), headers: { 'content-type': h('content-type'), 'cf-cache-status': h('cf-cache-status'), 'cf-polished': h('cf-polished'), 'cf-bgj': h('cf-bgj'), 'content-encoding': h('content-encoding'), vary: h('vary'), 'cache-control': h('cache-control') } };
}

// ---- measures ----------------------------------------------------------------------------------
const detect = (buf, bookId, key = KEY) => detectWatermark(buf, { editionId: bookId, key });
async function psnr(buf, ref) {
  // Green channel, as the mark's own block statistics use. ref: { data, width, height, channels }.
  const { data, info } = await sharp(buf, { failOn: 'none' }).resize(ref.width, ref.height, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let se = 0, n = 0;
  for (let i = 1, j = 1; i < data.length && j < ref.data.length; i += info.channels, j += ref.channels) { const d = data[i] - ref.data[j]; se += d * d; n++; }
  const mse = se / n;
  return mse === 0 ? 99 : Math.round(100 * 10 * Math.log10(65025 / mse)) / 100;
}
const copierQ70 = (buf) => sharp(buf, { failOn: 'none' }).jpeg({ quality: 70 }).toBuffer();

/** One width: every rung, every encoder, then markImage's choice of rung per encoder. */
async function regenAtWidth(master, W, page) {
  const base = await sharp(master, { failOn: 'none' }).resize(W, null, { fit: 'inside', withoutEnlargement: true }).png({ compressionLevel: 1 }).toBuffer();
  const meta = await sharp(base).metadata();
  const ref = await sharp(base).removeAlpha().raw().toBuffer({ resolveWithObject: true }).then(({ data, info }) => ({ data, width: info.width, height: info.height, channels: info.channels }));
  const ladder = Math.floor(meta.width / GRID) < NARROW_BLOCK_PX ? [...LADDER, NARROW_DELTA] : LADDER;
  const ids = { editionId: page.book_id, pageNumber: page.page_number, key: KEY };
  const rungs = {}; // encoder -> [{ delta, buf, z, present, pairs }]
  for (const delta of ladder) {
    const marked = await markImage(base, { ...ids, delta, jpegQuality: 100 });
    for (const [name, enc] of Object.entries(ENCODERS)) {
      const buf = await enc(sharp(marked, { failOn: 'none' }).keepExif()).toBuffer();
      const d = await detect(buf, page.book_id);
      (rungs[name] ||= []).push({ delta, buf, z: d.z, present: d.present, pairs: d.pairs ?? 0 });
    }
  }
  const out = {};
  for (const [name, rs] of Object.entries(rungs)) {
    // markImage's rule: under 16 textured pairs nothing is gained, take the weakest; else the
    // first rung at the target; else the strongest that detects; else the weakest.
    const pick = rs[0].pairs < 16 ? rs[0] : rs.find((r) => r.z >= TARGET_Z) || [...rs].reverse().find((r) => r.present) || rs[0];
    const after = await detect(await copierQ70(pick.buf), page.book_id);
    out[name] = { bytes: pick.buf.length, z: pick.z, present: pick.present, pairs: pick.pairs, delta: pick.delta, z_after_q70: after.z, psnr: await psnr(pick.buf, ref), rungs: rs.map((r) => ({ delta: r.delta, z: r.z, bytes: r.buf.length })), _buf: pick.buf };
  }
  // Controls at this width: the same encodings without a mark, and the marked file under a wrong key.
  const plain = await ENCODERS['jpeg q80'](sharp(base)).toBuffer();
  const controls = { unmarked_z: (await detect(plain, page.book_id)).z, wrong_key_z: (await detect(out['jpeg q80']._buf, page.book_id, WRONG_KEY)).z, unmarked_bytes_jpeg_q80: plain.length };
  return { width: meta.width, height: meta.height, variants: out, controls, base };
}

async function measure(job, cacheDir, imgDir) {
  const { book, page, frame } = job;
  const displayKey = keyOf(page.display_photo);
  const masterUrl = job.masterUrl;
  const served = await https(page.display_photo);
  const stored = await r2Object(displayKey);
  const master = await https(masterUrl);
  fs.writeFileSync(path.join(cacheDir, `${book.id}-${page.page_number}-display.bin`), served.buf);
  fs.writeFileSync(path.join(cacheDir, `${book.id}-${page.page_number}-master.bin`), master.buf);

  const cm = await sharp(served.buf, { failOn: 'none' }).metadata();
  const mm = await sharp(master.buf, { failOn: 'none' }).metadata();
  const cd = await detect(served.buf, book.id);
  const row = {
    book_id: book.id, page_number: page.page_number, frame, provider: job.provider, script: job.script, language: book.language || null,
    display_key: displayKey, master_url: masterUrl,
    master: { bytes: master.buf.length, width: mm.width, height: mm.height, format: mm.format },
    current: {
      bytes: served.buf.length, width: cm.width, height: cm.height, format: cm.format, z: cd.z, present: cd.present, pairs: cd.pairs ?? 0,
      tag: stored.metadata.provenance || stored.metadata.provenance_writer || null,
      z_after_q70: (await detect(await copierQ70(served.buf), book.id)).z,
      served_equals_stored: sha(served.buf) === sha(stored.buf), stored_bytes: stored.buf.length, stored_content_type: stored.contentType, headers: served.headers,
    },
    transcode: {}, regen: {},
  };

  // transcode: the served display, same width, new encoding. Only means something if it is marked.
  for (const name of TRANSCODES) {
    const buf = await ENCODERS[name](sharp(served.buf, { failOn: 'none' }).keepExif()).toBuffer();
    const d = await detect(buf, book.id);
    row.transcode[name] = { bytes: buf.length, z: d.z, present: d.present, z_after_q70: (await detect(await copierQ70(buf), book.id)).z };
  }

  // regen: from the master, at each width. A master narrower than W gives the same image twice; say so.
  const seen = new Map();
  for (const W of WIDTHS) {
    const actual = Math.min(W, mm.width);
    if (seen.has(actual)) { row.regen[W] = { same_as: seen.get(actual) }; continue; }
    seen.set(actual, W);
    const r = await regenAtWidth(master.buf, W, page);
    if (imgDir) {
      fs.writeFileSync(path.join(imgDir, `${book.id}-${page.page_number}-w${W}-unmarked.png`), r.base);
      for (const [name, v] of Object.entries(r.variants)) fs.writeFileSync(path.join(imgDir, `${book.id}-${page.page_number}-w${W}-${name.replace(' ', '-')}.${name.split(' ')[0].replace('jpeg', 'jpg')}`), v._buf);
    }
    for (const v of Object.values(r.variants)) delete v._buf;
    row.regen[W] = { width: r.width, height: r.height, variants: r.variants, controls: r.controls };
  }

  // The writer as it is today (forward path and backfill): 1200px, q85, then markImage() at its default q82.
  const today = await markImage(await sharp(master.buf, { failOn: 'none' }).resize(1200, null, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85, progressive: true }).toBuffer(), { editionId: book.id, pageNumber: page.page_number, key: KEY });
  const td = await detect(today, book.id);
  row.writer_today = { bytes: today.length, z: td.z, present: td.present, pairs: td.pairs ?? 0, z_after_q70: (await detect(await copierQ70(today), book.id)).z };
  return row;
}

// ---- summary -----------------------------------------------------------------------------------
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
const kb = (b) => Math.round(b / 1024);
function resolveRegen(row, W) { const r = row.regen[W]; return r?.same_as ? row.regen[r.same_as] : r; }

function summarise(rows) {
  const variants = [];
  const push = (name, get, from = rows) => {
    const cells = from.map((r) => ({ r, v: get(r) })).filter((c) => c.v);
    if (!cells.length) return;
    // A page with under 16 textured pairs cannot carry the mark in any encoding (blank paper): outside the detection rows.
    const carry = cells.filter((c) => (c.v.pairs ?? c.r.current.pairs) >= 16 || c.v.present);
    const zs = carry.map((c) => c.v.z), z70 = carry.filter((c) => c.v.z_after_q70 != null).map((c) => c.v.z_after_q70);
    const sumV = cells.reduce((s, c) => s + c.v.bytes, 0), sumCur = cells.reduce((s, c) => s + c.r.current.bytes, 0);
    const boot = [];
    const brnd = mulberry32(SEED + 1);
    for (let i = 0; i < 2000; i++) { let a = 0, b = 0; for (let j = 0; j < cells.length; j++) { const c = cells[Math.floor(brnd() * cells.length)]; a += c.v.bytes; b += c.r.current.bytes; } boot.push(a / b); }
    boot.sort((x, y) => x - y);
    variants.push({
      name, n: cells.length, n_carry: carry.length,
      median_kb: kb(median(cells.map((c) => c.v.bytes))), mean_kb: kb(sumV / cells.length),
      ratio_to_current: sumV / sumCur, ratio_lo: boot[50], ratio_hi: boot[1949],
      median_z: median(zs), min_z: zs.length ? Math.min(...zs) : null, detected: carry.filter((c) => c.v.z > 5).length, at_target: carry.filter((c) => c.v.z >= TARGET_Z).length,
      median_z_after_q70: median(z70), min_z_after_q70: z70.length ? Math.min(...z70) : null, detected_after_q70: z70.filter((z) => z > 5).length,
      median_psnr: median(cells.filter((c) => c.v.psnr != null).map((c) => c.v.psnr)),
      median_delta: median(cells.filter((c) => c.v.delta != null).map((c) => c.v.delta)), max_delta_share: cells.filter((c) => c.v.delta != null && c.v.delta >= 8).length,
    });
  };
  push('current display (as served)', (r) => r.current);
  push('writer today: 1200px JPEG q82', (r) => r.writer_today);
  for (const W of WIDTHS) for (const name of Object.keys(ENCODERS)) push(`regen ${W}px ${name}`, (r) => resolveRegen(r, W)?.variants?.[name]);
  const markedRows = rows.filter((r) => r.current.present);
  for (const name of TRANSCODES) push(`transcode ${name} (marked displays only)`, (r) => r.transcode[name] && { ...r.transcode[name], pairs: r.current.pairs }, markedRows);
  return variants;
}

function printSummary(rows) {
  const v = summarise(rows);
  const cur = rows.map((r) => r.current);
  const widths = {};
  for (const c of cur) { const w = c.width >= 1900 ? '>=1900' : c.width >= 1500 ? '1500-1899' : c.width >= 1150 ? '1150-1499' : '<1150'; widths[w] = (widths[w] || 0) + 1; }
  const sample = {
    n: rows.length, current_detected: cur.filter((c) => c.present).length, current_uncarryable: cur.filter((c) => c.pairs < 16 && !c.present).length,
    served_equals_stored: cur.filter((c) => c.served_equals_stored).length,
    current_mean_kb: kb(cur.reduce((s, c) => s + c.bytes, 0) / cur.length), current_median_kb: kb(median(cur.map((c) => c.bytes))),
    master_mean_kb: kb(rows.reduce((s, r) => s + r.master.bytes, 0) / rows.length), master_median_kb: kb(median(rows.map((r) => r.master.bytes))),
    current_widths: widths, master_narrower_than_display: rows.filter((r) => r.master.width < r.current.width * 0.98).length,
    master_under_2000: rows.filter((r) => r.master.width < 2000).length, master_under_1600: rows.filter((r) => r.master.width < 1600).length, master_under_1200: rows.filter((r) => r.master.width < 1200).length,
    display_larger_than_master_bytes: rows.filter((r) => r.current.bytes > r.master.bytes).length,
    polish_header: [...new Set(cur.map((c) => `${c.headers['cf-polished']} | ${c.headers['cf-bgj']}`))], content_types: [...new Set(cur.map((c) => c.headers['content-type']))],
    max_unmarked_z: Math.max(...rows.flatMap((r) => Object.values(r.regen).filter((x) => x.controls).map((x) => x.controls.unmarked_z))),
    max_wrong_key_z: Math.max(...rows.flatMap((r) => Object.values(r.regen).filter((x) => x.controls).map((x) => x.controls.wrong_key_z))),
  };
  console.log(`\nSAMPLE ${JSON.stringify(sample, null, 1)}`);
  console.log('\nvariant'.padEnd(47) + 'n   med KB  mean KB  x current (95%)      med z  min z  >5      >=10   z@q70 med/min   det@q70  PSNR   delta');
  for (const x of v) {
    console.log(x.name.padEnd(46) + String(x.n).padEnd(4) + String(x.median_kb).padStart(6) + String(x.mean_kb).padStart(9) + `  ${x.ratio_to_current.toFixed(3)} (${x.ratio_lo.toFixed(2)}-${x.ratio_hi.toFixed(2)})`.padEnd(22)
      + String(x.median_z?.toFixed(1)).padStart(6) + String(x.min_z?.toFixed(1)).padStart(7) + `  ${x.detected}/${x.n_carry}`.padEnd(9) + `${x.at_target}/${x.n_carry}`.padEnd(7)
      + `${x.median_z_after_q70?.toFixed(1)}/${x.min_z_after_q70?.toFixed(1)}`.padEnd(16) + `${x.detected_after_q70}/${x.n_carry}`.padEnd(9) + String(x.median_psnr?.toFixed(1) ?? '').padEnd(7) + (x.median_delta ?? '') + (x.max_delta_share ? `  (${x.max_delta_share} at delta>=8)` : ''));
  }

  // The marker holds z near its target by turning the nudge up, so z alone hides what an encoding
  // costs. These rows hold the nudge fixed (delta 3) and show the nudge each encoding ends up needing.
  console.log('\nregen: z at a FIXED nudge (delta 3), and the nudge the marker chose');
  console.log('variant'.padEnd(26) + 'med z@3  min z@3   chosen delta 2/3/4/5/8/12   pages below z 10 at any rung');
  const fixed = [];
  for (const W of WIDTHS) for (const name of Object.keys(ENCODERS)) {
    const cells = rows.map((r) => resolveRegen(r, W)?.variants?.[name]).filter((x) => x && x.pairs >= 16);
    const z3 = cells.map((c) => c.rungs.find((g) => g.delta === 3)?.z).filter((z) => z != null);
    const hist = [2, 3, 4, 5, 8, 12].map((d) => cells.filter((c) => c.delta === d).length);
    const short = cells.filter((c) => c.z < TARGET_Z).length;
    fixed.push({ name: `${W}px ${name}`, n: cells.length, median_z_delta3: median(z3), min_z_delta3: Math.min(...z3), delta_hist: hist, below_target: short });
    console.log(`${W}px ${name}`.padEnd(26) + String(median(z3)?.toFixed(1)).padStart(7) + String(Math.min(...z3).toFixed(1)).padStart(9) + `   ${hist.join('/')}`.padEnd(29) + `${short}/${cells.length}`);
  }

  // Byte ratio by frame, and on the pages whose master is at least as wide as the display it would replace.
  console.log('\nbyte ratio to current, by subset (uniform half | spread half | master >= display width | marked displays)');
  const subsets = { uniform: rows.filter((r) => r.frame === 'uniform'), spread: rows.filter((r) => r.frame === 'spread'), like_for_like: rows.filter((r) => r.master.width >= r.current.width * 0.98), marked: rows.filter((r) => r.current.present) };
  const bySubset = {};
  for (const [sn, sr] of Object.entries(subsets)) bySubset[sn] = Object.fromEntries(summarise(sr).map((x) => [x.name, { n: x.n, ratio: x.ratio_to_current, mean_kb: x.mean_kb }]));
  for (const x of v) console.log(x.name.padEnd(46) + Object.keys(subsets).map((sn) => { const c = bySubset[sn][x.name]; return c ? `${c.ratio.toFixed(2)} (n=${c.n})` : '-'; }).join('   '));
  return { sample, variants: v, fixed_delta: fixed, by_subset: bySubset };
}

// ---- main --------------------------------------------------------------------------------------
async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const resultsPath = path.join(OUT, 'results.jsonl');
  if (has('summary')) {
    const rows = fs.readFileSync(resultsPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(printSummary(rows), null, 1));
    return;
  }
  if (!KEY) { console.error('CANNOT MEASURE: PROVENANCE_SECRET_KEY is not set'); process.exit(2); }
  const cacheDir = path.join(OUT, 'cache'); fs.mkdirSync(cacheDir, { recursive: true });
  const imgDir = SAVE_IMAGES ? path.join(OUT, 'images') : null; if (imgDir) fs.mkdirSync(imgDir, { recursive: true });

  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  await retry(() => client.connect());
  const db = client.db(process.env.MONGODB_DB || 'bookstore');
  const live = await retry(() => db.collection('books').find({ visible: true, pages_count: { $gt: 0 } }, { projection: { _id: 0, id: 1, pages_count: 1, language: 1, source: 1, provider: 1, ia_identifier: 1, 'image_source.provider': 1, 'book_class.script_family': 1 } }).toArray());
  live.sort((a, b) => (a.id < b.id ? -1 : 1));
  shuffle(live);
  console.log(`visible books with pages: ${live.length}; seed ${SEED}`);

  const pages = db.collection('pages');
  const projection = { ...READER_DISPLAY_FIELDS, book_id: 1, page_number: 1 };
  const skips = {};
  /** An interior page (front matter lies, eval-design 3.2) whose display the reader loads and whose master is another R2 object. */
  async function eligiblePage(b) {
    for (let t = 0; t < 3; t++) {
      const lo = Math.floor(b.pages_count * 0.15), hi = Math.max(lo + 1, Math.ceil(b.pages_count * 0.95));
      const n = 1 + lo + Math.floor(rnd() * (hi - lo));
      const p = await retry(() => pages.findOne({ book_id: b.id, page_number: n }, { projection }));
      let why = null;
      const dk = p && keyOf(p.display_photo);
      const masterUrl = p && [p.archived_photo, p.photo_original, p.photo].find((u) => keyOf(u) && keyOf(u) !== dk);
      if (!p) why = 'no page doc';
      else if (!dk || !dk.startsWith('pages/')) why = 'display not on R2';
      else if (!readerServesDisplay(p)) why = 'display not served to reader';
      else if (!masterUrl) why = 'no separate master on R2';
      if (!why) return { page: p, masterUrl };
      skips[why] = (skips[why] || 0) + 1;
    }
    return null;
  }

  // Half the sample uniform over books; half one book per (provider x script) cell, cells in turn,
  // so rare scripts and providers are in it. The byte ratio is reported on both.
  const jobs = [];
  let cursor = 0;
  const next1 = async (frame) => {
    while (cursor < live.length) {
      const b = live[cursor++];
      const got = await eligiblePage(b);
      if (got) return { book: b, ...got, frame, script: scriptOf(b), provider: providerOf(b, got.page) };
    }
    return null;
  };
  for (let i = 0; i < Math.floor(N / 2); i++) { const j = await next1('uniform'); if (j) jobs.push(j); }
  const cells = new Map();
  for (const j of jobs) cells.set(`${j.provider}|${j.script}`, (cells.get(`${j.provider}|${j.script}`) || 0) + 1);
  // spread: the next books in the same shuffled order whose cell is not in the sample yet. After 1,200
  // eligible books with no new cell, any book is taken, so the draw always ends.
  for (let scanned = 0; jobs.length < N; scanned++) {
    const j = await next1('spread');
    if (!j) break;
    const cell = `${j.provider}|${j.script}`;
    if (cells.has(cell) && scanned < 1200) continue;
    cells.set(cell, (cells.get(cell) || 0) + 1);
    jobs.push(j);
  }
  await client.close();
  console.log(`drawn ${jobs.length}; skipped pages by reason: ${JSON.stringify(skips)}`);
  console.log(`cells: ${[...cells.entries()].map(([k, v]) => `${k}:${v}`).join('  ')}`);

  fs.writeFileSync(path.join(OUT, 'draw.json'), JSON.stringify({ seed: SEED, n: jobs.length, skips, jobs: jobs.map((j) => ({ book_id: j.book.id, page_number: j.page.page_number, frame: j.frame, provider: j.provider, script: j.script })) }, null, 1));
  fs.writeFileSync(resultsPath, '');
  const rows = [];
  let next = 0, failed = 0, saved = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (next < jobs.length) {
      const job = jobs[next++];
      const t0 = Date.now();
      try {
        const row = await measure(job, cacheDir, saved++ < SAVE_IMAGES ? imgDir : null);
        rows.push(row);
        fs.appendFileSync(resultsPath, JSON.stringify(row) + '\n');
        console.log(`[${rows.length}/${jobs.length}] ${job.book.id} p${job.page.page_number} ${job.provider}/${job.script} current ${kb(row.current.bytes)}KB w${row.current.width} z${row.current.z} master w${row.master.width} ${((Date.now() - t0) / 1000).toFixed(0)}s`);
      } catch (e) {
        failed++;
        fs.appendFileSync(path.join(OUT, 'failed.jsonl'), JSON.stringify({ book_id: job.book.id, page_number: job.page.page_number, error: e.message }) + '\n');
        console.log(`FAILED ${job.book.id} p${job.page.page_number}: ${e.message}`);
      }
    }
  }));
  console.log(`\nmeasured ${rows.length}, failed ${failed}`);
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(printSummary(rows), null, 1));
}

main().catch((e) => { console.error(`CANNOT MEASURE: ${e.stack || e.message}`); process.exit(2); });
