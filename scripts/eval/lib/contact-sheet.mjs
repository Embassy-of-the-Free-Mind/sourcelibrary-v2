// PRIOR ART: scripts/eval/contact-sheet-screen.mjs (#5009) — this IS its grid builder, moved
// here unchanged so book-class-5768 can reuse it instead of rebuilding one; that script imports it.
//
// contact-sheet — tile page images into one JPEG grid, numbered left-to-right, top-to-bottom.
import sharp from 'sharp';

/**
 * @param {object[]} pages  page docs; each tile is `archived_photo || photo` unless `urlOf` says otherwise
 * @param {{ perSheet: number, cellPx: number, urlOf?: (p: object) => string|null }} o
 * @returns {Promise<Buffer>} the sheet; a page whose image fails to load is a blank white cell, and the
 *   returned Buffer carries `failedTiles` (how many) so a caller can refuse a mostly-blank sheet —
 *   a model asked about a white grid still answers.
 */
export async function sheetFor(pages, { perSheet, cellPx, urlOf = (p) => p.archived_photo || p.photo }) {
  const cols = Math.ceil(Math.sqrt(perSheet));
  const rows = Math.ceil(pages.length / cols);
  const tiles = [];
  for (let i = 0; i < pages.length; i++) {
    const url = urlOf(pages[i]);
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(60000) });
      if (!r.ok) { tiles.push(null); continue; }
      const buf = Buffer.from(await r.arrayBuffer());
      tiles.push(await sharp(buf).resize(cellPx, cellPx, { fit: 'contain', background: '#fff' }).jpeg({ quality: 78 }).toBuffer());
    } catch { tiles.push(null); }
  }
  const blank = await sharp({ create: { width: cellPx, height: cellPx, channels: 3, background: '#fff' } }).jpeg().toBuffer();
  const composites = tiles.map((t, i) => ({
    input: t || blank, left: (i % cols) * cellPx, top: Math.floor(i / cols) * cellPx,
  }));
  const sheet = await sharp({ create: { width: cols * cellPx, height: rows * cellPx, channels: 3, background: '#fff' } })
    .composite(composites).jpeg({ quality: 80 }).toBuffer();
  sheet.failedTiles = tiles.filter((t) => !t).length;
  return sheet;
}
