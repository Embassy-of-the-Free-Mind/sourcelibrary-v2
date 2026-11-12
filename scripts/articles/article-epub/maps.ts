// Maps in the manner of an engraved chart: cream land, the coast echoed by ripple lines in the sea, a faint
// graticule, ports and routes, a compass rose and a cartouche. Coastlines are Natural Earth 1:50m (public domain,
// land.json). Every place and route comes from the article; places it calls uncertain are marked with "?".
import land from './land.json';

type LonLat = [number, number];
export type Port = { name: string; at: LonLat; note?: string; dx?: number; dy?: number; anchor?: 'start' | 'end' | 'middle'; major?: boolean;
  /** A stone circle (a ring of stones), filled when this book names it. */ circle?: 'named' | 'other' };
export type Route = { pts: LonLat[]; label?: string; labelAt?: number; colour?: 'rust' | 'ink' | 'gold' | 'sage'; dash?: string; width?: number };
export type MapSpec = {
  title: string; sub: string; bbox: [number, number, number, number]; // lon0, lat0, lon1, lat1
  ports: Port[]; routes: Route[]; seas?: { name: string; at: LonLat; size?: number; rotate?: number }[];
  legend?: { label: string; colour: Route['colour']; dash?: string; circle?: 'named' | 'other' }[]; credit: string;
  rose?: LonLat; legendAt?: 'bl' | 'br';
};

