// Plates the essays need and no book supplies, drawn as SVG in the manner of an engraved plate (double-ruled
// border, title in a cartouche, ink and rust) and rasterised by sharp. Every name, figure and date on a plate
// comes from the article's own text. Placed by chapter heading (DIAGRAMS below).
import fs from 'fs';

const INK = '#2b2118', RUST = '#9e4a3a', PAPER = '#fbf7ef', GOLD = '#9e7c3c';
const FONT = `font-family="P052, 'Nimbus Roman', serif"`;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function frame(W: number, H: number, title: string, sub: string, inner: string, ink: string, paper: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <rect width="${W}" height="${H}" fill="${paper}"/>
  <rect x="24" y="24" width="${W - 48}" height="${H - 48}" fill="none" stroke="${ink}" stroke-width="5"/>
  <rect x="36" y="36" width="${W - 72}" height="${H - 72}" fill="none" stroke="${ink}" stroke-width="1.5"/>
  <text x="${W / 2}" y="112" text-anchor="middle" ${FONT} font-size="46" letter-spacing="8" fill="${ink}">${esc(title.toUpperCase())}</text>
  <text x="${W / 2}" y="160" text-anchor="middle" ${FONT} font-size="30" font-style="italic" fill="${ink}">${esc(sub)}</text>
  <line x1="${W / 2 - 120}" y1="190" x2="${W / 2 + 120}" y2="190" stroke="${ink}" stroke-width="2"/>
  ${inner}
</svg>`;
}

/** A small engraved compass rose. */
function rose(x: number, y: number, r: number, ink: string): string {
  const pts = [0, 90, 180, 270].map((a) => {
    const t = a * Math.PI / 180, s = (a + 45) * Math.PI / 180, u = (a - 45) * Math.PI / 180;
    return `<path d="M${x} ${y} L${x + Math.cos(s) * r * 0.22} ${y + Math.sin(s) * r * 0.22} L${x + Math.cos(t) * r} ${y + Math.sin(t) * r} L${x + Math.cos(u) * r * 0.22} ${y + Math.sin(u) * r * 0.22} Z" fill="${a % 180 ? 'none' : ink}" stroke="${ink}" stroke-width="2"/>`;
  }).join('');
  return `<g>${pts}<circle cx="${x}" cy="${y}" r="${r * 0.62}" fill="none" stroke="${ink}" stroke-width="1.2"/><text x="${x}" y="${y - r - 10}" text-anchor="middle" ${FONT} font-size="26" fill="${ink}">N</text></g>`;
}

/** The Sea Road: the ninth-century stages from the Gulf to China, as Sulayman the Merchant (in Ibn al-Faqih)
 *  and Ibn Khordadbeh give them in the essay's second chapter. A strip itinerary, not a map. */
export function seaRoadPlate(bw: boolean): string {
  const ink = bw ? '#000' : INK, rust = bw ? '#000' : RUST, paper = bw ? '#fff' : PAPER;
  const W = 1200, H = 1800;
  const stops: { name: string; modern: string; note?: string; leg?: string }[] = [
    { name: 'al-Ubulla', modern: 'the port of Basra', note: 'musk from Khanfu lands here' },
    { name: 'Siraf', modern: 'on the coast of Fars', note: 'the China ships load here', leg: 'down the Gulf' },
    { name: 'Muscat', modern: 'Oman', note: 'water; then the open sea', leg: 'past the Durdur' },
    { name: 'Kulam Mali', modern: 'Quilon, Malabar coast', note: 'water: 1,000 dirhams a Chinese ship', leg: 'across the sea' },
    { name: 'Islands of the Lanj', modern: 'the Nicobars', note: 'ambergris for iron, by signs' },
    { name: 'Kalah', modern: 'the Malay coast' },
    { name: 'Tiyumah', modern: 'Tioman', note: 'aloeswood and camphor' },
    { name: 'Qumar', modern: 'Khmer', leg: 'five days' },
    { name: 'al-Sanf', modern: 'Champa', note: 'aloeswood that sinks in water', leg: 'three days along the coast' },
    { name: 'Luqin', modern: 'first of the ports of China', note: 'silk, porcelain, rice', leg: 'a hundred parasangs' },
    { name: 'Khanfu', modern: 'Guangzhou', note: 'the largest port', leg: 'four days by sea' },
    { name: 'Khanju', modern: 'further up the coast', leg: 'eight days' },
    { name: 'Qantu', modern: 'further up the coast', leg: 'twenty days' },
  ];
  const top = 270, step = (H - top - 170) / (stops.length - 1), lx = 400;
  let inner = '';
  // The road: a gently waving line through the stations.
  const pts = stops.map((_, i) => [lx + Math.sin(i * 0.9) * 26, top + i * step]);
  inner += `<path d="${pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')}" fill="none" stroke="${rust}" stroke-width="4" stroke-dasharray="14 9"/>`;
  stops.forEach((s, i) => {
    const [x, y] = pts[i];
    if (s.leg && i) {
      const my = y - step / 2;
      inner += `<text x="${x - 34}" y="${my + 8}" text-anchor="end" ${FONT} font-size="25" font-style="italic" fill="${rust}">${esc(s.leg)}</text>`;
    }
    const end = i === 0 || i === stops.length - 1 || s.name === 'Siraf' || s.name === 'Khanfu';
    inner += `<circle cx="${x}" cy="${y}" r="${end ? 13 : 9}" fill="${end ? ink : paper}" stroke="${ink}" stroke-width="3"/>`;
    inner += `<text x="${x + 40}" y="${y - 4}" ${FONT} font-size="${end ? 36 : 32}" letter-spacing="2" fill="${ink}">${esc(s.name.toUpperCase())}</text>`;
    inner += `<text x="${x + 40}" y="${y + 30}" ${FONT} font-size="24" font-style="italic" fill="${ink}">${esc(s.modern)}${s.note ? ` · ${esc(s.note)}` : ''}</text>`;
  });
  inner += rose(170, 380, 70, ink);
  inner += `<text x="${W / 2}" y="${H - 80}" text-anchor="middle" ${FONT} font-size="24" fill="${ink}">From the stages in Ibn al-Faqih (after Sulayman the Merchant) and Ibn Khordadbeh</text>`;
  return frame(W, H, 'The Route to China', 'Siraf to the ports of China, ninth century', inner, ink, paper);
}

type Entry = { who: string; year: number; when: string; lane: string };
type Lane = { id: string; label: string };

/** Hyperborea: where writers put it, by date. Data from the web article's own timeline component, which takes
 *  every entry from the article text. The axis jumps from 200 CE to 1580, as the article's does. */
export function hyperboreaPlate(bw: boolean, componentFile: string): string {
  const src = fs.readFileSync(componentFile, 'utf8');
  const grab = (name: string) => {
    const m = src.match(new RegExp(`const ${name}[^=]*=\\s*(\\[[\\s\\S]*?\\n\\]);`));
    if (!m) throw new Error(`${name} not found in ${componentFile}`);
    return new Function(`return ${m[1]};`)() as unknown[];
  };
  const lanes = grab('LANES') as Lane[], entries = grab('ENTRIES') as Entry[];
  const ink = bw ? '#000' : INK, rust = bw ? '#000' : RUST, paper = bw ? '#fff' : PAPER, gold = bw ? '#000' : GOLD;
  const W = 1200, H = 1800, x0 = 120, x1 = W - 90, top = 250;
  // Two stretches of axis: antiquity (-550…200) and the moderns (1580…1950), with a break between.
  const split = x0 + (x1 - x0) * 0.42;
  const X = (y: number) => y <= 300 ? x0 + (y + 550) / 750 * (split - 30 - x0) : split + 30 + (Math.min(y, 1965) - 1580) / 395 * (x1 - split - 30);
  // Labels packed into sub-rows so none collide: each goes in the first row where it fits; a label that would
  // run off the right edge is set to the left of its mark.
  const CH = 11.5, ROW = 34;
  const packed = lanes.map((l) => {
    const rows: [number, number][][] = [];
    const items = entries.filter((e) => e.lane === l.id).sort((a, b) => a.year - b.year).map((e) => {
      const name = e.who.split(',')[0].split(' (')[0], cx = X(e.year), w = name.length * CH + 16;
      const left = cx + w > x1 + 40;
      const span: [number, number] = left ? [cx - w - 4, cx + 4] : [cx - 4, cx + w];
      let r = rows.findIndex((row) => row.every(([s0, s1]) => span[1] < s0 - 6 || span[0] > s1 + 6));
      if (r < 0) { rows.push([]); r = rows.length - 1; }
      rows[r].push(span);
      return { name, cx, left, r };
    });
    return { l, items, n: Math.max(1, rows.length) };
  });
  const avail = H - top - 230, unit = avail / packed.reduce((t, p) => t + p.n + 1.4, 0);
  let inner = '', y = top;
  for (const { l, items, n } of packed) {
    const h = (n + 1.4) * unit;
    inner += `<text x="${x0}" y="${y + 30}" ${FONT} font-size="27" letter-spacing="1" fill="${rust}">${esc(l.label)}</text>`;
    for (const it of items) {
      const cy = y + 1.25 * unit + it.r * Math.min(unit, ROW) + 6;
      inner += `<circle cx="${it.cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="7" fill="${ink}"/>`;
      inner += it.left
        ? `<text x="${(it.cx - 12).toFixed(1)}" y="${(cy + 7).toFixed(1)}" text-anchor="end" ${FONT} font-size="21" fill="${ink}">${esc(it.name)}</text>`
        : `<text x="${(it.cx + 12).toFixed(1)}" y="${(cy + 7).toFixed(1)}" ${FONT} font-size="21" fill="${ink}">${esc(it.name)}</text>`;
    }
    y += h;
    inner += `<line x1="${x0}" y1="${y - 8}" x2="${x1}" y2="${y - 8}" stroke="${gold}" stroke-width="1"/>`;
  }
  const axisY = y + 30;
  inner += `<line x1="${x0}" y1="${axisY}" x2="${split - 30}" y2="${axisY}" stroke="${ink}" stroke-width="2.5"/><line x1="${split + 30}" y1="${axisY}" x2="${x1}" y2="${axisY}" stroke="${ink}" stroke-width="2.5"/>`;
  inner += `<text x="${split}" y="${axisY + 8}" text-anchor="middle" ${FONT} font-size="30" fill="${ink}">≈</text>`;
  for (const [y, label] of [[-500, '500 BCE'], [-250, '250 BCE'], [1, '1 CE'], [200, '200 CE'], [1600, '1600'], [1700, '1700'], [1800, '1800'], [1900, '1900']] as [number, string][]) {
    inner += `<line x1="${X(y)}" y1="${axisY - 8}" x2="${X(y)}" y2="${axisY + 8}" stroke="${ink}" stroke-width="2"/><text x="${X(y)}" y="${axisY + 42}" text-anchor="middle" ${FONT} font-size="23" fill="${ink}">${label}</text>`;
  }
  inner += `<text x="${W / 2}" y="${H - 80}" text-anchor="middle" ${FONT} font-size="24" fill="${ink}">Each mark is a writer in this book, set where that writer put the Hyperboreans</text>`;
  return frame(W, H, 'Where Hyperborea Was', 'from Pindar to the North Pole', inner, ink, paper);
}

/** Plates by article and chapter heading; each is placed after the chapter's heading (or its opening picture). */
export const DIAGRAMS: Record<string, Record<string, (bw: boolean, root: string) => string>> = {
  'sea-road-china-gulf': { 'The stages from Siraf': (bw) => seaRoadPlate(bw) },
  hyperborea: { "Everyone's Hyperborea": (bw, root) => hyperboreaPlate(bw, `${root}/src/app/articles/hyperborea/HyperboreaTimeline.tsx`) },
};
