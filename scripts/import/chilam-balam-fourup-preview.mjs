#!/usr/bin/env node
/**
 * The four-up Gates photostats — a preview tool for looking at one frame, and
 * the record of how their page order was worked out. Calkiní is imported (see
 * `chilam-balam-calkini-byu.mjs`); Tizimín is not, and the reason is below.
 *
 * ## What these records are
 *
 * BYU, MSS 279 (William Gates papers), ContentDM p15999coll16:
 *
 *   record 138175  Chilam Balam of Calkiní   8 frames, catalogued 24 p.
 *   record 85910   Chilam Balam de Tizimín  19 frames, catalogued 76 p.
 *
 * Both are photostat NEGATIVES on which each frame carries FOUR manuscript pages
 * in a 2x2 grid, the upper row rotated 180 degrees. Imported frame-per-page they
 * would produce eight- and nineteen-page "books" of unreadable four-up negative,
 * and nothing downstream would notice: the images fetch, the pages render, the
 * counts look plausible.
 *
 * **The tell is in the catalogue, and it is arithmetic.** 76 catalogued pages
 * against 19 frames is exactly 4x; 24 against 8 is 3x (Calkiní's last frame is
 * short). A `physic` count that is a small integer multiple of the frame count
 * is a multi-up sheet announcing itself. `chilam-balam-gates-byu.mjs` checks its
 * frame counts against a manifest for this reason, and that check is what turned
 * Tizimín up — it was in that manifest as an ordinary negative until the count
 * refused it.
 *
 * ## What is established
 *
 * Run this and look at the output: quarter the frame, trim the mount, rotate the
 * top row 180 degrees, invert. The panels come out as clean, fully legible
 * positive pages — Tizimín frame 5 top-left is a leaf dating itself "hum pis kin
 * Febrero 1522 haab"; Calkiní frame 3 top-left is page 59, naming Calkiní and
 * its batabs. The geometry is not in doubt.
 *
 * The leaves carry their OWN page numbers, in the foliation of the parent
 * manuscript rather than of this photostat: Calkiní's seven usable frames cover
 * pages 55-66 plus an unnumbered colophon leaf signed and dated "noviembre de
 * 1821". So the numbers needed to order the book are right there on the images.
 *
 * ## Calkiní is DONE — see chilam-balam-calkini-byu.mjs
 *
 * Its page order was read off the leaves and the book is imported. The rule that
 * came out of it, which this file exists to hand on:
 *
 *  - Each COLUMN of a four-up frame is one leaf, recto above verso. The recto
 *    carries its number at the top RIGHT and the verso the SAME number at the
 *    top LEFT — ordinary foliation, and it held on all twelve leaves.
 *  - The left column runs TL (recto) then BL (verso); the right column runs the
 *    other way, BR then TR, because the top row was laid head-down.
 *  - The FRAMES are not in page order and no layout rule would have got it
 *    right: frame 1 holds leaves 58 and 55, frame 3 holds 59 and 62, frame 4
 *    holds 61 and 60. Two frames alone would have supported a confident, wrong
 *    rule — both frame 3 and Tizimín frame 5 give a clean ascending span of four.
 *  - Confirmed by TEXT as well as by number: leaf 59's recto ends "…cate molah
 *    uba" and its verso opens "Batabob…"; leaf 55's verso ends "y cabe thoxbil"
 *    and leaf 56's recto opens "thoxbil - tu chi cahun…", the scribe's catchword
 *    carrying across two different sheets.
 *  - The twelve leaves came out 55-66, each exactly once, which is the "24 p."
 *    on BYU's record. That agreement is the check: a misread number shows up as
 *    a gap or a duplicate rather than as a quietly scrambled book.
 *  - AND THE LAST SHEET WAS NOT FOUR-UP AT ALL. Frame 7 holds two full-width
 *    pages stacked upright; quartering it produced four half-pages whose lines
 *    ended mid-word ("…Ah calkiniob J" | "uan de Dios Yuc…"). Caught only by
 *    reading the output. The layout of a sheet is a property of the sheet.
 *
 * ## Tizimín is NOT done, and the blocker is different
 *
 * Its geometry is the same and the split works — frame 5's top-left is a leaf
 * dating itself "hum pis kin Febrero 1522 haab". But its foliation is SPARSE:
 * across frames 1-4 only four leaves carry a legible number (3, 2, 7, 6), and
 * the frames are no more in order than Calkiní's. Thirty-eight leaves cannot be
 * ordered from a handful of anchors, and the first sheet's right-hand column is
 * not manuscript at all but a Spanish donation inscription ("Obsequio de este
 * libro… Manuel Ximenez Perez").
 *
 * **The way to finish it** is the pipeline's own: split all 19 frames, import to
 * a hidden book in frame order, OCR (the prompt already emits `<page-num>`), and
 * reorder by what the model reads off each leaf. That is an OCR pass over 76
 * pages, which costs money and has not been run unasked.
 *
 * ## One more thing this turned up
 *
 * Calkiní's compound object lists EIGHT frames and the eighth (pointer 138174)
 * is a 404 from ContentDM. Seven usable frames, not eight. An importer that
 * trusted the object listing would have inserted a page pointing at nothing.
 *
 *   node scripts/import/chilam-balam-fourup-preview.mjs --record=85910 --frame=5 --out=/tmp/x
 */