const FONT = `font-family="P052, 'Nimbus Roman', serif"`;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function mapSvg(spec: MapSpec, bw: boolean): string {
  const W = 1800, M = 60, TOP = 150;
  const C = bw
    ? { ink: '#000', rust: '#000', gold: '#000', sage: '#000', paper: '#fff', land: '#fff', sea: '#fff', ripple: '#777', grid: '#bbb' }
    : { ink: '#2b2118', rust: '#9e4a3a', gold: '#9e7c3c', sage: '#5e6d52', paper: '#fbf7ef', land: '#efe3c8', sea: '#f4f1e8', ripple: '#9fb0b3', grid: '#d8cfbd' };
  const [lon0, lat0, lon1, lat1] = spec.bbox;
  const merc = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  const my0 = merc(lat0), my1 = merc(lat1);
  // Mercator: x and y share one scale, so the page takes the map's own shape.
  const kx = (W - 2 * M) / (lon1 - lon0), ky = kx * 180 / Math.PI;
  const mapH0 = (my1 - my0) * ky, H = Math.round(TOP + mapH0 + 90);
  const ox = M, oy = TOP;
  const P = ([lon, lat]: LonLat): [number, number] => [ox + (lon - lon0) * kx, oy + (my1 - merc(lat)) * ky];
  const path = (ring: number[][]) => ring.map((p, i) => { const [x, y] = P(p as LonLat); return `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`; }).join('') + 'Z';
  const inView = (ring: number[][]) => ring.some(([lo, la]) => lo >= lon0 - 5 && lo <= lon1 + 5 && la >= lat0 - 5 && la <= lat1 + 5);
  const landPath = (land as { land: number[][][] }).land.filter(inView).map(path).join('');
  const lakePath = (land as { lakes: number[][][] }).lakes.filter(inView).map(path).join('');

  // Smooth a route through its points (Catmull-Rom → cubic Bézier).
  const smooth = (pts: LonLat[]) => {
    const q = pts.map(P);
    let d = `M${q[0][0].toFixed(1)} ${q[0][1].toFixed(1)}`;
    for (let i = 0; i < q.length - 1; i++) {
      const p0 = q[Math.max(0, i - 1)], p1 = q[i], p2 = q[i + 1], p3 = q[Math.min(q.length - 1, i + 2)];
      const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6], c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
      d += ` C${c1[0].toFixed(1)} ${c1[1].toFixed(1)} ${c2[0].toFixed(1)} ${c2[1].toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
    }
    return d;
  };
  const col = (c?: Route['colour']) => C[c ?? 'rust'];

  let grid = '';
  for (let lo = Math.ceil(lon0 / 10) * 10; lo <= lon1; lo += 10) { const [x] = P([lo, lat0]); grid += `<line x1="${x}" y1="${oy}" x2="${x}" y2="${oy + (my1 - my0) * ky}" stroke="${C.grid}" stroke-width="1"/>`; }
  for (let la = Math.ceil(lat0 / 10) * 10; la <= lat1; la += 10) { const [, y] = P([lon0, la]); grid += `<line x1="${ox}" y1="${y}" x2="${W - M}" y2="${y}" stroke="${C.grid}" stroke-width="1"/>`; }

  const routes = spec.routes.map((r) => {
    let out = `<path d="${smooth(r.pts)}" fill="none" stroke="${col(r.colour)}" stroke-width="${r.width ?? 5}" stroke-dasharray="${r.dash ?? '16 10'}" stroke-linecap="round"/>`;
    if (r.label) {
      const i = Math.min(r.pts.length - 1, r.labelAt ?? Math.floor(r.pts.length / 2));
      const [x, y] = P(r.pts[i]);
      out += `<text x="${x}" y="${y - 16}" text-anchor="middle" ${FONT} font-size="27" font-style="italic" fill="${col(r.colour)}" stroke="${C.paper}" stroke-width="6" paint-order="stroke">${esc(r.label)}</text>`;
    }
    return out;
  }).join('');
  const seas = (spec.seas ?? []).map((t) => { const [x, y] = P(t.at); return `<text x="${x}" y="${y}" text-anchor="middle" ${FONT} font-size="${t.size ?? 30}" font-style="italic" letter-spacing="6" fill="${C.ripple}" transform="rotate(${t.rotate ?? 0} ${x} ${y})">${esc(t.name.toUpperCase())}</text>`; }).join('');
  const ports = spec.ports.map((p) => {
    const [x, y] = P(p.at), dx = p.dx ?? 14, dy = p.dy ?? -10, a = p.anchor ?? 'start';
    const halo = `stroke="${C.paper}" stroke-width="7" paint-order="stroke"`;
    const mark = p.circle
      ? Array.from({ length: 9 }, (_, k) => { const t = k / 9 * 2 * Math.PI; return `<circle cx="${(x + Math.cos(t) * 15).toFixed(1)}" cy="${(y + Math.sin(t) * 15).toFixed(1)}" r="4.8" fill="${p.circle === 'named' ? C.rust : C.paper}" stroke="${C.ink}" stroke-width="1.6"/>`; }).join('')
      : `<circle cx="${x}" cy="${y}" r="${p.major ? 10 : 7}" fill="${p.major ? C.ink : C.paper}" stroke="${C.ink}" stroke-width="3"/>`;
    return mark
      + `<text x="${x + dx}" y="${y + dy}" text-anchor="${a}" ${FONT} font-size="${p.major ? 32 : 28}" fill="${C.ink}" ${halo}>${esc(p.name)}</text>`
      + (p.note ? `<text x="${x + dx}" y="${y + dy + 28}" text-anchor="${a}" ${FONT} font-size="22" font-style="italic" fill="${C.ink}" ${halo}>${esc(p.note)}</text>` : '');
  }).join('');
  const legend = spec.legend?.length ? (() => {
    const lx = spec.legendAt === 'br' ? W - M - 560 : M + 30, ly = oy + (my1 - my0) * ky - 30 - spec.legend!.length * 38 + 20;
    return `<rect x="${lx - 18}" y="${ly - 40}" width="560" height="${spec.legend!.length * 38 + 34}" fill="${C.paper}" stroke="${C.ink}" stroke-width="2"/>`
      + spec.legend!.map((l, i) => {
        const yy = ly + i * 38 - 8;
        const key = l.circle
          ? Array.from({ length: 9 }, (_, k) => { const t = k / 9 * 2 * Math.PI; return `<circle cx="${(lx + 35 + Math.cos(t) * 13).toFixed(1)}" cy="${(yy + Math.sin(t) * 13).toFixed(1)}" r="4.2" fill="${l.circle === 'named' ? C.rust : C.paper}" stroke="${C.ink}" stroke-width="1.6"/>`; }).join('')
          : `<line x1="${lx}" y1="${yy}" x2="${lx + 70}" y2="${yy}" stroke="${col(l.colour)}" stroke-width="5" stroke-dasharray="${l.dash ?? '16 10'}"/>`;
        return `${key}<text x="${lx + 90}" y="${ly + i * 38}" ${FONT} font-size="25" fill="${C.ink}">${esc(l.label)}</text>`;
      }).join('');
  })() : '';
  const [rx, ry] = spec.rose ? P(spec.rose) : [W - M - 110, TOP + 120];
  const rose = [0, 90, 180, 270].map((a) => {
    const t = (a - 90) * Math.PI / 180, u = (a - 45) * Math.PI / 180, v = (a - 135) * Math.PI / 180, r = 70;
    return `<path d="M${rx} ${ry} L${rx + Math.cos(u) * 16} ${ry + Math.sin(u) * 16} L${rx + Math.cos(t) * r} ${ry + Math.sin(t) * r} L${rx + Math.cos(v) * 16} ${ry + Math.sin(v) * 16} Z" fill="${a % 180 ? C.paper : C.ink}" stroke="${C.ink}" stroke-width="2"/>`;
  }).join('') + `<circle cx="${rx}" cy="${ry}" r="44" fill="none" stroke="${C.ink}" stroke-width="1.2"/><text x="${rx}" y="${ry - 82}" text-anchor="middle" ${FONT} font-size="26" fill="${C.ink}">N</text>`;
  const mapH = (my1 - my0) * ky;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <defs><clipPath id="frame"><rect x="${ox}" y="${oy}" width="${W - 2 * M}" height="${mapH}"/></clipPath></defs>
  <rect width="${W}" height="${H}" fill="${C.paper}"/>
  <g clip-path="url(#frame)">
    <rect x="${ox}" y="${oy}" width="${W - 2 * M}" height="${mapH}" fill="${C.sea}"/>
    ${grid}
    <path d="${landPath}" fill="none" stroke="${C.ripple}" stroke-width="30" stroke-linejoin="round" opacity="0.35"/>
    <path d="${landPath}" fill="none" stroke="${C.sea}" stroke-width="24" stroke-linejoin="round"/>
    <path d="${landPath}" fill="none" stroke="${C.ripple}" stroke-width="15" stroke-linejoin="round" opacity="0.55"/>
    <path d="${landPath}" fill="none" stroke="${C.sea}" stroke-width="10" stroke-linejoin="round"/>
    <path d="${landPath}" fill="${C.land}" stroke="${C.ink}" stroke-width="2" stroke-linejoin="round"/>
    <path d="${lakePath}" fill="${C.sea}" stroke="${C.ink}" stroke-width="1.2"/>
    ${seas}${routes}${ports}${legend}${rose}
  </g>
  <rect x="${ox}" y="${oy}" width="${W - 2 * M}" height="${mapH}" fill="none" stroke="${C.ink}" stroke-width="4"/>
  <rect x="${ox - 10}" y="${oy - 10}" width="${W - 2 * M + 20}" height="${mapH + 20}" fill="none" stroke="${C.ink}" stroke-width="1.5"/>
  <text x="${W / 2}" y="68" text-anchor="middle" ${FONT} font-size="48" letter-spacing="9" fill="${C.ink}">${esc(spec.title.toUpperCase())}</text>
  <text x="${W / 2}" y="112" text-anchor="middle" ${FONT} font-size="30" font-style="italic" fill="${C.ink}">${esc(spec.sub)}</text>
  <text x="${W - M}" y="${Math.min(H - 14, oy + mapH + 44)}" text-anchor="end" ${FONT} font-size="20" fill="${C.ink}">${esc(spec.credit)}</text>
</svg>`;
}

// ── The maps, by article ───────────────────────────────────────────────────────────────────────────────────
const SEA_PORTS: Record<string, LonLat> = {
  basra: [47.8, 30.5], siraf: [52.33, 27.67], hormuz: [56.45, 27.1], muscat: [58.6, 23.6], quilon: [76.6, 8.9],
  calicut: [75.78, 11.25], nicobar: [93.5, 8.0], kalah: [100.3, 6.1], tioman: [104.17, 2.8], khmer: [105.4, 9.6],
  champa: [109.2, 13.8], luqin: [106.7, 20.5], guangzhou: [113.3, 23.1], quanzhou: [118.6, 24.9], nanjing: [118.8, 32.05],
  ceylon: [80.7, 7.5], malacca: [102.25, 2.2], sumatra: [95.3, 5.5],
};
const P_ = SEA_PORTS;
// The sea lane, through open water (waypoints keep the line off the land).
const LANE: LonLat[] = [P_.basra, [50.3, 28.9], P_.siraf, [55.2, 26.4], [57.2, 26.3], [58.9, 24.6], P_.muscat, [62, 21], [69, 15], [74.5, 10.4], P_.quilon,
  [77.8, 7.3], [80.5, 5.4], [86, 6.5], P_.nicobar, [97.5, 6.6], P_.kalah, [100.6, 4.2], [101.6, 2.4], [103.4, 1.2], [104.6, 1.5], P_.tioman,
  [105.3, 5.5], [105.6, 8.3], P_.khmer, [107.6, 10.3], [109.5, 12.2], P_.champa, [109.6, 16.5], [107.9, 19.0], P_.luqin, [109.6, 20.6], [111.4, 21.3], P_.guangzhou];

export const MAPS: Record<string, MapSpec[]> = {
  'sea-road-china-gulf': [
    {
      title: 'The Sea Road', sub: 'Siraf to Khanfu, as the merchants sailed it in the ninth century', bbox: [44, -4, 122, 34], rose: [53, 3],
      seas: [{ name: 'Sea of India', at: [68, 7], size: 34 }, { name: 'Sea of Harkand', at: [88, 12.5] }, { name: 'Sea of China', at: [113.5, 10.5] }, { name: 'Gulf', at: [51.2, 26.6], size: 20, rotate: -35 }],
      routes: [{ pts: LANE }],
      ports: [
        { name: 'al-Ubulla (Basra)', at: P_.basra, dx: 14, dy: -12 }, { name: 'Siraf', at: P_.siraf, major: true, note: 'the China ships load', dx: 16, dy: 30 },
        { name: 'Muscat', at: P_.muscat, dx: 16, dy: 8, note: 'water' }, { name: 'Kulam Mali (Quilon)', at: P_.quilon, dx: -14, anchor: 'end', note: '1,000 dirhams a ship' },
        { name: 'Islands of the Lanj', at: P_.nicobar, dy: 38, anchor: 'end', dx: -6, note: 'the Nicobars' }, { name: 'Kalah', at: P_.kalah, dx: 14, dy: -12 },
        { name: 'Tiyumah (Tioman)', at: P_.tioman, dy: 32 }, { name: 'Qumar (Khmer)', at: P_.khmer, dx: -14, anchor: 'end' },
        { name: 'al-Sanf (Champa)', at: P_.champa }, { name: 'Luqin?', at: P_.luqin, dx: -14, anchor: 'end' },
        { name: 'Khanfu (Guangzhou)', at: P_.guangzhou, major: true, dx: -16, anchor: 'end', dy: -22, note: 'the largest port' },
      ],
      credit: 'After Sulayman the Merchant (in Ibn al-Faqih) and Ibn Khordadbeh. Coastlines: Natural Earth.',
    },
    {
      title: 'Who Sailed It', sub: 'later voyages on the same road, from the books in this volume', bbox: [44, -6, 124, 36], rose: [118, 5], legendAt: 'bl',
      seas: [{ name: 'Indian Ocean', at: [84, -2.5], size: 34 }, { name: 'Sea of China', at: [114, 10.5] }],
      routes: [
        { pts: [P_.quanzhou, [117, 21.5], [112, 17], P_.champa, [108.5, 9], [105, 4], [101.6, 2.4], [99, 4.4], P_.sumatra, [88, 6], [81.5, 5.6], [78, 7], P_.quilon, [72, 15], [62, 22.5], [58, 25.5], P_.hormuz], colour: 'rust' },
        { pts: [P_.calicut, [74.8, 9], [77.5, 6.6], [81, 5.2], [92, 7], [99, 5.5], [103.5, 1.3], [106, 6], [110.5, 12], [114.5, 19.5], P_.quanzhou], colour: 'sage', dash: '4 10' },
        { pts: [P_.nanjing, [122.5, 30.5], [121, 26], P_.quanzhou, [116.5, 22], [111, 17], [109.7, 12], [106.5, 7.5], [102.8, 2.2], [98.5, 5.0], [94, 7.5], [86, 5.5], [80.5, 5.0], [77, 7.5], P_.calicut, [68, 18], [60, 23.8], [57, 26], P_.hormuz], colour: 'ink', dash: '22 8 4 8' },
        { pts: [[47, -5], [58, 3], [68, 9], P_.calicut], colour: 'gold', dash: '10 8' },
      ],
      legend: [{ label: 'Marco Polo, homeward, c. 1291–93', colour: 'rust' }, { label: 'Ibn Battuta, to China, 1340s', colour: 'sage', dash: '4 10' }, { label: 'Zheng He, seven fleets, 1405–33', colour: 'ink', dash: '22 8 4 8' }, { label: 'The Portuguese, 1498', colour: 'gold', dash: '10 8' }],
      ports: [
        { name: 'Hormuz', at: P_.hormuz, major: true, dy: -16 }, { name: 'Calicut', at: P_.calicut, dx: -14, anchor: 'end', major: true }, { name: 'Quilon', at: P_.quilon, dx: -14, anchor: 'end', dy: 22 },
        { name: 'Ceylon', at: P_.ceylon, dx: 16, dy: 8 }, { name: 'Sumatra', at: P_.sumatra, dx: -12, anchor: 'end', dy: 30 }, { name: 'Malacca', at: P_.malacca, dx: -14, anchor: 'end', dy: 26 },
        { name: 'Champa', at: P_.champa }, { name: 'Quanzhou (Zaitun)', at: P_.quanzhou, major: true, dx: -16, anchor: 'end', dy: -18 }, { name: 'Guangzhou', at: P_.guangzhou, dx: -14, anchor: 'end', dy: 30 },
        { name: 'Nanjing', at: P_.nanjing, dx: -14, anchor: 'end' },
      ],
      credit: 'Routes as the books describe them, drawn for this edition. Coastlines: Natural Earth.',
    },
  ],
  hyperborea: [
    {
      title: 'Beyond the North Wind', sub: 'the places of this book, and three roads north', bbox: [-12, 34, 64, 71], rose: [-6, 38], legendAt: 'br',
      seas: [{ name: 'Ocean', at: [-8, 54], size: 30, rotate: -80 }, { name: 'Cronian Sea?', at: [4, 67.5], size: 26 }, { name: 'Baltic', at: [19.5, 57.5], size: 24, rotate: -50 }, { name: 'Black Sea', at: [34, 43.2], size: 24 }],
      routes: [
        { pts: [[20.3, 54.9], [19, 52], [17.5, 49.5], [15.5, 47.5], [13.5, 46.2], [12.4, 44.95], [15, 41.5], [18.5, 39.8], [21.5, 38.3], [24, 37.8], [25.27, 37.4]], colour: 'gold' },
        { pts: [[5.37, 43.3], [3, 41], [-1, 36.5], [-7, 36.6], [-9.5, 39.5], [-9.6, 43.5], [-5.5, 48], [-6.1, 49.8], [-6.0, 51.8], [-5.3, 53.4], [-5.6, 55.1], [-7.4, 56.8], [-5.4, 58.75], [-3.0, 59.35], [-4, 63]], colour: 'rust' },
        { pts: [[25.27, 37.4], [26.5, 40.3], [29, 41.2], [33, 44.6], [38, 47], [45, 49.5], [52, 51.8], [58.5, 54]], colour: 'sage', dash: '4 10' },
      ],
      ports: [
        { name: 'Delos', at: [25.27, 37.4], major: true, dy: 34 }, { name: 'Delphi', at: [22.5, 38.48], dx: -14, anchor: 'end' },
        { name: 'Samland', at: [20.3, 54.9], major: true, note: 'the amber coast', dx: 14 }, { name: 'Eridanus? (the Po)', at: [12.4, 44.95], dx: -14, anchor: 'end' },
        { name: 'Massalia', at: [5.37, 43.3], dy: 30 }, { name: 'Stonehenge', at: [-1.83, 51.18], dx: 22, dy: 10, circle: 'named' }, { name: 'Callanish', at: [-6.75, 58.2], dx: 22, dy: -12, circle: 'named' },
        { name: 'Thule?', at: [-4, 63], dx: 14, note: 'six days’ sail north of Britain' }, { name: 'Scythians', at: [34, 47.5], dx: 14 },
        { name: 'Issedones', at: [58.5, 54], dx: -14, anchor: 'end', dy: -16 }, { name: 'Toruń', at: [18.6, 53.0], dx: 14, dy: 12 },
        { name: 'Uppsala', at: [17.64, 59.86], dx: 14, note: 'Rudbeck’s Atlantica' },
      ],
      legend: [{ label: 'Amber, south to the Greeks', colour: 'gold' }, { label: 'Pytheas’s voyage to Thule', colour: 'rust' }, { label: 'Aristeas’s road north-east', colour: 'sage', dash: '4 10' }, { label: 'Stone circle named in this book', colour: 'rust', circle: 'named' }],
      credit: 'Places as the book names them; "?" where the sources are uncertain. Coastlines: Natural Earth.',
    },
    {
      // Hecataeus's island "opposite the land of the Celts" with its round temple: the circles this book's
      // writers proposed (filled), and the other great circles of Britain, Ireland and Brittany (open).
      title: 'The Round Temple?', sub: 'stone circles of the islands opposite the Celts', bbox: [-11, 47, 3, 60.6], rose: [1.2, 58.6], legendAt: 'bl',
      seas: [{ name: 'Ocean', at: [-8.6, 50.4], size: 30 }, { name: 'German Sea', at: [1.8, 55.5], size: 24, rotate: -70 }, { name: 'Irish Sea', at: [-4.9, 53.8], size: 20, rotate: -60 }],
      routes: [{ pts: [[-5.5, 48], [-6.1, 49.8], [-6.0, 51.8], [-5.3, 53.4], [-5.6, 55.1], [-7.4, 56.8], [-5.4, 58.75], [-3.0, 59.35], [-2.6, 60.4]], colour: 'rust' }],
      ports: [
        { name: 'Stonehenge', at: [-1.826, 51.179], circle: 'named', dx: 22, dy: 30, note: 'Stukeley, Smith, Wood' },
        { name: 'Avebury', at: [-1.854, 51.429], circle: 'other', dx: 22, dy: -6 },
        { name: 'Boscawen-Un and Borlase’s Cornish circles', at: [-5.619, 50.09], circle: 'named', dx: 22, dy: 8 },
        { name: 'Callanish', at: [-6.745, 58.198], circle: 'named', dx: 22, dy: 8, note: 'Toland’s candidate' },
        { name: 'Ring of Brodgar', at: [-3.23, 59.0], circle: 'other', dx: -22, anchor: 'end', dy: 8 },
        { name: 'Castlerigg', at: [-3.098, 54.603], circle: 'other', dx: 22, dy: 8 },
        { name: 'Drombeg', at: [-9.087, 51.565], circle: 'other', dx: 22, dy: 8 },
        { name: 'Carnac (stone rows)', at: [-3.077, 47.584], circle: 'other', dx: 22, dy: 8 },
      ],
      legend: [{ label: 'Proposed by writers in this book', colour: 'rust', circle: 'named' }, { label: 'Other great stone monuments', colour: 'ink', circle: 'other' }, { label: 'Pytheas’s course north', colour: 'rust' }],
      credit: 'Monument positions from standard gazetteers; the essay names Stonehenge, Callanish and Borlase’s circles. Coastlines: Natural Earth.',
    },
  ],
};
