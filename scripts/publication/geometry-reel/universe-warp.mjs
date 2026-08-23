// Universe-warp reel: the surviving masked reel discs (circles-masked-combined-pngs,
// already in final order, closer last) play through, the Microcosmus man twists
// into the vortex, the vortex becomes spinning sunburst stripes, and the
// Logarithmic Map of the Observable Universe (Budassi, 2012) emerges from the
// center — its Solar System core held rock-stable — then untwists and holds.
// Ported from the WARP block of _tmp-build-gif.mjs; inputs are workspace files
// so it survives /tmp cleanup.
import sharp from 'sharp';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = '/Users/jdietz/Documents/GitHub/dev/sourcelibrary-v2';
const DISC_DIR = join(ROOT, 'esoteric-geometries-out/circles-masked-combined-pngs');
const UNIVERSE = join(ROOT, 'esoteric-geometries-out/contemporary/ctp-09.jpg');
const EYE = join(ROOT, 'esoteric-geometries-out/eye/eye-11.jpg'); // Boehme Eye of Providence, 1715
const OUT = join(ROOT, 'esoteric-geometries-out/esoteric-geometries-circles-universe.gif');

const SIZE = 600, DELAY = 60, COLOURS = 256, PAD = 1.12;
const TEMPO = Number(process.env.TEMPO || 1);
const T = (ms) => Math.round(ms * TEMPO);
const DARK = { r: 26, g: 22, b: 18 };
const BG = { r: 20, g: 16, b: 25 };
const MAXS = Number(process.env.SWIRL || 6.5);
const SECTORS = Number(process.env.SECTORS || 9);
const CORE_STABLE = Number(process.env.CORE_STABLE || 0.22);

const ease = (t) => t * t * (3 - 2 * t);
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const cx = SIZE / 2, cy = SIZE / 2;
const R = Math.min(SIZE / 2 - 1, Math.round((SIZE / 2) * (1.03 / PAD)));

// ---- reel discs (already ordered circle-01..NN, closer = last) ----
const discFiles = readdirSync(DISC_DIR).filter(f => f.endsWith('.png')).sort();
console.log(`Reel discs: ${discFiles.length} (closer: ${discFiles[discFiles.length - 1]})`);
const discs = [];
for (const f of discFiles) discs.push(await sharp(join(DISC_DIR, f)).resize(SIZE, SIZE).png().toBuffer());
const manDisc = discs[discs.length - 1];

const darkBase = await sharp({ create: { width: SIZE, height: SIZE, channels: 3, background: DARK } }).png().toBuffer();
const onDark = (buf) => sharp(darkBase).composite([{ input: buf }]).png().toBuffer();
async function withAlpha(buf, f) {
  if (f >= 1) return buf;
  const m = await sharp(buf).metadata();
  const mask = Buffer.from(`<svg width="${m.width}" height="${m.height}"><rect width="100%" height="100%" fill="#fff" fill-opacity="${f}"/></svg>`);
  return sharp(buf).ensureAlpha().composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
}
async function layer(src, width, lx, ly, alpha = 1) {
  let b = await sharp(src).resize({ width: Math.max(2, Math.round(width)) }).png().toBuffer();
  if (alpha < 1) b = await withAlpha(b, alpha);
  const m = await sharp(b).metadata();
  return { input: b, left: Math.round(lx - m.width / 2), top: Math.round(ly - m.height / 2) };
}
const compose = (layers) => sharp(darkBase).composite(layers).png().toBuffer();

