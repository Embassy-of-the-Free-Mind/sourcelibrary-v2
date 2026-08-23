import sharp from 'sharp';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DIR = '/tmp/geo-out/frames/OEBPS/images';
const MANIFEST = '/tmp/geo-out/manifest.json';
const EXTRA_DIR = process.env.EXTRA_DIR || ''; // extra image dir (e.g. Buddhist plates); no keyword pre-filter, detection decides
const EXTRA_CONF = Number(process.env.EXTRA_CONF || 0); // separate (usually lower) detection threshold for extra-dir images
const EXTRA_RMIN = Number(process.env.EXTRA_RMIN || 0.10); // min detected-radius fraction for extra images (mandalas fill the plate)
const EXTRA_MINPX = Number(process.env.EXTRA_MINPX || 0); // skip extra images smaller than this on their short side (drops tiny thumbnails)
const GEO_SKIP = process.env.GEO_SKIP === '1'; // skip the geometry plates (extra-dir only)
const EXCLUDE = new Set((process.env.EXCLUDE || '').split(',').map(s => s.trim()).filter(Boolean)); // drop these source files
const INCLUDE = new Set((process.env.INCLUDE || '').split(',').map(s => s.trim()).filter(Boolean)); // force-keep these: trust detection even below the conf gate
const OUT = process.argv[2] || '/tmp/geo-out/esoteric-geometries-circles-centered.gif';
const SIZE = Number(process.argv[3] || 560);
const DELAY = Number(process.argv[4] || 70);
const TEMPO = Number(process.env.TEMPO || 1); // multiply ALL frame delays (1.4 = 40% slower)
const T = (ms) => Math.round(ms * TEMPO);
const COLOURS = Number(process.argv[5] || 256);
const PAD = Number(process.argv[6] || 1.18); // frame side = detected diameter * PAD (so all circles fill SIZE/PAD)
const CONF = Number(process.argv[7] || 0.08); // min ring-completeness to trust a detected circle
const DETECTED_ONLY = process.env.DETECTED_ONLY === '1'; // keep only plates with a real detected circle
const MASK = process.env.MASK === '1'; // mask to the disc only, transparent outside (implies detected-only)
const OUTRO = process.env.OUTRO === '1'; // append a Source Library logo fade-out outro (opaque, branded)
const WARP = process.env.WARP === '1'; // outro ends in a spinning hypnotic spiral instead of the wordmark
const LOGO = process.env.LOGO || 'public/brand/png/logo-stacked--white-on-transparent--512h.png';
const BG = { r: 20, g: 16, b: 25 };
const DARK = { r: 26, g: 22, b: 18 }; // brand dark #1a1612

const CIRCLE_RE = /\b(circle|circular|concentric|wheel|volvelle|sphere|spherical|armillar|orb|annular|rota|rose window|mandala|roundel|rotating|radial|zodiac|globe|disc|disk)\b/i;
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const order = manifest.chapters.flatMap(c => c.plates);
const files = [];
order.forEach((p, i) => { if (CIRCLE_RE.test(`${p.description || ''} ${p.type || ''}`)) files.push(`plate-${i + 1}.jpg`); });

// Work items: geometry plates from DIR, plus optional extra images (Buddhist).
const entries = GEO_SKIP ? [] : files.map(f => ({ path: join(DIR, f), file: f, extra: false }));
if (EXTRA_DIR && existsSync(EXTRA_DIR)) {
  const extra = readdirSync(EXTRA_DIR).filter(f => /\.(jpe?g|png)$/i.test(f)).sort();
  for (const f of extra) entries.push({ path: join(EXTRA_DIR, f), file: f, extra: true });
  console.log(`Extra images from ${EXTRA_DIR}: +${extra.length}`);
}

