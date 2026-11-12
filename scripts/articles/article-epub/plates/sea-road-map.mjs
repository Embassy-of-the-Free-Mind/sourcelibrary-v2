// The Sea Road route map, in two sheets (west: the Gulf to Malabar; east: Ceylon to China), drawn as SVG in an
// engraved manner from the repo's own coastline file (public/geo-countries-110m.json). Places are the ones the
// essay names, at their modern positions; the numbered key is typeset in the book (plates.json), not in the
// picture, so it stays readable on a phone.
// Usage: node plates/sea-road-map.mjs   → plates/sea-road-west.svg, plates/sea-road-east.svg  (then render.sh)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const topo = JSON.parse(fs.readFileSync(path.resolve(HERE, '../../../../public/geo-countries-110m.json'), 'utf8'));

// GeoJSON countries → rings of [lon, lat].
const rings = [];
for (const f of topo.features) {
  const g = f.geometry;
  if (g.type === 'Polygon') rings.push(...g.coordinates);
  else if (g.type === 'MultiPolygon') for (const poly of g.coordinates) rings.push(...poly);
}

const INK = '#3a2c20', PAPER = '#f7f0e0', LAND = '#efe2c4', RUST = '#9e4a3a', GOLD = '#9e7c3c';
const W = 1400, H = 1300, M = 46; // M: the margin outside the neat line

// Sea waypoints of the road, west to east, and the numbered places on it.
const ROUTE = [[48.6, 29.9], [50.2, 28.6], [52.2, 27.2], [54.5, 26.2], [56.4, 26.5], [57.6, 25.4], [59.3, 23.9], [62.6, 20.8], [68, 14.5], [73.5, 10], [76.2, 8.6],
  [77.6, 7.2], [80, 5.4], [82.2, 5.8], [88, 7], [93.3, 7.4], [95.1, 6.1], [97.8, 5.2], [100.4, 3.2], [102.1, 1.9], [103.6, 1.0], [104.6, 1.6], [104.5, 2.9], [105.5, 5.5], [106.9, 8.4],
  [109.9, 11.5], [110.1, 14.2], [111.5, 18], [113.6, 21.6], [113.7, 22.4], [115.5, 22], [118, 23.6], [118.8, 24.6]];
export const PLACES = [
  { n: 1, name: 'Basra and its port al-Ubulla', at: [47.9, 30.4], d: [-1, -1] },
  { n: 2, name: 'Siraf', at: [52.3, 27.65], d: [1, -1] },
  { n: 3, name: 'Hormuz', at: [56.45, 27.05], d: [1, -1] },
  { n: 4, name: 'Muscat', at: [58.55, 23.6], d: [-1, 1] },
  { n: 5, name: 'Calicut', at: [75.8, 11.25], d: [1, -0.4] },
  { n: 6, name: 'Quilon (Kulam Mali, Mo-lai)', at: [76.6, 8.9], d: [-1, 0.9] },
  { n: 7, name: 'Ceylon', at: [80.7, 7.6], d: [1, -1] },
  { n: 8, name: 'The Nicobar Islands', at: [93.6, 8.0], d: [-0.3, -1.2] },
  { n: 9, name: 'Lambri (Lan-li), northern Sumatra', at: [95.4, 5.5], d: [-1, 1] },
  { n: 10, name: 'Malacca', at: [102.25, 2.2], d: [0.75, -1.25] },
  { n: 11, name: 'Tioman', at: [104.15, 2.8], d: [1.15, 0.5] },
  { n: 12, name: 'Pulo Condore', at: [106.6, 8.7], d: [-1.1, 0.2] },
  { n: 13, name: 'Champa (al-Sanf)', at: [109.2, 13.8], d: [-1.1, 0] },
  { n: 14, name: 'Guangzhou (Khanfu, Canton)', at: [113.3, 23.1], d: [-0.8, -1] },
  { n: 15, name: 'Quanzhou (Zaitun)', at: [118.6, 24.9], d: [0.2, -1.2] },
];

