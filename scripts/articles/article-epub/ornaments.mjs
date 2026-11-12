// Cuts the house ornament set (ornaments.json: real woodcuts from the library's gallery, chosen by eye) into
// ornaments/<name>.png, each an ink mask: black with the ink as alpha, paper transparent. build.ts tints them.
// Usage: node scripts/articles/article-epub/ornaments.mjs [repo-root]   (network: fetches the gallery crops)
// Then LOOK at ornaments/contact.png: a wrong cut gets a `crop` in ornaments.json.
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(`${process.argv[2] ?? path.resolve(HERE, '../../..')}/package.json`);
const sharp = require('sharp');
const spec = JSON.parse(fs.readFileSync(`${HERE}/ornaments.json`, 'utf8'));
const OUT = `${HERE}/ornaments`;
fs.mkdirSync(OUT, { recursive: true });

/** Grey pixels of a picture. */
async function grey(buf) {
  const { data, info } = await sharp(buf).flatten({ background: '#fff' }).grayscale().raw().toBuffer({ resolveWithObject: true });
  return { g: new Uint8Array(data.buffer, data.byteOffset, data.length), W: info.width, H: info.height };
}
const pct = (g, p) => { const s = Uint8Array.from(g).sort(); return s[Math.floor((s.length - 1) * p)]; };

/** The woodcut block inside a gallery crop that also caught neighbouring type: along each axis, the run of
 *  inked columns (rows) with the most ink, runs being separated by a clear gap. */
function block(g, W, H, ink) {
  const run = (len, across, at) => {
    const d = new Float64Array(len);
    for (let i = 0; i < len; i++) { let n = 0; for (let j = 0; j < across; j++) if (at(i, j) < ink) n++; d[i] = n / across; }
    let best = [0, len - 1], bestInk = -1;
    for (let i = 0; i < len;) {
      if (d[i] < 0.03) { i++; continue; }
      let j = i, sum = 0, gap = 0;
      while (j < len && gap < 3) { if (d[j] < 0.03) gap++; else gap = 0; sum += d[j]; j++; }
      const end = j - gap - 1;
      if (sum > bestInk) { bestInk = sum; best = [i, end]; }
      i = j;
    }
    return best;
  };
  let [x0, x1] = run(W, H, (x, y) => g[y * W + x]);
  const [y0, y1] = run(H, x1 - x0 + 1, (y, j) => g[y * W + x0 + j]);
  [x0, x1] = run(x1 - x0 + 1, y1 - y0 + 1, (i, j) => g[(y0 + j) * W + x0 + i]).map((v) => v + x0);
  return { left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

async function cut(name, pick, { width, auto }) {
  const src = Buffer.from(await (await fetch(pick.image)).arrayBuffer());
  let { g, W, H } = await grey(src);
  const paper = pct(g, 0.85), dark = pct(g, 0.03), ink = dark + (paper - dark) * 0.5;
  const box = pick.crop
    ? { left: Math.round(pick.crop[0] * W), top: Math.round(pick.crop[1] * H), width: Math.round(pick.crop[2] * W), height: Math.round(pick.crop[3] * H) }
    : auto ? block(g, W, H, ink) : { left: 0, top: 0, width: W, height: H };
  const cropped = await sharp(src).extract(box).resize({ width, withoutEnlargement: false, kernel: 'lanczos3' }).toBuffer();
  ({ g, W, H } = await grey(cropped));
  // Ink as alpha: paper tone → clear, the darkest ink → solid, a little gamma so thin lines hold.
  const rgba = Buffer.alloc(W * H * 4);
  const lo = dark + (paper - dark) * 0.12, hi = paper - (paper - dark) * 0.22;
  for (let i = 0; i < W * H; i++) {
    const a = Math.min(1, Math.max(0, (hi - g[i]) / (hi - lo)));
    rgba[i * 4 + 3] = Math.round(255 * Math.pow(a, 0.8));
  }
  await sharp(rgba, { raw: { width: W, height: H, channels: 4 } }).png({ compressionLevel: 9, palette: true, colours: 32 }).toFile(`${OUT}/${name}.png`);
  return { name, W, H };
}

const jobs = [
  ...Object.entries(spec.initials).map(([L, p]) => [`initial-${L}`, p, { width: 300, auto: true }]),
  ...Object.entries(spec.initialsAlt ?? {}).map(([L, p]) => [`initial-${L}-2`, p, { width: 300, auto: true }]),
  ...['headpiece', 'headpieceAlt'].filter((k) => spec[k]).map((k) => [k, spec[k], { width: 1200, auto: true }]),
  ...['tailpiece', 'tailpieceAlt', 'fleuron'].filter((k) => spec[k]).map((k) => [k, spec[k], { width: 600, auto: true }]),
];
const done = [];
for (const [name, pick, opt] of jobs) done.push(await cut(name, pick, opt));

// Contact sheet, in the two inks the colour edition uses, for the check by eye.
const tint = async (name, hex, w) => {
  const m = await sharp(`${OUT}/${name}.png`).resize({ width: w }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const [r, gg, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  for (let i = 0; i < m.data.length; i += 4) { m.data[i] = r; m.data[i + 1] = gg; m.data[i + 2] = b; }
  return sharp(m.data, { raw: { width: m.info.width, height: m.info.height, channels: 4 } }).png().toBuffer();
};
const comps = []; let y = 20;
const letters = done.filter((d) => d.name.startsWith('initial-'));
for (const [i, d] of letters.entries()) {
  comps.push({ input: await tint(d.name, i % 2 ? '#1a1612' : '#9e4a3a', 130), left: 20 + (i % 8) * 150, top: y + Math.floor(i / 8) * 160 });
}
y += Math.ceil(letters.length / 8) * 160 + 10;
for (const d of done.filter((d) => !d.name.startsWith('initial-'))) {
  const w = d.name.startsWith('head') ? 800 : 300;
  const img = await tint(d.name, '#9e7c3c', w), img2 = await tint(d.name, '#1a1612', w);
  const h = Math.round(d.H * w / d.W);
  if (w === 800) { comps.push({ input: img, left: 20, top: y }, { input: img2, left: 20, top: y + h + 10 }); y += 2 * h + 30; }
  else { comps.push({ input: img, left: 20, top: y }, { input: img2, left: 360, top: y }); y += h + 20; }
}
await sharp({ create: { width: 1240, height: y + 20, channels: 3, background: '#fffdf8' } }).composite(comps).png().toFile(`${OUT}/contact.png`);
console.log(done.map((d) => `${d.name} ${d.W}x${d.H}`).join('\n'));
