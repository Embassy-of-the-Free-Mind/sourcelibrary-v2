#!/usr/bin/env node
/**
 * Are we serving page masters with holes in them?
 *
 * WHY (#4523)
 * -----------
 * `fetchIiifNativeRes` reconstructs a master by requesting region tiles and
 * compositing them onto a white canvas. It stepped the grid by the size it
 * ASKED for. On a host that silently downscales — the entire reason
 * SILENT_CAP_HOSTS exists — a 2000px cell receives a 1200px image, sharp pastes
 * it at the cell's top-left, and the remaining 800px stays canvas-white. The
 * result is a 3888x2592 JPEG that is 63.5% pure white, with every line of text
 * truncated at a gutter and resuming 800px later.
 *
 * `scripts/maintenance/rearchive-iiif-fullres.mjs` took its stride from the
 * host's ADVERTISED maxWidth (2000 for EAP, which serves 1200) and rewrote both
 * `archived_photo` AND `photo` with the gapped image. Measured 2026-09-01 on a
 * random sample of 392 OCR-bearing Tibetan pages:
 *
 *     tile-gutter signature (55-70% pure white):  119 / 392  = 30.4%
 *                                                 95% CI 25.8 - 34.9%
 *     bimodal: 258 pages <=5% white, 134 >=25%, nothing between
 *     image_metadata.upgraded_at set on broken:   115 / 119
 *     image_metadata.upgraded_at set on clean:      0 / 258
 *     photo_original still present on broken:     118 / 119   (repairable)
 *
 * Nothing downstream can see this. R2 serves a real, complete, 200-OK JPEG;
 * the blank-page guard keys on ink coverage and these pages are dense; and the
 * OCR model reads the fragments as a whole page and invents the rest. The only
 * place it is visible is the pixels, which is what this script looks at.
 *
 * The marker `image_metadata.upgraded_at` identifies the cohort the rearchiver
 * touched, but it is NOT proof of damage — the same script ran correctly on
 * hosts that honour their advertised cap. Measure the pixels, then filter.
 *
 * NEVER WRITES. Re-archiving is a separate, reviewed step.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/audit/tile-stitch-gutters.mjs
 *   node --env-file=.env.production.local scripts/audit/tile-stitch-gutters.mjs \
 *     --language=Tibetan --pages=400 --list
 *   node --env-file=.env.production.local scripts/audit/tile-stitch-gutters.mjs \
 *     --cohort            # only pages carrying image_metadata.upgraded_at
 */
import { MongoClient } from 'mongodb';
import sharp from 'sharp';

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=')[1] ?? d;
const LANGUAGE = arg('language', null);
const NPAGES = parseInt(arg('pages', '200'), 10);
const CONCURRENCY = parseInt(arg('concurrency', '8'), 10);
const COHORT_ONLY = process.argv.includes('--cohort');
const LIST = process.argv.includes('--list');

/**
 * WHAT THE SIGNATURE IS, AND WHAT IT IS NOT
 *
 * The first version of this screen keyed on "lots of pure white" and reported
 * 63.6% of Tibetan pages as broken. That was mostly an artifact: BDRC pecha
 * scans are long thin folios on a white ground (5088x896, 12608x2272 …) and are
 * legitimately 75-96% white. Raw whiteness is a property of the photography.
 *
 * The stitch gutter is a property of the GEOMETRY: a full-span band of canvas
 * running the whole width or height of the image, in the INTERIOR. A folio on a
 * white background has white margins, but they touch the border. A composite
 * with a missing stride has a white stripe through the middle.
 *
 * So: find rows and columns that are >=98% pure white, keep only runs that
 * touch neither edge, and require one at least 32px thick. Confirmed cohort
 * sits at exactly white=0.635 on 3888x2592 — a 1200px payload in a 2000px cell,
 * 1 - 0.6^2 — with interior bands at x[1200,2000) and y[1200,2000).
 */
const WHITE_LEVEL = 250;
const BAND_PURITY = 0.98;
const MIN_BAND_PX = 32;

function interiorBands(profile) {
  const runs = [];
  let start = null;
  for (let i = 0; i < profile.length; i++) {
    if (profile[i] >= BAND_PURITY && start === null) start = i;
    else if (profile[i] < BAND_PURITY && start !== null) { runs.push([start, i]); start = null; }
  }
  if (start !== null) runs.push([start, profile.length]);
  // Border-touching runs are margins, not gutters.
  return runs.filter(([a, b]) => a > 0 && b < profile.length && b - a >= MIN_BAND_PX);
}

async function measure(buf) {
  const { data, info } = await sharp(buf).greyscale().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const colWhite = new Float64Array(width);
  const rowWhite = new Float64Array(height);
  let white = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[y * width + x] >= WHITE_LEVEL) { white++; colWhite[x]++; rowWhite[y]++; }
    }
  }
  for (let x = 0; x < width; x++) colWhite[x] /= height;
  for (let y = 0; y < height; y++) rowWhite[y] /= width;
  const xb = interiorBands(colWhite).map(([a, b]) => ({ axis: 'x', a, b }));
  const yb = interiorBands(rowWhite).map(([a, b]) => ({ axis: 'y', a, b }));
  // BOTH axes. A folio photographed on a white ground can produce one interior
  // band (two leaves stacked with a white strip between them); a missing tile
  // stride produces a grid, so it always shows on both. Requiring both is what
  // separates the gutter cohort from BDRC's legitimately-white pecha scans.
  return {
    white: white / data.length, width, height,
    bands: [...xb, ...yb],
    guttered: xb.length > 0 && yb.length > 0,
  };
}