function sheet({ file, lon, lat, title, sub, cart, rose, regions, seas }) {
  const k = Math.cos(((lat[0] + lat[1]) / 2) * Math.PI / 180);
  const sx = (W - 2 * M) / ((lon[1] - lon[0]) * k), sy = (H - 2 * M) / (lat[1] - lat[0]), s = Math.max(sx, sy);
  const cx = (lon[0] + lon[1]) / 2, cy = (lat[0] + lat[1]) / 2;
  const P = ([x, y]) => [W / 2 + (x - cx) * k * s, H / 2 - (y - cy) * s];
  const near = (r) => r.some(([x, y]) => x > lon[0] - 25 && x < lon[1] + 25 && y > lat[0] - 20 && y < lat[1] + 20);
  const land = rings.filter(near).map((r) => 'M' + r.map((p) => P(p).map((v) => v.toFixed(1)).join(',')).join('L') + 'Z').join('');
  // Smooth route (Catmull-Rom → cubic Béziers).
  const pts = ROUTE.map(P);
  let route = `M${pts[0].map((v) => v.toFixed(1))}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6], c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    route += `C${c1.map((v) => v.toFixed(1))} ${c2.map((v) => v.toFixed(1))} ${p2.map((v) => v.toFixed(1))}`;
  }
  const inside = ([x, y]) => x > M + 30 && x < W - M - 30 && y > M + 30 && y < H - M - 30;
  const marks = PLACES.map((p) => ({ ...p, xy: P(p.at) })).filter((p) => inside(p.xy)).map((p) => {
    const [x, y] = p.xy, L = 62, bx = x + p.d[0] * L, by = y + p.d[1] * L;
    return `<line x1="${x}" y1="${y}" x2="${bx}" y2="${by}" stroke="${INK}" stroke-width="2"/>
<circle cx="${x}" cy="${y}" r="9" fill="${RUST}" stroke="${PAPER}" stroke-width="3"/>
<circle cx="${bx}" cy="${by}" r="33" fill="${PAPER}" stroke="${INK}" stroke-width="2.5"/>
<text x="${bx}" y="${by + 15}" text-anchor="middle" font-size="44" fill="${INK}">${p.n}</text>`;
  }).join('\n');
  const lining = [[58, 0.16], [44, 0.22], [31, 0.3], [19, 0.42], [9, 0.6]].map(([w, o], i) =>
    `<path d="${land}" fill="none" stroke="${i % 1 === 0 ? INK : PAPER}" stroke-opacity="${o}" stroke-width="${w + 1.6}" stroke-linejoin="round"/><path d="${land}" fill="none" stroke="${PAPER}" stroke-width="${w - 1.6}" stroke-linejoin="round"/>`).join('');
  const roseSvg = (() => {
    const [x, y] = rose, R = 96; let g = '';
    for (let i = 0; i < 16; i++) {
      const a = (i * Math.PI) / 8, r = i % 4 === 0 ? R : i % 2 === 0 ? R * 0.68 : R * 0.4, b = R * 0.13;
      const tip = [x + Math.sin(a) * r, y - Math.cos(a) * r], l = [x + Math.sin(a - Math.PI / 2) * b, y - Math.cos(a - Math.PI / 2) * b], rr = [x + Math.sin(a + Math.PI / 2) * b, y - Math.cos(a + Math.PI / 2) * b];
      g += `<path d="M${x},${y}L${l}L${tip}Z" fill="${INK}"/><path d="M${x},${y}L${rr}L${tip}Z" fill="${PAPER}" stroke="${INK}" stroke-width="1.5"/>`;
    }
    return `<circle cx="${x}" cy="${y}" r="${R * 0.78}" fill="none" stroke="${INK}" stroke-width="1.5"/><circle cx="${x}" cy="${y}" r="${R * 0.72}" fill="none" stroke="${INK}" stroke-width="0.8"/>${g}<circle cx="${x}" cy="${y}" r="7" fill="${RUST}"/><text x="${x}" y="${y - R - 14}" text-anchor="middle" font-size="40" fill="${INK}">N</text>`;
  })();
  const [cxx, cyy, cw, ch] = cart;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="'EB Garamond', Garamond, serif">
<defs><clipPath id="neat"><rect x="${M}" y="${M}" width="${W - 2 * M}" height="${H - 2 * M}"/></clipPath></defs>
<rect width="${W}" height="${H}" fill="${PAPER}"/>
<g clip-path="url(#neat)">
${lining}
<path d="${land}" fill="${LAND}" stroke="${INK}" stroke-width="2.2" stroke-linejoin="round"/>
<path d="${land}" fill="${LAND}"/>
<path d="${land}" fill="none" stroke="${INK}" stroke-width="0" />
${regions.map(([t, x, y, size = 46, sp = 14, rot = 0]) => `<text x="${x}" y="${y}" text-anchor="middle" font-size="${size}" letter-spacing="${sp}" fill="${INK}" fill-opacity="0.78" transform="rotate(${rot} ${x} ${y})">${t}</text>`).join('\n')}
${seas.map(([t, x, y, size = 38, rot = 0]) => `<text x="${x}" y="${y}" text-anchor="middle" font-size="${size}" font-style="italic" letter-spacing="3" fill="${INK}" fill-opacity="0.7" transform="rotate(${rot} ${x} ${y})">${t}</text>`).join('\n')}
<path d="${route}" fill="none" stroke="${PAPER}" stroke-width="11" stroke-linecap="round"/>
<path d="${route}" fill="none" stroke="${RUST}" stroke-width="5" stroke-dasharray="16 11" stroke-linecap="round"/>
${roseSvg}
${marks}
<g>
<rect x="${cxx}" y="${cyy}" width="${cw}" height="${ch}" fill="${PAPER}" stroke="${INK}" stroke-width="3"/>
<rect x="${cxx + 9}" y="${cyy + 9}" width="${cw - 18}" height="${ch - 18}" fill="none" stroke="${INK}" stroke-width="1.2"/>
<text x="${cxx + cw / 2}" y="${cyy + 62}" text-anchor="middle" font-size="40" letter-spacing="7" fill="${RUST}">THE SEA ROAD</text>
<line x1="${cxx + cw / 2 - 60}" y1="${cyy + 82}" x2="${cxx + cw / 2 + 60}" y2="${cyy + 82}" stroke="${GOLD}" stroke-width="2"/>
<text x="${cxx + cw / 2}" y="${cyy + 128}" text-anchor="middle" font-size="38" fill="${INK}">${title}</text>
<text x="${cxx + cw / 2}" y="${cyy + 172}" text-anchor="middle" font-size="32" fill="${INK}">${sub}</text>
</g>
</g>
<rect x="${M}" y="${M}" width="${W - 2 * M}" height="${H - 2 * M}" fill="none" stroke="${INK}" stroke-width="3.5"/>
<rect x="${M - 13}" y="${M - 13}" width="${W - 2 * M + 26}" height="${H - 2 * M + 26}" fill="none" stroke="${INK}" stroke-width="1.3"/>
</svg>`;
  fs.writeFileSync(`${HERE}/${file}`, svg);
}

