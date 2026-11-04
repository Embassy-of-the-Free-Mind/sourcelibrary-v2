// PRIOR ART: scripts/workers/deepzoom-harvest-page-masters.mjs — harvests `photo_original` rewritten to IIIF /full/full/,
// which on a split scan is the whole SPREAD (see src/lib/gallery-deepzoom-bbox.ts); src/lib/page-image-url.ts getPageSource —
// the reader's choice, but it names a FIELD, and on BPH the fields disagree with what they hold (below). Neither picks the
// page's own leaf at its highest stored resolution, so this does, by geometry and by eye-substitute, never by field name.
/**
 * Pick the image to deep-zoom for a page: the page's OWN leaf, at the highest resolution we hold (#8096).
 *
 * Why a picker and not a field. On BPH, 14,115 illustrated pages carry four different storage shapes, and the field
 * names lie in both directions (measured 2026-11-04):
 *   - old-era split: `cropped_photo` is the half and `archived_photo` the spread … except where `cropped_photo` is a
 *     1200px half while the spread is 4044px wide (cropping the spread by `crop` gives twice the detail), and except
 *     where `cropped_photo` IS the spread (6352×4710) and `archived_photo` the 4225×4710 half.
 *   - new-era split: `photo` is the `sp…` half at 2000px and `archived_photo` the `cropped/…` half at full size.
 * Tiling the wrong one lets a reader zoom into two pages, or into the facing leaf.
 *
 * So: the REFERENCE is the image the reader shows for this page (getPageSource's order), confirmed by the page's own
 * `image_width`/`image_height` (the space gallery bboxes are normalized to). Every stored image, plus a crop of any
 * spread by the page's `crop`, is a candidate; a candidate counts only if its aspect agrees with the reference AND a
 * small grayscale signature correlates with it. The largest survivor wins. Anything ambiguous is refused, never guessed.
 */
import sharp from 'sharp';

const R2_HOST = 'images.sourcelibrary.org';
const ASPECT_TOL = 0.04;
// Pearson r of a 32×48 grayscale signature. Same leaf at another size/JPEG/crop margin: ≥0.95 in the pilot;
// the facing leaf of the same spread is what this must reject, and margin over it is checked separately.
const MIN_CORR = 0.9;
const SIG_W = 32;
const SIG_H = 48;

const usable = (u) => typeof u === 'string' && u.startsWith('https://') && !/archive-failed/i.test(u);
const onR2 = (u) => {
  try {
    return new URL(u).hostname === R2_HOST;
  } catch {
    return false;
  }
};
const aspectOf = (d) => d.width / d.height;
const aspectNear = (a, b) => Math.abs(a - b) / b <= ASPECT_TOL;

/** The reader's source order (src/lib/page-image-url.ts getPageSource), as field names. */
function referenceFields(page) {
  const order = [];
  if (usable(page.cropped_photo)) order.push('cropped_photo');
  if (page.split_from_spread && usable(page.photo)) order.push('photo');
  for (const f of ['archived_photo', 'photo_original', 'photo', 'display_photo']) if (!order.includes(f)) order.push(f);
  return order;
}