// ---- circle detection (outer-rim-biased; from the chakra pipeline) ----
async function detectCircle(path) {
  const DW = 240;
  const meta = await sharp(path).metadata();
  const scale = DW / Math.max(meta.width, meta.height);
  const w = Math.round(meta.width * scale), h = Math.round(meta.height * scale);
  const { data, info } = await sharp(path).grayscale().resize(w, h, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
  const ch = info.channels;
  const g = i => data[i * ch];
  const mag = new Float32Array(w * h), dx = new Float32Array(w * h), dy = new Float32Array(w * h);
  let sum = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i00 = (y - 1) * w + x, i10 = y * w + x, i20 = (y + 1) * w + x;
    const sx = -g(i00 - 1) + g(i00 + 1) - 2 * g(i10 - 1) + 2 * g(i10 + 1) - g(i20 - 1) + g(i20 + 1);
    const sy = -g(i00 - 1) - 2 * g(i00) - g(i00 + 1) + g(i20 - 1) + 2 * g(i20) + g(i20 + 1);
    const m = Math.hypot(sx, sy); const idx = y * w + x;
    mag[idx] = m; dx[idx] = sx; dy[idx] = sy; sum += m;
  }
  const cnt = (w - 2) * (h - 2), mean = sum / cnt;
  let s2 = 0; for (let i = 0; i < mag.length; i++) { const d = mag[i] - mean; s2 += d * d; }
  const thr = mean + Math.sqrt(s2 / cnt);
  const minDim = Math.min(w, h);
  const RSTEP = 2, rmin = Math.round(minDim * 0.20), rmax = Math.round(minDim * 0.78);
  const nr = Math.floor((rmax - rmin) / RSTEP) + 1;
  const acc = new Float32Array(nr * w * h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const idx = y * w + x, m = mag[idx]; if (m < thr) continue;
    const nx = dx[idx] / m, ny = dy[idx] / m;
    for (let ri = 0; ri < nr; ri++) {
      const r = rmin + ri * RSTEP, base = ri * w * h;
      let px = Math.round(x - nx * r), py = Math.round(y - ny * r);
      if (px >= 0 && px < w && py >= 0 && py < h) acc[base + py * w + px] += 1;
      px = Math.round(x + nx * r); py = Math.round(y + ny * r);
      if (px >= 0 && px < w && py >= 0 && py < h) acc[base + py * w + px] += 1;
    }
  }
  const perR = []; let globalBest = -1;
  for (let ri = 0; ri < nr; ri++) {
    const r = rmin + ri * RSTEP, base = ri * w * h, norm = 2 * Math.PI * r;
    let best = -1, bx = 0, by = 0;
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      let s = 0; for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) s += acc[base + (y + j) * w + (x + i)];
      const sc = s / norm;
      if (sc > best) { best = sc; bx = x; by = y; }
    }
    perR.push({ r, cx: bx, cy: by, conf: best });
    if (best > globalBest) globalBest = best;
  }
  let pick = null;
  for (let ri = nr - 1; ri >= 0; ri--) if (perR[ri].conf >= Math.max(0.10, 0.55 * globalBest)) { pick = perR[ri]; break; }
  if (!pick) pick = perR.reduce((a, b) => (b.conf > a.conf ? b : a));
  return { cx: pick.cx / scale, cy: pick.cy / scale, r: pick.r / scale, conf: pick.conf };
}

// ---- universe disc: detect, center, mask to the reel radius ----
const det = await detectCircle(UNIVERSE);
console.log(`Universe disc: conf=${det.conf.toFixed(2)} r=${det.r.toFixed(0)}`);
const side = Math.max(2, Math.round(2 * det.r * PAD));
const upad = side;
const extended = await sharp(UNIVERSE).extend({ top: upad, bottom: upad, left: upad, right: upad, background: BG }).toBuffer();
const uMask = Buffer.from(`<svg width="${SIZE}" height="${SIZE}"><circle cx="${cx}" cy="${cy}" r="${R}" fill="#fff"/></svg>`);
const universeDisc = await sharp(extended)
  .extract({ left: Math.round(det.cx - side / 2) + upad, top: Math.round(det.cy - side / 2) + upad, width: side, height: side })
  .resize(SIZE, SIZE, { fit: 'fill' })
  .ensureAlpha().composite([{ input: uMask, blend: 'dest-in' }]).png().toBuffer();
await sharp(universeDisc).png().toFile(join(ROOT, 'esoteric-geometries-out/universe-disc.png'));