/** The image the OCR pipeline actually reads — mirrors getPageSource. */
function ocrSource(p) {
  return p.cropped_photo || p.archived_photo || p.photo_original || p.photo || null;
}

async function mapLimit(items, limit, fn) {
  const out = [];
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }));
  return out;
}

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');

// Scoping by book id is only affordable when a language narrows it — an $in of
// every book in the corpus makes the $sample stage pathological.
const match = {};
if (LANGUAGE) {
  const ids = (await db.collection('books')
    .find({ language: LANGUAGE }, { projection: { id: 1 } }).toArray()).map((b) => b.id);
  match.book_id = { $in: ids };
}
if (COHORT_ONLY) match['image_metadata.upgraded_at'] = { $exists: true };

const pages = await db.collection('pages').aggregate([
  { $match: match },
  { $sample: { size: NPAGES } },
  {
    $project: {
      book_id: 1, page_number: 1,
      photo: 1, photo_original: 1, archived_photo: 1, cropped_photo: 1,
      upgraded: '$image_metadata.upgraded_at',
      hasOcr: { $gt: [{ $strLenCP: { $ifNull: [{ $cond: [{ $eq: [{ $type: '$ocr.data' }, 'string'] }, '$ocr.data', ''] }, ''] } }, 20] },
    },
  },
], { allowDiskUse: true }).toArray();

// Metadata for the sampled books only — cheap, and it keeps the $sample above
// from having to carry a corpus-sized $in.
const byId = Object.fromEntries((await db.collection('books')
  .find({ id: { $in: [...new Set(pages.map((p) => p.book_id))] } },
    { projection: { id: 1, title: 1, language: 1, visible: 1 } })
  .toArray()).map((b) => [b.id, b]));

// Everything below is network-bound over minutes; an idle Atlas connection gets
// reset out from under us. Read what we need, then let go of the database.
await client.close();

console.log(`Sampled ${pages.length} pages${LANGUAGE ? ` (${LANGUAGE})` : ''}${COHORT_ONLY ? ' from the upgraded_at cohort' : ''}\n`);

const results = await mapLimit(pages, CONCURRENCY, async (p) => {
  const url = ocrSource(p);
  if (!url) return { ...p, err: 'no-source' };
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'sourcelibrary-audit/1.0' }, signal: AbortSignal.timeout(60_000) });
    if (!res.ok) return { ...p, err: `HTTP ${res.status}` };
    const m = await measure(Buffer.from(await res.arrayBuffer()));
    return { ...p, ...m, host: new URL(url).host };
  } catch (e) {
    return { ...p, err: String(e.message).slice(0, 60) };
  }
});

const ok = results.filter((r) => typeof r.white === 'number');
const errs = results.length - ok.length;
const gutter = ok.filter((r) => r.guttered);

const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(1)}%` : 'n/a');
// Wald interval — good enough at these n, and the point is the order of magnitude.
const p = gutter.length / (ok.length || 1);
const halfWidth = 1.96 * Math.sqrt((p * (1 - p)) / (ok.length || 1));

console.log(`fetched ${ok.length}, errors ${errs}`);
console.log(`GUTTERED (interior full-span white band): ${gutter.length}/${ok.length} = ${pct(gutter.length, ok.length)}`);
console.log(`  95% CI ${pct(Math.max(0, p - halfWidth), 1)} - ${pct(Math.min(1, p + halfWidth), 1)}`);
console.log(`  of those, carrying OCR text: ${gutter.filter((r) => r.hasOcr).length}`);
console.log(`  of those, image_metadata.upgraded_at set: ${gutter.filter((r) => r.upgraded).length}`);
console.log(`  clean pages with upgraded_at set: ${ok.filter((r) => !r.guttered && r.upgraded).length}`);

const byHost = {};
for (const r of ok) {
  byHost[r.host] ||= { n: 0, gutter: 0 };
  byHost[r.host].n++;
  if (r.guttered) byHost[r.host].gutter++;
}
console.log('\nby host of the OCR source:');
for (const [h, v] of Object.entries(byHost).sort((a, b) => b[1].gutter - a[1].gutter)) {
  console.log(`  ${h}: ${v.gutter}/${v.n} guttered (${pct(v.gutter, v.n)})`);
}

const byLang = {};
for (const r of ok) {
  const L = byId[r.book_id]?.language || '(none)';
  byLang[L] ||= { n: 0, gutter: 0 };
  byLang[L].n++;
  if (r.guttered) byLang[L].gutter++;
}
console.log('\nby book language:');
for (const [l, v] of Object.entries(byLang).sort((a, b) => b[1].gutter - a[1].gutter).slice(0, 15)) {
  console.log(`  ${l}: ${v.gutter}/${v.n} guttered (${pct(v.gutter, v.n)})`);
}

if (LIST) {
  console.log('\nguttered pages:');
  for (const r of gutter.sort((a, b) => b.white - a.white).slice(0, 60)) {
    console.log(`  ${(byId[r.book_id]?.title || '?').slice(0, 44).padEnd(44)} p${String(r.page_number).padStart(4)} `
      + `${r.width}x${r.height} white=${r.white.toFixed(3)} bands=${r.bands.map((b) => `${b.axis}[${b.a},${b.b})`).join(',')} `
      + `${r.hasOcr ? 'HAS-OCR' : ''} ${ocrSource(r)}`);
  }
}