import sharp from 'sharp';
import { writeFile, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const HOST = 'https://contentdm.lib.byu.edu';
const COLL = 'p15999coll16';
const api = (q) => `${HOST}/digital/bl/dmwebservices/index.php?q=${q}/json`;

async function j(u) {
  const r = await fetch(u, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`${r.status} ${u}`);
  return r.json();
}
function collectPages(node, out = []) {
  if (Array.isArray(node)) { for (const v of node) collectPages(v, out); return out; }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (k === 'page') { for (const p of (Array.isArray(v) ? v : [v])) out.push(p); }
      else collectPages(v, out);
    }
  }
  return out;
}

/**
 * The four panels of one frame, in the COLUMN-WISE order the text continuity
 * shows (TL, BL, TR, BR). `rotate` is 180 for the upper row.
 */
export const QUADRANTS = [
  { name: 'TL', col: 0, row: 0, rotate: 180 },
  { name: 'BL', col: 0, row: 1, rotate: 0 },
  { name: 'TR', col: 1, row: 0, rotate: 180 },
  { name: 'BR', col: 1, row: 1, rotate: 0 },
];

/** Split one four-up negative frame into four upright, positive page images. */
export async function splitFourUp(frameBuffer) {
  const m = await sharp(frameBuffer).metadata();
  const hw = Math.floor(m.width / 2);
  const hh = Math.floor(m.height / 2);
  const out = [];
  for (const q of QUADRANTS) {
    let img = sharp(frameBuffer).extract({ left: q.col * hw, top: q.row * hh, width: hw, height: hh });
    // The panels sit inset in a near-black mount. Trim BEFORE inverting, while
    // the border is still the uniform dark that `trim` can find.
    img = sharp(await img.toBuffer()).trim({ threshold: 25 });
    if (q.rotate) img = img.rotate(q.rotate);
    out.push({ name: q.name, buffer: await img.negate().jpeg({ quality: 90 }).toBuffer() });
  }
  return out;
}

// CLI. Guarded so the helpers above can be imported by other scripts — the
// first version ran this on import and any importer got a usage error instead of
// a module.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (n) => (process.argv.find((a) => a.startsWith(`--${n}=`)) || '').split('=').slice(1).join('=');
  const RECORD = arg('record') || '85910';
  const FRAME = Number(arg('frame') || 1);
  const OUT = arg('out');
  if (!OUT) { console.error('usage: --record=<id> --frame=<n> --out=<dir>'); process.exit(2); }

  const pages = collectPages(await j(api(`dmGetCompoundObjectInfo/${COLL}/${RECORD}`)));
  const p = pages[FRAME - 1];
  if (!p) { console.error(`Record ${RECORD} has ${pages.length} frames; no frame ${FRAME}.`); process.exit(1); }
  console.log(`record ${RECORD}: ${pages.length} frames; previewing frame ${FRAME}`);

  const r = await fetch(`${HOST}/digital/iiif/${COLL}/${p.pageptr}/full/full/0/default.jpg`, { signal: AbortSignal.timeout(90000) });
  if (!r.ok) { console.error(`frame fetch ${r.status}`); process.exit(1); }
  const buf = Buffer.from(await r.arrayBuffer());

  await mkdir(OUT, { recursive: true });
  const panels = await splitFourUp(buf);
  for (const [i, panel] of panels.entries()) {
    const f = `${OUT}/${RECORD}-f${FRAME}-${i + 1}-${panel.name}.jpg`;
    await writeFile(f, panel.buffer);
    const m = await sharp(panel.buffer).metadata();
    console.log(`  ${i + 1}. ${panel.name} ${m.width}x${m.height} -> ${f}`);
  }
  console.log('Reading order above is the column-wise one (TL, BL, TR, BR). Absolute page numbers are NOT established — see this file\'s header before importing anything.');
}