// ---- eye disc (final image): same detect + mask treatment ----
const edet = await detectCircle(EYE);
console.log(`Eye disc: conf=${edet.conf.toFixed(2)} r=${edet.r.toFixed(0)}`);
const eside = Math.max(2, Math.round(2 * edet.r * PAD));
const epad = eside;
const eext = await sharp(EYE).extend({ top: epad, bottom: epad, left: epad, right: epad, background: BG }).toBuffer();
const eyeDisc = await sharp(eext)
  .extract({ left: Math.round(edet.cx - eside / 2) + epad, top: Math.round(edet.cy - eside / 2) + epad, width: eside, height: eside })
  .resize(SIZE, SIZE, { fit: 'fill' })
  .ensureAlpha().composite([{ input: uMask, blend: 'dest-in' }]).png().toBuffer();

// ---- swirl factory (same operator everywhere) ----
async function makeSwirler(discBuf, profile = (u) => (1 - u) * (1 - u)) {
  const { data: raw, info } = await sharp(discBuf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W2 = info.width, H2 = info.height;
  function sampleBilinear(sx, sy, out, oi) {
    if (sx < 0 || sy < 0 || sx > W2 - 1 || sy > H2 - 1) { out[oi + 3] = 0; return; }
    const x0 = Math.floor(sx), y0 = Math.floor(sy);
    const x1 = Math.min(x0 + 1, W2 - 1), y1 = Math.min(y0 + 1, H2 - 1);
    const fx = sx - x0, fy = sy - y0;
    const i00 = (y0 * W2 + x0) * 4, i10 = (y0 * W2 + x1) * 4;
    const i01 = (y1 * W2 + x0) * 4, i11 = (y1 * W2 + x1) * 4;
    for (let c = 0; c < 4; c++) {
      const top = raw[i00 + c] * (1 - fx) + raw[i10 + c] * fx;
      const bot = raw[i01 + c] * (1 - fx) + raw[i11 + c] * fx;
      out[oi + c] = Math.round(top * (1 - fy) + bot * fy);
    }
  }
  return async function swirl(strength, spin = 0) {
    const out = Buffer.alloc(W2 * H2 * 4, 0);
    const mcx = W2 / 2, mcy = H2 / 2;
    for (let y = 0; y < H2; y++) for (let x = 0; x < W2; x++) {
      const ddx = x - mcx, ddy = y - mcy, r = Math.hypot(ddx, ddy);
      const oi = (y * W2 + x) * 4;
      if (r > R) continue;
      const theta = Math.atan2(ddy, ddx) - strength * profile(r / R) - spin;
      sampleBilinear(mcx + r * Math.cos(theta), mcy + r * Math.sin(theta), out, oi);
    }
    return sharp(out, { raw: { width: W2, height: H2, channels: 4 } }).png().toBuffer();
  };
}
const swirlMan = await makeSwirler(manDisc);

// Sunburst stripes -> spiral under the same warp.
const INK = 245;
const sunRaw = Buffer.alloc(SIZE * SIZE * 4, 0);
for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
  const ddx = x - cx, ddy = y - cy, r = Math.hypot(ddx, ddy);
  if (r > R) continue;
  const a = (Math.atan2(ddy, ddx) / (2 * Math.PI) + 0.5) * SECTORS * 2;
  const i = (y * SIZE + x) * 4;
  if (Math.floor(a) % 2 === 0) { sunRaw[i] = INK; sunRaw[i + 1] = INK; sunRaw[i + 2] = INK; }
  else { sunRaw[i] = DARK.r; sunRaw[i + 1] = DARK.g; sunRaw[i + 2] = DARK.b; }
  sunRaw[i + 3] = 255;
}
const sunDisc = await sharp(sunRaw, { raw: { width: SIZE, height: SIZE, channels: 4 } }).png().toBuffer();
const swirlSun = await makeSwirler(sunDisc);

// Banded profile: dead-zero under the Solar System core, peak twist in the
// middle annulus, zero again at the rim.
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const band = (u) => smooth(CORE_STABLE, 0.55, u) * (1 - u) * (1 - u);
let peak = 0; for (let u = 0; u <= 1; u += 0.001) peak = Math.max(peak, band(u));
const swirlUniverse = await makeSwirler(universeDisc, (u) => band(u) / peak);
const swirlEye = await makeSwirler(eyeDisc, (u) => band(u) / peak);