// Gradient-based Hough circle detection on a downscaled grayscale copy.
async function detectCircle(path) {
  const DW = 240;
  const meta = await sharp(path).metadata();
  const scale = DW / Math.max(meta.width, meta.height);
  const w = Math.round(meta.width * scale), h = Math.round(meta.height * scale);
  const { data, info } = await sharp(path).grayscale().resize(w, h, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
  const ch = info.channels;
  const g = i => data[i * ch]; // grayscale value at pixel index

  const gxK = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
  const gyK = [-1, -2, -1, 0, 0, 0, 1, 2, 1];
  const mag = new Float32Array(w * h), dx = new Float32Array(w * h), dy = new Float32Array(w * h);
  let sum = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    let sx = 0, sy = 0, k = 0;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { const v = g((y + j) * w + (x + i)); sx += v * gxK[k]; sy += v * gyK[k]; k++; }
    const m = Math.hypot(sx, sy); const idx = y * w + x; mag[idx] = m; dx[idx] = sx; dy[idx] = sy; sum += m;
  }
  const cnt = (w - 2) * (h - 2), mean = sum / cnt;
  let s2 = 0; for (let i = 0; i < mag.length; i++) { const d = mag[i] - mean; s2 += d * d; }
  const std = Math.sqrt(s2 / cnt);
  const thr = mean + 1.0 * std;

  const minDim = Math.min(w, h);
  const RSTEP = 2;
  const rmin = Math.round(minDim * 0.15), rmax = Math.round(minDim * 0.62);
  const nr = Math.floor((rmax - rmin) / RSTEP) + 1;
  // 3D accumulator (r, y, x): every edge pixel votes for candidate centers at
  // each radius, in both gradient directions.
  const acc = new Float32Array(nr * w * h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const idx = y * w + x, m = mag[idx]; if (m < thr) continue;
    const nx = dx[idx] / m, ny = dy[idx] / m;
    for (let ri = 0; ri < nr; ri++) {
      const r = rmin + ri * RSTEP, base = ri * w * h;
      let cx = Math.round(x - nx * r), cy = Math.round(y - ny * r);
      if (cx >= 0 && cx < w && cy >= 0 && cy < h) acc[base + cy * w + cx] += 1;
      cx = Math.round(x + nx * r); cy = Math.round(y + ny * r);
      if (cx >= 0 && cx < w && cy >= 0 && cy < h) acc[base + cy * w + cx] += 1;
    }
  }
  // Global peak, normalized per circumference so large circles aren't favored.
  let best = -1, bx = w / 2, by = h / 2, bri = Math.round(nr / 2);
  for (let ri = 0; ri < nr; ri++) {
    const r = rmin + ri * RSTEP, base = ri * w * h, norm = 2 * Math.PI * r;
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      // light 3x3 smoothing in the center plane
      let s = 0; for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) s += acc[base + (y + j) * w + (x + i)];
      const score = s / norm;
      if (score > best) { best = score; bx = x; by = y; bri = ri; }
    }
  }
  const br = rmin + bri * RSTEP;
  // best ≈ fraction of the ring's circumference covered by detected edges.
  return { cx: bx / scale, cy: by / scale, r: br / scale, conf: best };
}