sheet({
  file: 'sea-road-west.svg', lon: [44, 84], lat: [-1, 34], title: 'Sheet I', sub: 'From the Gulf to Malabar',
  cart: [820, 80, 480, 205], rose: [800, 1080],
  regions: [['ARABIA', 250, 640, 50, 16], ['PERSIA', 560, 190, 50, 16], ['INDIA', 1170, 600, 54, 18]],
  seas: [['The Arabian Sea', 560, 830, 40]],
});
sheet({
  file: 'sea-road-east.svg', lon: [78, 122], lat: [-4, 32], title: 'Sheet II', sub: 'From Ceylon to China',
  cart: [90, 80, 480, 205], rose: [250, 1110],
  regions: [['CHINA', 1010, 190, 54, 18], ['SUMATRA', 790, 1160, 30, 6, 42], ['BORNEO', 1190, 1010, 30, 6]],
  seas: [['The Bay of Bengal', 330, 650, 38], ['The China Sea', 1160, 700, 36, -60]],
});
// The fragment the book sets under the map: each sheet, then its numbered key in type.
const key = (from, to) => `<div class="key">${PLACES.filter((p) => p.n >= from && p.n <= to).map((p) => `<p><span class="n">${p.n}</span>${p.name}</p>`).join('')}</div>`;
fs.writeFileSync(`${HERE}/sea-road-map.html`, `<figure class="plate"><img src="plate:sea-road-west.png" alt="Map of the sea road from the Persian Gulf to the Malabar coast and Ceylon, with seven numbered places"/><figcaption>The sea road, sheet I: from the Gulf to Malabar. The places are the ones this essay names, at their modern positions.</figcaption></figure>
${key(1, 7)}
<figure class="plate"><img src="plate:sea-road-east.png" alt="Map of the sea road from Ceylon through the straits by Sumatra to the ports of southern China, with eight numbered places"/><figcaption>The sea road, sheet II: from Ceylon to China.</figcaption></figure>
${key(8, 15)}
`);
console.log('wrote sea-road-west.svg, sea-road-east.svg, sea-road-map.html');
