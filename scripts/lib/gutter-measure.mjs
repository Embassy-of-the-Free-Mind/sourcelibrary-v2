/**
 * The tile-stitch gutter signature, as a measurement (#4523 / #4534).
 *
 * Extracted verbatim from scripts/audit/tile-stitch-gutters.mjs so the AUDIT
 * (read-only detector) and the REPAIR (scripts/maintenance/repair-tibetan-gutters.mjs)
 * judge pages with the SAME instrument — a repair whose success criterion is a
 * different measurement than its selection rule can "fix" pages into a state
 * its own detector still flags, or vice versa.
 *
 * What the signature is: a composite whose stride exceeded its payload leaves
 * full-span bands of canvas-white through the INTERIOR of the image, on BOTH
 * axes, hundreds of pixels thick. Raw whiteness is NOT the signature — BDRC
 * pecha scans are legitimately 75–96% white (photography, not damage). See the
 * audit script's header for the incident numbers and false-positive analysis.
 */
import sharp from 'sharp';

export const WHITE_LEVEL = 250;
export const BAND_PURITY = 0.98;
export const MIN_BAND_PX = 200;

export function interiorBands(profile) {
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

export async function measure(buf) {
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
  // BOTH axes: a missing tile stride produces a grid, so it always shows on
  // both; a folio on a white ground shows at most one. This is what separates
  // the gutter cohort from legitimately-white pecha scans.
  return {
    white: white / data.length, width, height,
    bands: [...xb, ...yb],
    guttered: xb.length > 0 && yb.length > 0,
  };
}