const kept = [];
let detected = 0;
for (const { path, file: f, extra } of entries) {
  if (EXCLUDE.has(f)) { if (process.env.DEBUG) console.log(`  ${f} excluded`); continue; }
  const confThresh = extra && EXTRA_CONF > 0 ? EXTRA_CONF : CONF;
  const meta = await sharp(path).metadata();
  const minOrig = Math.min(meta.width, meta.height);
  // Extra plates below a size floor are low-value thumbnails — skip (avoids
  // spurious tiny-circle detections on near-blank scraps).
  if (extra && EXTRA_MINPX > 0 && minOrig < EXTRA_MINPX) { if (process.env.DEBUG) console.log(`  ${f} skip (minOrig ${minOrig} < ${EXTRA_MINPX})`); continue; }
  let cx = meta.width / 2, cy = meta.height / 2, r = minOrig * 0.45, use = false;
  try {
    const det = await detectCircle(path);
    const rLo = extra ? EXTRA_RMIN : 0.10;
    const rOk = det.r >= minOrig * rLo && det.r <= minOrig * 0.70;
    // Trust a detection if the ring is reasonably complete and plausibly sized,
    // or if it's a near-perfect ring regardless of size.
    use = (det.conf >= confThresh && rOk) || det.conf >= 0.6 || (INCLUDE.has(f) && rOk);
    if (use) { cx = det.cx; cy = det.cy; r = det.r; detected++; }
    if (process.env.DEBUG) console.log(`  ${f} conf=${det.conf.toFixed(3)} r=${det.r.toFixed(0)} rfrac=${(det.r / minOrig).toFixed(2)} ${rOk ? '' : 'r-bad '}${use ? 'USE' : 'fallback'}`);
  } catch (e) { if (process.env.DEBUG) console.log(`  ${f} detect error ${e.message}`); }

  // DROPPED mode: keep ONLY the plates that FAILED detection (to inspect what
  // the precision gate excluded). Otherwise, in detected-only/mask mode, drop
  // plates with no real circle so every frame is a circle.
  if (process.env.DROPPED === '1') { if (use) continue; }
  else if ((DETECTED_ONLY || MASK) && !use) continue;

  const side = Math.max(2, Math.round(2 * r * PAD));
  const pad = side;
  const left = Math.round(cx - side / 2) + pad;
  const top = Math.round(cy - side / 2) + pad;
  // Two-step: materialize the extended image first, THEN extract — otherwise
  // sharp validates the extract box against the pre-extend dimensions.
  const extended = await sharp(path).extend({ top: pad, bottom: pad, left: pad, right: pad, background: BG }).toBuffer();
  let img = sharp(extended)
    .extract({ left, top, width: side, height: side })
    .resize(SIZE, SIZE, { fit: 'fill' });
  let buf;
  if (MASK && process.env.DROPPED !== '1') {
    // Keep only the disc: circular alpha mask at the detected radius (a hair
    // beyond, so the outermost ring stroke isn't clipped), transparent outside.
    const maskR = Math.min(SIZE / 2 - 1, Math.round((SIZE / 2) * (1.03 / PAD)));
    const mask = Buffer.from(
      `<svg width="${SIZE}" height="${SIZE}"><circle cx="${SIZE / 2}" cy="${SIZE / 2}" r="${maskR}" fill="#fff"/></svg>`
    );
    buf = await img.ensureAlpha().composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
  } else {
    buf = await img.removeAlpha().png().toBuffer();
  }
  kept.push({ file: f, buf });
}
console.log(`Circle-centered ${detected}/${entries.length} (rest center-fallback).`);

// WhatsApp/most previews show the FIRST frame as the static resting image, so
// promote a visually striking plate to the front (default: the vivid Sacramentum
// wheel). Override with HERO=plate-NN.jpg.
const HERO = process.env.HERO || 'plate-55.jpg';
const heroIdx = kept.findIndex(k => k.file === HERO);
if (heroIdx > 0) { const [h] = kept.splice(heroIdx, 1); kept.unshift(h); }
console.log(`Resting frame: ${kept[0]?.file}${heroIdx < 0 ? ` (HERO ${HERO} not in set; using reading order)` : ''}`);

// The CLOSER is the last reel circle — it crossfades into the concentric-ring
// logo, so it should itself read as clean concentric rings. Default: orange disc.
const CLOSER = process.env.CLOSER || 'plate-24.jpg';
const closerIdx = kept.findIndex(k => k.file === CLOSER);
if (closerIdx > 0) { const [c] = kept.splice(closerIdx, 1); kept.push(c); }
console.log(`Closing frame: ${kept[kept.length - 1]?.file}${closerIdx < 0 ? ` (CLOSER ${CLOSER} not in set; using reel order)` : ''}`);
const frames = kept.map(k => k.buf);