async function centerReveal(buf, rr) {
  const m = await sharp(Buffer.from(
    `<svg width="${SIZE}" height="${SIZE}"><circle cx="${cx}" cy="${cy}" r="${Math.max(1, rr)}" fill="#fff"/></svg>`
  )).blur(12).png().toBuffer();
  return sharp(buf).ensureAlpha().composite([{ input: m, blend: 'dest-in' }]).png().toBuffer();
}

// ---- assemble ----
const mainFrames = await Promise.all(discs.map(onDark));
const K1 = 14, K2 = 4, K3 = 12, K4 = 10, K5 = 14;
// Spin per frame: 2π/SPIN_DIV. The original 26 read as too fast — default halved.
const dS = (2 * Math.PI) / Number(process.env.SPIN_DIV || 52);
let spin = 0;
const outro = [], outroDelays = [];

outro.push(await onDark(manDisc)); outroDelays.push(T(700));
for (let i = 1; i <= K1; i++) {
  outro.push(await onDark(await swirlMan(MAXS * ease(i / K1))));
  outroDelays.push(T(60));
}
const vortexMan = await swirlMan(MAXS);
for (let i = 1; i <= K2; i++) {
  const te = ease(i / K2); spin += dS;
  outro.push(await compose([
    await layer(vortexMan, SIZE, cx, cy, 1 - te),
    await layer(await swirlSun(MAXS, spin), SIZE, cx, cy, te),
  ]));
  outroDelays.push(T(55));
}
for (let i = 0; i < K3; i++) {
  spin += dS;
  outro.push(await onDark(await swirlSun(MAXS, spin)));
  outroDelays.push(T(55));
}
// The universe grows out of the spiral's center, core stable, annulus tightening.
const DRIFT = 0.30;
let A = MAXS;
for (let i = 1; i <= K4; i++) {
  const te = ease(i / K4); spin += dS; A += DRIFT;
  const base = await swirlSun(MAXS, spin);
  const uniV = await swirlUniverse(A, 0);
  outro.push(await compose([
    await layer(base, SIZE, cx, cy, 1),
    await layer(await centerReveal(uniV, te * R * 1.15), SIZE, cx, cy, 1),
  ]));
  outroDelays.push(T(55));
}
for (let i = 1; i <= K5; i++) {
  outro.push(await onDark(await swirlUniverse(A * (1 - ease(i / K5)), 0)));
  outroDelays.push(T(60));
}
outro.push(await onDark(universeDisc));
outroDelays.push(T(1400)); // beat on the observable universe

// The eye emerges from the universe's center — same reveal treatment the
// universe got from the stripes, but over the still cosmos.
const K6 = 10, K7 = 14;
let B = MAXS;
for (let i = 1; i <= K6; i++) {
  const te = ease(i / K6); B += DRIFT;
  const eyeV = await swirlEye(B, 0);
  outro.push(await compose([
    await layer(universeDisc, SIZE, cx, cy, 1),
    await layer(await centerReveal(eyeV, te * R * 1.15), SIZE, cx, cy, 1),
  ]));
  outroDelays.push(T(55));
}
for (let i = 1; i <= K7; i++) {
  outro.push(await onDark(await swirlEye(B * (1 - ease(i / K7)), 0)));
  outroDelays.push(T(60));
}
outro.push(await onDark(eyeDisc));
outroDelays.push(T(2800)); // hold on the eye

const seq = [...mainFrames, ...outro];
const delays = [...mainFrames.map(() => T(DELAY)), ...outroDelays];
await sharp(seq, { join: { animated: true } }).gif({ loop: 0, delay: delays, effort: 8, colours: COLOURS }).toFile(OUT);
console.log('wrote', OUT, 'with', seq.length, 'frames');
await sharp(seq, { join: { animated: true } }).webp({ loop: 0, delay: delays, effort: 6, quality: 90 }).toFile(OUT.replace(/\.gif$/, '.webp'));
console.log('wrote', OUT.replace(/\.gif$/, '.webp'));
