// Flip book of the circles→universe→eye warp reel: every GIF frame becomes a
// business-card-sized card (8 per US-Letter sheet, cut lines included). Stack
// in order, binder-clip the left strip, flip the right edge. Long holds in the
// GIF (the universe beat, the final eye) are duplicated onto extra cards so the
// pacing survives on paper. Card 1 is a title card (the resting view).
import sharp from 'sharp';
import PDFDocument from 'pdfkit';
import { createWriteStream, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = '/Users/jdietz/Documents/GitHub/dev/sourcelibrary-v2';
const GIF = join(ROOT, 'esoteric-geometries-out/esoteric-geometries-circles-universe.gif');
const OUT = join(ROOT, 'esoteric-geometries-out/esoteric-geometries-flipbook.pdf');

// ---- pull frames + delays from the GIF ----
const meta = await sharp(GIF, { animated: true }).metadata();
const delays = meta.delay; // per-frame, ms
console.log(`GIF: ${meta.pages} frames`);
const frames = []; // { png, n } in flip order
for (let p = 0; p < meta.pages; p++) {
  const png = await sharp(GIF, { page: p }).png().toBuffer();
  const dup = Math.max(1, Math.min(4, Math.round((delays[p] || 60) / 70)));
  for (let d = 0; d < dup; d++) frames.push(png);
}
console.log(`Cards after hold-duplication: ${frames.length}`);

// ---- geometry (points) ----
const PAGE_W = 612, PAGE_H = 792;
const COLS = 2, ROWS = 4;
const CARD_W = 288, CARD_H = 189; // 4" x 2.625"
const GRID_W = COLS * CARD_W, GRID_H = ROWS * CARD_H;
const MX = (PAGE_W - GRID_W) / 2, MY = (PAGE_H - GRID_H) / 2;
const IMG = CARD_H; // square image fills card height, right-aligned
const STRIP = CARD_W - IMG; // left binding strip
const CREAM = '#f6f1e7', INK = '#2b241c', FADED = '#9a9083', LINE = '#c9c0af';

const doc = new PDFDocument({ size: 'LETTER', margin: 0, autoFirstPage: false, info: {
  Title: 'Esoteric Geometries — Flip Book', Author: 'Source Library',
} });
doc.pipe(createWriteStream(OUT));

// ---- instructions page ----
{
  doc.addPage();
  doc.rect(0, 0, PAGE_W, PAGE_H).fill(CREAM);
  doc.font('Times-Roman').fontSize(24).fillColor(INK)
    .text('Esoteric Geometries — a flip book', 72, 90, { width: PAGE_W - 144 });
  doc.font('Times-Roman').fontSize(12).moveDown(1).text(
    'Nineteen circular plates from seven centuries — alchemical cosmograms, astronomical volvelles, ' +
    'Tibetan mandalas — spin past, the Fludd Microcosmus man twists into a vortex, the vortex becomes ' +
    'the observable universe, and the universe opens into the Eye of Providence.',
    72, undefined, { width: PAGE_W - 144, lineGap: 3 });
  doc.font('Times-Bold').fontSize(13).moveDown(1.5).text('To build it:', 72, undefined);
  doc.font('Times-Roman').fontSize(12);
  const steps = [
    '1.  Print single-sided at actual size (no scaling).',
    '2.  Cut along the gray lines — 8 cards per sheet.',
    '3.  Stack in numbered order, card 1 on top.',
    '4.  Clamp the left strip with a binder clip (or staple twice).',
    '5.  Thumb the right edge and let it rip.',
  ];
  for (const s of steps) doc.moveDown(0.4).text(s, 90, undefined, { width: PAGE_W - 180 });
  doc.font('Times-Italic').fontSize(11).moveDown(1.5)
    .text('Every image is from a real book you can read at sourcelibrary.org — the full citation list travels with the animated version at sourcelibrary.org/gallery.', 72, undefined, { width: PAGE_W - 144, lineGap: 3 });
  doc.font('Helvetica').fontSize(8).fillColor(FADED)
    .text('SOURCE LIBRARY · ' + new Date().toISOString().slice(0, 10), 72, PAGE_H - 60);
}

// ---- title card image (card 1, the resting view) ----
const S = 600;
const titleCard = await sharp({ create: { width: S, height: S, channels: 3, background: { r: 26, g: 22, b: 18 } } })
  .composite([{
    input: Buffer.from(`<svg width="${S}" height="${S}">
      <circle cx="300" cy="252" r="150" fill="none" stroke="#f0e9da" stroke-width="3"/>
      <circle cx="300" cy="252" r="108" fill="none" stroke="#f0e9da" stroke-width="2.2"/>
      <circle cx="300" cy="252" r="66" fill="none" stroke="#f0e9da" stroke-width="1.6"/>
      <text x="300" y="470" font-family="Georgia, serif" font-size="34" fill="#f0e9da" text-anchor="middle">ESOTERIC GEOMETRIES</text>
      <text x="300" y="516" font-family="Georgia, serif" font-size="20" font-style="italic" fill="#b9ad98" text-anchor="middle">flip me</text>
      <text x="300" y="566" font-family="Helvetica, sans-serif" font-size="15" fill="#8a7f6c" text-anchor="middle" letter-spacing="2">SOURCELIBRARY.ORG</text>
    </svg>`),
  }]).png().toBuffer();
const cards = [titleCard, ...frames];
console.log(`Total cards incl. title: ${cards.length} -> ${Math.ceil(cards.length / (COLS * ROWS))} sheets`);

// ---- card sheets ----
for (let i = 0; i < cards.length; i += COLS * ROWS) {
  doc.addPage();
  doc.rect(0, 0, PAGE_W, PAGE_H).fill('#ffffff');
  const batch = cards.slice(i, i + COLS * ROWS);
  for (let j = 0; j < batch.length; j++) {
    const col = j % COLS, row = Math.floor(j / COLS);
    const x = MX + col * CARD_W, y = MY + row * CARD_H;
    const n = i + j; // 0 = title card
    // image right-aligned on the card (motion lives at the flip edge)
    doc.image(batch[j], x + STRIP, y, { width: IMG, height: IMG });
    // binding strip: number + wordmark, rotated
    doc.save();
    doc.rotate(-90, { origin: [x + STRIP / 2, y + CARD_H / 2] });
    doc.font('Helvetica').fontSize(7).fillColor(FADED)
      .text(n === 0 ? 'COVER' : `No. ${String(n).padStart(3, '0')}`,
        x + STRIP / 2 - CARD_H / 2, y + CARD_H / 2 - 24, { width: CARD_H, align: 'center' });
    doc.fontSize(5.5)
      .text('SOURCE LIBRARY', x + STRIP / 2 - CARD_H / 2, y + CARD_H / 2 + 8, { width: CARD_H, align: 'center', characterSpacing: 1 });
    doc.restore();
  }
  // cut lines across the whole grid
  doc.lineWidth(0.4).strokeColor(LINE);
  for (let c = 0; c <= COLS; c++) doc.moveTo(MX + c * CARD_W, MY - 8).lineTo(MX + c * CARD_W, MY + GRID_H + 8).stroke();
  for (let r = 0; r <= ROWS; r++) doc.moveTo(MX - 8, MY + r * CARD_H).lineTo(MX + GRID_W + 8, MY + r * CARD_H).stroke();
}

doc.end();
await new Promise(res => doc.on('end', res));
await new Promise(res => setTimeout(res, 400));
console.log('wrote', OUT);