if (OUTRO) {
  // Branded, opaque version. The reel's last circle resolves into the Source
  // Library concentric-circle ICON at the same radius as the reel circles; the
  // icon then shrinks up while the wordmark fades in beneath it.
  const ICON = 'public/brand/png/icon-only--white-on-transparent--512h.png';
  const WORD = 'public/brand/png/wordmark-only--white-on-transparent--512h.png';
  const ease = (t) => t * t * (3 - 2 * t);
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp01 = (x) => Math.max(0, Math.min(1, x));

  const darkBase = await sharp({ create: { width: SIZE, height: SIZE, channels: 3, background: DARK } }).png().toBuffer();
  const onDark = (buf) => sharp(darkBase).composite([{ input: buf }]).png().toBuffer();
  // Trim transparent padding so the icon's outer ring sits at the buffer edge
  // (then width == outer-circle diameter, matching the reel discs exactly).
  const iconMaster = await sharp(ICON).trim().toBuffer();
  const wordMaster = await sharp(WORD).trim().toBuffer();

  async function withAlpha(buf, f) {
    if (f >= 1) return buf;
    const m = await sharp(buf).metadata();
    const mask = Buffer.from(`<svg width="${m.width}" height="${m.height}"><rect width="100%" height="100%" fill="#fff" fill-opacity="${f}"/></svg>`);
    return sharp(buf).ensureAlpha().composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
  }
  async function layer(src, width, cx, cy, alpha = 1) {
    let b = await sharp(src).resize({ width: Math.max(2, Math.round(width)) }).png().toBuffer();
    if (alpha < 1) b = await withAlpha(b, alpha);
    const m = await sharp(b).metadata();
    return { input: b, left: Math.round(cx - m.width / 2), top: Math.round(cy - m.height / 2) };
  }
  const compose = (layers) => sharp(darkBase).composite(layers).png().toBuffer();

  // Geometry: icon starts matching the reel circle radius, ends small & high;
  // wordmark settles just below it.
  const reelR = Math.min(SIZE / 2 - 1, Math.round((SIZE / 2) * (1.03 / PAD)));
  const iconStartW = 2 * reelR;
  const iconFinalW = Math.round(SIZE * 0.22);
  const iconFinalCY = Math.round(SIZE * 0.40);
  const wordW = Math.round(SIZE * 0.46);
  const wordCY = Math.round(SIZE * 0.585);
  const CX = SIZE / 2;

  const mainFrames = await Promise.all(frames.map(onDark));
  const lastDisc = frames[frames.length - 1]; // transparent disc

  if (WARP) {
    // Ending built from ONE operator — the swirl warp — so every transition
    // shares the same visual language: the man twists into the vortex, the
    // vortex IS twisted sunburst stripes (spinning), the vortexed eye grows out
    // of the center, and the whole thing untwists into the clean eye.
    const R = reelR, cx = CX, cy = CX;

    // Final figure: the spiral resolves into this disc — first at full vortex
    // twist, then untwisting into the clean figure (the Microcosmus man).
    const FINAL = process.env.FINAL || 'plate-24.jpg';
    const finalEntry = kept.find(k => k.file === FINAL) || kept[kept.length - 1];
    const MAXS = Number(process.env.SWIRL || 6.5); // max twist (radians) at disc center
    // Swirl-warp factory. `profile(u)` (u = r/R) shapes WHERE the twist lives:
    // default is center-max/rim-zero; the eye uses a banded profile that keeps
    // the central eye zone AND the rim stable while the middle annulus swirls.
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
    const swirlMan = await makeSwirler(finalEntry.buf);

    // Sunburst stripe disc: radial sectors that, once run through the same
    // swirl warp, become the hypnotic spiral — no separate procedural pattern,
    // so the man->spiral->eye handoffs are all the same transform.
    const SECTORS = Number(process.env.SECTORS || 9); // white/dark stripe pairs
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

    // Eye disc: engraved all-seeing eye, masked to the reel circle.
    const EYE = process.env.EYE || '';
    let eyeDisc = null, swirlEye = null;
    if (EYE && existsSync(EYE)) {
      const det = await detectCircle(EYE);
      const side = Math.max(2, Math.round(2 * det.r * PAD));
      const pad = side;
      const extended = await sharp(EYE).extend({ top: pad, bottom: pad, left: pad, right: pad, background: BG }).toBuffer();
      const maskR = Math.min(SIZE / 2 - 1, Math.round((SIZE / 2) * (1.03 / PAD)));
      const eyeMask = Buffer.from(`<svg width="${SIZE}" height="${SIZE}"><circle cx="${SIZE / 2}" cy="${SIZE / 2}" r="${maskR}" fill="#fff"/></svg>`);
      eyeDisc = await sharp(extended)
        .extract({ left: Math.round(det.cx - side / 2) + pad, top: Math.round(det.cy - side / 2) + pad, width: side, height: side })
        .resize(SIZE, SIZE, { fit: 'fill' })
        .ensureAlpha().composite([{ input: eyeMask, blend: 'dest-in' }]).png().toBuffer();
      // Banded twist profile: dead-zero under the eye itself (u < EYE_STABLE),
      // peak twist in the middle annulus, easing back to zero at the rim — the
      // eye stays a stable engraving while the vortex rages around it.
      const EYE_STABLE = Number(process.env.EYE_STABLE || 0.22);
      const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
      const band = (u) => smooth(EYE_STABLE, 0.55, u) * (1 - u) * (1 - u);
      let peak = 0; for (let u = 0; u <= 1; u += 0.001) peak = Math.max(peak, band(u));
      swirlEye = await makeSwirler(eyeDisc, (u) => band(u) / peak);
      console.log(`Eye disc: ${EYE} conf=${det.conf.toFixed(2)} r=${det.r.toFixed(0)}`);
    }

    // Soft-edged radial reveal: keep only the central rr of a frame.
    async function centerReveal(buf, rr) {
      const m = await sharp(Buffer.from(
        `<svg width="${SIZE}" height="${SIZE}"><circle cx="${cx}" cy="${cy}" r="${Math.max(1, rr)}" fill="#fff"/></svg>`
      )).blur(12).png().toBuffer();
      return sharp(buf).ensureAlpha().composite([{ input: m, blend: 'dest-in' }]).png().toBuffer();
    }

    const K1 = 14; // man twists in
    const K2 = 4;  // vortexed man -> vortexed stripes
    const K3 = 12; // stripes spin at full twist
    const K4 = 10; // vortexed eye grows out of the center (stripes keep spinning)
    const K5 = 14; // untwist into the clean eye
    const dS = (2 * Math.PI) / 26; // spin per frame
    let spin = 0;
    const outro = [], outroDelays = [];

    // Brief hold on the clean man before the twist grabs him.
    outro.push(await onDark(finalEntry.buf));
    outroDelays.push(T(700));
    for (let i = 1; i <= K1; i++) {
      const te = ease(i / K1);
      outro.push(await onDark(await swirlMan(MAXS * te)));
      outroDelays.push(T(60));
    }
    // Same twist, same spin state on both discs — the blend is between two
    // near-identical vortex fields, so it reads as one continuous warp.
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
    if (swirlEye) {
      // The eye grows out of the spiral's center. The eye layer NEVER spins —
      // its banded profile keeps the center rock-stable — while its middle
      // annulus tightens slightly each frame so the vortex around the eye
      // stays alive against the spinning stripes behind it.
      const DRIFT = 0.30; // extra annulus twist per reveal frame (radians)
      let A = MAXS;
      for (let i = 1; i <= K4; i++) {
        const te = ease(i / K4); spin += dS; A += DRIFT;
        const base = await swirlSun(MAXS, spin);
        const eyeV = await swirlEye(A, 0);
        outro.push(await compose([
          await layer(base, SIZE, cx, cy, 1),
          await layer(await centerReveal(eyeV, te * R * 1.15), SIZE, cx, cy, 1),
        ]));
        outroDelays.push(T(55));
      }
      // Untwist: the annulus unwinds to zero around the already-stable eye.
      for (let i = 1; i <= K5; i++) {
        const te = ease(i / K5);
        outro.push(await onDark(await swirlEye(A * (1 - te), 0)));
        outroDelays.push(T(60));
      }
      outro.push(await onDark(eyeDisc));
      outroDelays.push(T(2600)); // hold on the eye
    }

    const seq = [...mainFrames, ...outro];
    const delays = [...mainFrames.map(() => T(DELAY)), ...outroDelays];
    await sharp(seq, { join: { animated: true } }).gif({ loop: 0, delay: delays, effort: 8, colours: COLOURS }).toFile(OUT);
    console.log('wrote', OUT, 'with', seq.length, 'frames (', mainFrames.length, 'circles + warp )');
    const webpOut = OUT.replace(/\.gif$/, '.webp');
    await sharp(seq, { join: { animated: true } }).webp({ loop: 0, delay: delays, effort: 6, quality: 90 }).toFile(webpOut);
    console.log('wrote', webpOut);
    process.exit(0);
  }

  // Crossfade: last reel circle → icon at reel radius (both centered, same size).
  const K1 = 6, crossfade = [];
  for (let i = 1; i <= K1; i++) {
    const te = ease(i / K1);
    crossfade.push(await compose([
      await layer(lastDisc, SIZE, CX, CX, 1 - te),
      await layer(iconMaster, iconStartW, CX, CX, te),
    ]));
  }

  // Shrink the icon up to its final size while the wordmark fades in.
  const K2 = 18, shrink = [];
  for (let i = 1; i <= K2; i++) {
    const t = i / K2, te = ease(t);
    const iw = lerp(iconStartW, iconFinalW, te);
    const icy = lerp(CX, iconFinalCY, te);
    const wmOp = ease(clamp01((t - 0.25) / 0.7));
    const layers = [await layer(iconMaster, iw, CX, icy, 1)];
    if (wmOp > 0.01) layers.push(await layer(wordMaster, wordW, CX, wordCY, wmOp));
    shrink.push(await compose(layers));
  }

  const hold = await compose([
    await layer(iconMaster, iconFinalW, CX, iconFinalCY, 1),
    await layer(wordMaster, wordW, CX, wordCY, 1),
  ]);

  const seq = [...mainFrames, ...crossfade, ...shrink, hold];
  const delays = [
    ...mainFrames.map(() => T(DELAY)),
    ...crossfade.map(() => T(55)),
    ...shrink.map(() => T(60)),
    T(2200), // hold on the finished logo
  ];

  await sharp(seq, { join: { animated: true } })
    .gif({ loop: 0, delay: delays, effort: 8, colours: COLOURS })
    .toFile(OUT);
  console.log('wrote', OUT, 'with', seq.length, 'frames (', mainFrames.length, 'circles + outro )');
  const webpOut = OUT.replace(/\.gif$/, '.webp');
  await sharp(seq, { join: { animated: true } })
    .webp({ loop: 0, delay: delays, effort: 6, quality: 90 })
    .toFile(webpOut);
  console.log('wrote', webpOut);
  process.exit(0);
}