function pearson(a, b) {
  const n = a.length;
  let sa = 0, sb = 0;
  for (let i = 0; i < n; i++) { sa += a[i]; sb += b[i]; }
  const ma = sa / n, mb = sb / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma, y = b[i] - mb;
    num += x * y; da += x * x; db += y * y;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

async function signature(buf, region) {
  let s = sharp(buf, { limitInputPixels: false });
  if (region) s = s.extract(region);
  const { data, info } = await s.resize(SIG_W, SIG_H, { fit: 'fill' }).grayscale().raw().toBuffer({ resolveWithObject: true });
  const out = new Float64Array(SIG_W * SIG_H);
  for (let i = 0; i < out.length; i++) out[i] = data[i * info.channels];
  return out;
}

/** The page's `crop` (0–1000 of the spread's width, full height) as a pixel region of a spread image. */
function cropRegion(page, dims) {
  const xs = page.crop?.xStart, xe = page.crop?.xEnd;
  if (![xs, xe].every((v) => typeof v === 'number' && Number.isFinite(v)) || xs < 0 || xe > 1000 || xe <= xs) return null;
  const left = Math.round((xs / 1000) * dims.width);
  const width = Math.min(dims.width - left, Math.round(((xe - xs) / 1000) * dims.width));
  return width > 0 ? { left, top: 0, width, height: dims.height } : null;
}

/**
 * @param {object} page  page doc (image fields, image_width/height, crop, split_from_spread)
 * @param {(url: string) => Promise<Buffer|null>} fetchImage  returns null on any non-200
 * @returns {Promise<{ok: true, field: string, url: string, buf: Buffer, region: object|null, width: number, height: number, corr: number, considered: object[]}
 *                  | {ok: false, reason: string, considered: object[]}>}
 */
export async function chooseOwnLeaf(page, fetchImage) {
  const urls = new Map(); // url -> first field naming it
  for (const f of ['cropped_photo', 'archived_photo', 'photo', 'display_photo', 'photo_original', 'enhanced_photo']) {
    const u = page[f];
    if (usable(u) && onR2(u) && !urls.has(u)) urls.set(u, f);
  }
  // A pre-sized `pages/<book>/<name>.jpg` often has its `-full.jpg` original beside it.
  for (const [u, f] of [...urls]) {
    if (/\/pages\/[^/]+\/[^/]+\.jpg$/.test(u) && !/-(full|thumb)\.jpg$/.test(u)) {
      const sib = u.replace(/\.jpg$/, '-full.jpg');
      if (!urls.has(sib)) urls.set(sib, `${f}~full`);
    }
  }

  const cands = [];
  for (const [url, field] of urls) {
    const buf = await fetchImage(url);
    if (!buf) continue;
    let meta;
    try {
      meta = await sharp(buf, { limitInputPixels: false }).metadata();
    } catch {
      continue;
    }
    if (!meta.width || !meta.height) continue;
    cands.push({ field, url, buf, width: meta.width, height: meta.height, region: null });
  }
  const considered = () => cands.map((c) => ({ field: c.field, w: c.width, h: c.height, region: c.region, corr: c.corr, facing: c.facing }));

  // On a split page, an image at least 1.5× as wide (relative to height) as another stored image is the spread,
  // whatever field holds it: it can only be the reference through a crop. `image_width`/`image_height` then picks
  // among the rest when it agrees with one of them; on old-era pages it still holds the spread's size, so it may not.
  const isSplitFamily = !!(page.split_from_spread || page.cropped_photo || page.crop);
  const isSpread = (c) => isSplitFamily && cands.some((d) => d !== c && aspectOf(c) >= aspectOf(d) * 1.5);
  const pool = cands.filter((c) => !isSpread(c));
  const order = referenceFields(page).map((f) => pool.find((x) => x.field === f)).filter(Boolean);
  const pageAspect = page.image_width > 0 && page.image_height > 0 ? page.image_width / page.image_height : null;
  const ref = (pageAspect && order.find((c) => aspectNear(aspectOf(c), pageAspect))) || order[0];
  if (!ref) return { ok: false, reason: 'no-reference', considered: considered() };
  // A split page with nothing but a landscape image stored: a spread with no half to tell us which side is ours.
  if (isSplitFamily && aspectOf(ref) > 1.2 && pool.length === cands.length && !cands.some((c) => aspectOf(c) < 1)) {
    return { ok: false, reason: 'reference-landscape', considered: considered() };
  }

  // Spreads cropped by the page's own `crop` are candidates too (old-era halves were cut at 1200px).
  for (const c of [...cands]) {
    if (c.region || !(aspectOf(c) > aspectOf(ref) * 1.5)) continue;
    const region = cropRegion(page, c);
    if (!region || !aspectNear(region.width / region.height, aspectOf(ref))) continue;
    cands.push({ ...c, field: `${c.field}+crop`, region, width: region.width, height: region.height });
  }

  const refSig = await signature(ref.buf, null);
  const matched = [];
  for (const c of cands) {
    if (!aspectNear(aspectOf(c), aspectOf(ref))) continue;
    c.corr = c === ref ? 1 : pearson(refSig, await signature(c.buf, c.region));
    if (c.corr >= MIN_CORR) matched.push(c);
  }
  // Margin over the facing leaf: when we cropped a spread, its other side must look less like us than our side does.
  for (const c of matched.filter((m) => m.region)) {
    const full = cands.find((x) => x.url === c.url && !x.region);
    const otherLeft = c.region.left === 0 ? c.region.width : 0;
    const otherW = Math.min(c.region.width, full.width - otherLeft);
    if (otherW <= 0) continue;
    const other = pearson(refSig, await signature(full.buf, { left: otherLeft, top: 0, width: otherW, height: full.height }));
    c.facing = other;
    if (other >= c.corr - 0.05) c.corr = -1; // ambiguous: drop it
  }
  const best = matched
    .filter((c) => c.corr >= MIN_CORR)
    .sort((a, b) => b.width * b.height - a.width * a.height || (a.region ? 1 : 0) - (b.region ? 1 : 0))[0];
  if (!best) return { ok: false, reason: 'no-match', considered: considered() };
  return { ok: true, field: best.field, url: best.url, buf: best.buf, region: best.region, width: best.width, height: best.height, corr: best.corr, refField: ref.field, considered: considered() };
}
