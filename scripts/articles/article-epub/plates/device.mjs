// Source Library's printer's device for the article EPUBs: the three rings of the logo as a radiant source inside
// a laurel wreath, the initials S L either side, drawn as SVG in one ink (build.ts tints it like the woodcuts).
// Usage: node plates/device.mjs [MOTTO]  → plates/device.svg   (then render.sh → ornaments/device.png)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const motto = process.argv[2] ?? '';
const W = 800, H = motto ? 960 : 860, cx = 400, cy = 400, K = '#000';
let s = '';
// Rays: an engraver's glory, long and short by turns, each a thin wedge.
for (let i = 0; i < 72; i++) {
  const a = (i * 2 * Math.PI) / 72, r0 = 150, r1 = i % 2 ? 218 : 262, w = i % 2 ? 0.010 : 0.016;
  const p = (r, da) => `${(cx + Math.sin(a + da) * r).toFixed(1)},${(cy - Math.cos(a + da) * r).toFixed(1)}`;
  s += `<path d="M${p(r0, -w)}L${p(r1, 0)}L${p(r0, w)}Z" fill="${K}"/>`;
}
// The rings.
for (const r of [118, 82, 46]) s += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${K}" stroke-width="15"/>`;
// The wreath: two laurel branches rising from a tie at the foot, leaves in pairs with a berry between.
const RX = 318, RY = 330;
for (const side of [-1, 1]) {
  let stem = '';
  for (let j = 0; j <= 30; j++) {
    const t = Math.PI - side * (0.10 + (j / 30) * 2.86), x = cx + Math.sin(t) * RX, y = cy - Math.cos(t) * RY;
    stem += `${j ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
  }
  s += `<path d="${stem}" fill="none" stroke="${K}" stroke-width="4"/>`;
  for (let j = 1; j <= 15; j++) {
    const t = Math.PI - side * (0.10 + (j / 15.6) * 2.86), x = cx + Math.sin(t) * RX, y = cy - Math.cos(t) * RY;
    const tang = Math.atan2(Math.sin(t) * RY, Math.cos(t) * RX) * 180 / Math.PI * 1 ; // direction of travel
    const dir = (Math.atan2(-(-Math.sin(t)) * RY * -side, Math.cos(t) * RX * -side) * 180) / Math.PI;
    const L = 58 - j * 1.1;
    for (const o of [-1, 1]) {
      s += `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${(dir + o * 32).toFixed(1)})"><path d="M0,0C${L * 0.3},${-L * 0.24} ${L * 0.75},${-L * 0.2} ${L},0C${L * 0.75},${L * 0.2} ${L * 0.3},${L * 0.24} 0,0Z" fill="none" stroke="${K}" stroke-width="3.5"/><path d="M${L * 0.12},0L${L * 0.86},0" stroke="${K}" stroke-width="2"/></g>`;
    }
    if (j % 3 === 0) s += `<circle cx="${(x + Math.sin(t) * 26).toFixed(1)}" cy="${(y - Math.cos(t) * 26).toFixed(1)}" r="7" fill="${K}"/>`;
  }
}
// The tie at the foot, and the initials.
s += `<path d="M${cx - 34},${cy + RY - 16}C${cx - 10},${cy + RY + 22} ${cx + 10},${cy + RY + 22} ${cx + 34},${cy + RY - 16}M${cx - 30},${cy + RY + 30}L${cx},${cy + RY + 2}L${cx + 30},${cy + RY + 30}" fill="none" stroke="${K}" stroke-width="5" stroke-linecap="round"/>`;
s += `<text x="${cx - 222}" y="${cy + 30}" text-anchor="middle" font-size="92" fill="${K}" stroke="none">S</text><text x="${cx + 222}" y="${cy + 30}" text-anchor="middle" font-size="92" fill="${K}">L</text>`;
// White ground behind the initials so the rays do not run through them.
const clear = `<circle cx="${cx - 222}" cy="${cy}" r="52" fill="#fff"/><circle cx="${cx + 222}" cy="${cy}" r="52" fill="#fff"/>`;
if (motto) s += `<text x="${cx}" y="${H - 40}" text-anchor="middle" font-size="58" letter-spacing="16" fill="${K}">${motto}</text>`;
fs.writeFileSync(`${HERE}/device${motto ? '-motto' : ''}.svg`, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="'EB Garamond', Garamond, serif"><mask id="m"><rect width="${W}" height="${H}" fill="#fff"/><circle cx="${cx - 222}" cy="${cy}" r="56" fill="#000"/><circle cx="${cx + 222}" cy="${cy}" r="56" fill="#000"/></mask><g mask="url(#m)">${s.split('<text')[0]}</g><text${s.split('<text').slice(1).join('<text')}</svg>`);