await sharp(frames, { join: { animated: true } })
  .gif({ loop: 0, delay: DELAY, effort: 8, colours: COLOURS })
  .toFile(OUT);
console.log('wrote', OUT, 'with', frames.length, 'frames');

if (MASK) {
  // Smooth-alpha animated version (GIF transparency is only 1-bit).
  const webpOut = OUT.replace(/\.gif$/, '.webp');
  await sharp(frames, { join: { animated: true } })
    .webp({ loop: 0, delay: DELAY, effort: 6, quality: 90, alphaQuality: 100 })
    .toFile(webpOut);
  console.log('wrote', webpOut);
  // Individual transparent circle PNGs for reuse.
  const { mkdirSync, writeFileSync, rmSync } = await import('node:fs');
  const dir = OUT.replace(/\.gif$/, '-pngs');
  rmSync(dir, { recursive: true, force: true }); // clear stale PNGs from prior runs
  mkdirSync(dir, { recursive: true });
  kept.forEach((k, i) => {
    const stem = k.file.replace(/\.(jpe?g|png)$/i, '');
    writeFileSync(join(dir, `circle-${String(i + 1).padStart(2, '0')}_${stem}.png`), k.buf);
  });
  console.log('wrote', kept.length, 'transparent PNGs to', dir);
}

// Montage for visual QA of circle alignment: a grid of all centered frames,
// labeled with the source plate so off-center ones are easy to identify.
const TILE = 150, COLS = 6;
const rows = Math.ceil(frames.length / COLS);
const tiles = await Promise.all(kept.map(async (k, i) => {
  const stem = k.file.replace(/\.(jpe?g|png)$/i, '');
  const lbl = Buffer.from(`<svg width="${TILE}" height="18"><rect width="100%" height="100%" fill="black" fill-opacity="0.6"/><text x="3" y="14" font-family="sans-serif" font-size="12" fill="#fff">${i + 1} ${stem}</text></svg>`);
  return sharp(k.buf).resize(TILE, TILE).composite([{ input: lbl, top: TILE - 18, left: 0 }]).toBuffer();
}));
const composites = tiles.map((input, i) => ({ input, left: (i % COLS) * TILE, top: Math.floor(i / COLS) * TILE }));
await sharp({ create: { width: COLS * TILE, height: rows * TILE, channels: 3, background: { r: 30, g: 26, b: 34 } } })
  .composite(composites)
  .png()
  .toFile(OUT.replace(/\.gif$/, '-montage.png'));
console.log('wrote montage', OUT.replace(/\.gif$/, '-montage.png'));
