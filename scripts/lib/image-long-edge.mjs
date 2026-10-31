// Fit a page image's long edge to N pixels before a model reads it (#6740 read-surface: the image-size factor).
//
// PRIOR ART: scripts/lib/gutter-clip.mjs and blank-page-guard.mjs resize with sharp for their own measurements and
//   never hand the bytes to a reader; the OCR lanes send the image as served (cli-ocr.mjs, agy-cli.mjs). None makes a
//   smaller copy for the reader and records what was sent.
//
// Never enlarges: an image whose long edge is already ≤ N is returned byte for byte, so "2400" on a 1,800-px scan is the
// served image (the live lane's bytes). A smaller copy is a JPEG at quality 90.
import sharp from 'sharp';

/** @returns {Promise<{buf: Buffer, resized: boolean, native: {w:number,h:number}, sent: {w:number,h:number}}>} */
export async function fitLongEdge(buf, longEdge) {
  const m = await sharp(buf).metadata();
  const native = { w: m.width, h: m.height };
  if (!longEdge || Math.max(m.width, m.height) <= longEdge) return { buf, resized: false, native, sent: native };
  const out = await sharp(buf).resize({ width: longEdge, height: longEdge, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
  const s = await sharp(out).metadata();
  return { buf: out, resized: true, native, sent: { w: s.width, h: s.height } };
}

/**
 * Amendment 6 (#6740), the image-prep factor, from #5250's photometric arms (scripts/eval/ocr-preprocessing/preprocess.py
 * `gray`, `unsharp` sigma 2 amount 1) plus a contrast stretch: luma grayscale, sharp's normalise (1st–99th percentile to
 * full range), unsharp mask sigma 2, JPEG quality 90. `gnu` is the only prep; anything else is refused.
 * @returns {Promise<Buffer>}
 */
export async function prepImage(buf, prep) {
  if (prep !== 'gnu') throw new Error(`image prep ${prep}: only gnu (grayscale + normalise + unsharp)`);
  return sharp(buf).grayscale().normalise().sharpen({ sigma: 2, m1: 1, m2: 1 }).jpeg({ quality: 90 }).toBuffer();
}
