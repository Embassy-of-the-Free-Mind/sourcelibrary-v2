#!/usr/bin/env node
// #6740 read-surface, Amendment 6: the paper figures F1–F5 as SVG + PNG (no titles baked in; captions in
// figures/CAPTIONS.md). F6 (page crops) is figure-f6.mjs.
//
// PRIOR ART: src/app/platform/(protected)/admin/ocr-evidence/read-surface/SurfaceCharts.tsx (the admin page's React
//   charts of the same surfaces: dark admin tokens, interactive, not paper figures); scripts/eval/lib/pareto-stats.mjs
//   (the frontier of routes, no plotting). Nothing in scripts/ writes static figures; this uses sharp (already a
//   dependency) to rasterise SVG, since the box has no plotting library.
//
//   node scripts/eval/read-surface-6740/figures.mjs --surface=FILE --runs=DIR/runs.json --out=scripts/eval/read-surface-6740/figures
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const S = JSON.parse(fs.readFileSync(arg('surface'), 'utf8'));
const OUT = path.resolve(arg('out', 'figures'));
const RUNS_DIR = arg('rundirs');   // WORK/runs: run.json started_at gives the run order
fs.mkdirSync(OUT, { recursive: true });

// Light paper palette (dataviz reference instance): ink, muted, grid; series-1 blue for the optimum, series-2 orange for
// live; one blue ramp (light = low) for magnitudes. Validated with the skill's validate_palette.js (see CAPTIONS.md).
const INK = '#0b0b0b', SEC = '#52514e', MUTED = '#898781', GRID = '#e4e3df', SURF = '#ffffff';
const OPT = '#2a78d6', LIVE = '#eb6834';
const RAMP = ['#e9f1fc', '#cde2fb', '#b7d3f6', '#9ec5f4', '#86b6ef', '#6da7ec', '#5598e7', '#3987e5', '#2a78d6', '#256abf', '#1c5cab', '#184f95', '#104281', '#0d366b'];
const FONT = "font-family='DejaVu Sans, Helvetica, Arial, sans-serif'";
const LANG = { de: 'German (DTA, 35 books)', la: 'Latin (CAMENA, 34 books)' };
const T = (x, y, s, { size = 12, fill = INK, anchor = 'start', weight = 400, rot = 0 } = {}) => `<text x='${x}' y='${y}' ${FONT} font-size='${size}' fill='${fill}' text-anchor='${anchor}' font-weight='${weight}'${rot ? ` transform='rotate(${rot} ${x} ${y})'` : ''}>${String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text>`;
const svgDoc = (w, h, body) => `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}'><rect width='${w}' height='${h}' fill='${SURF}'/>${body}</svg>`;
async function save(name, svg) {
  fs.writeFileSync(path.join(OUT, `${name}.svg`), svg);
  await sharp(Buffer.from(svg), { density: 216 }).png().toFile(path.join(OUT, `${name}.png`));
  console.log(`${name}.svg/.png`);
}
const terms = ([a, b, c]) => [1, a, b, c, a * b, a * c, b * c, a * a, b * b, c * c];
const pred = (coef, x) => terms(x).reduce((s, t, i) => s + t * coef[i].b, 0);
const LEVELS = S.levels;
const thinkName = (c) => LEVELS.think[c + 1];
const langs = Object.keys(S.langs);

// ── marching squares: the line z = level over a grid z[j][i] at axis coords ──
function contour(z, axis, level) {
  const segs = [], n = axis.length;
  const lerp = (a, b, za, zb) => a + ((level - za) / (zb - za)) * (b - a);
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
    const x0 = axis[i], x1 = axis[i + 1], y0 = axis[j], y1 = axis[j + 1];
    const a = z[j][i], b = z[j][i + 1], c = z[j + 1][i + 1], d = z[j + 1][i];
    const pts = [];
    if ((a > level) !== (b > level)) pts.push([lerp(x0, x1, a, b), y0]);
    if ((b > level) !== (c > level)) pts.push([x1, lerp(y0, y1, b, c)]);
    if ((d > level) !== (c > level)) pts.push([lerp(x0, x1, d, c), y1]);
    if ((a > level) !== (d > level)) pts.push([x0, lerp(y0, y1, a, d)]);
    if (pts.length === 2) segs.push(pts); else if (pts.length === 4) segs.push([pts[0], pts[1]], [pts[2], pts[3]]);
  }
  return segs;
}
const bilinear = (z, axis, a, b) => {
  const n = axis.length, f = (v) => Math.min(n - 1.0001, Math.max(0, ((v + 1) / 2) * (n - 1)));
  const fi = f(a), fj = f(b), i = Math.floor(fi), j = Math.floor(fj), u = fi - i, w = fj - j;
  return z[j][i] * (1 - u) * (1 - w) + z[j][i + 1] * u * (1 - w) + z[j + 1][i] * (1 - u) * w + z[j + 1][i + 1] * u * w;
};

// ── a panel of a fitted response over (pages a call × long edge) at one thinking level ──
function panel(ox, oy, w, h, { lang, c, zOf, bands, fmt, showNI, showOpt, label }) {
  const L = S.langs[lang];
  const sx = (a) => ox + ((a + 1) / 2) * w, sy = (b) => oy + h - ((b + 1) / 2) * h;
  let g = '';
  const R = 48;
  for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) {
    const a = -1 + (2 * (i + 0.5)) / R, b = -1 + (2 * (j + 0.5)) / R;
    const z = zOf([a, b, c]);
    let k = bands.findIndex((t) => z < t); if (k < 0) k = bands.length;
    g += `<rect x='${(sx(a) - w / R / 2).toFixed(2)}' y='${(sy(b) - h / R / 2).toFixed(2)}' width='${(w / R + 0.4).toFixed(2)}' height='${(h / R + 0.4).toFixed(2)}' fill='${RAMP[Math.min(RAMP.length - 1, Math.round((k * (RAMP.length - 1)) / bands.length))]}'/>`;
  }
  if (showNI && L.ni_slice) {
    const hi = L.ni_slice.find((s) => s.x3 === c).hi;
    // The infeasible side (δ upper bound > margin) hatched.
    for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) {
      const a = -1 + (2 * (i + 0.5)) / R, b = -1 + (2 * (j + 0.5)) / R;
      if (bilinear(hi, L.axis, a, b) > S.margin_pp / 100) g += `<rect x='${(sx(a) - w / R / 2).toFixed(2)}' y='${(sy(b) - h / R / 2).toFixed(2)}' width='${(w / R + 0.4).toFixed(2)}' height='${(h / R + 0.4).toFixed(2)}' fill='url(#hatch)'/>`;
    }
    for (const [[x1, y1], [x2, y2]] of contour(hi, L.axis, S.margin_pp / 100)) g += `<line x1='${sx(x1)}' y1='${sy(y1)}' x2='${sx(x2)}' y2='${sy(y2)}' stroke='${INK}' stroke-width='2' stroke-dasharray='5 3'/>`;
  }
  g += `<rect x='${ox}' y='${oy}' width='${w}' height='${h}' fill='none' stroke='${MUTED}' stroke-width='1'/>`;
  // design points at this level
  for (const r of L.runs.filter((r) => r.x[2] === c && r.in_fit)) {
    const hollow = r.pool !== 'default';
    g += `<circle cx='${sx(r.x[0])}' cy='${sy(r.x[1])}' r='5' fill='${hollow ? SURF : INK}' stroke='${INK}' stroke-width='2'/>`;
    g += T(sx(r.x[0]) + (r.x[0] === 1 ? -8 : 8), sy(r.x[1]) + (r.x[1] === 1 ? 14 : -7), `${r.id.replace(/^C\d$/, 'C')} ${fmt(r)}`, { size: 10, fill: INK, anchor: r.x[0] === 1 ? 'end' : 'start' });
  }
  if (c === -1) {
    // live: 4 a call, image as served (median served long edge ≈ 2,350 px ≈ coded +0.94), thinking low
    const lx = sx(0), ly = sy(0.94);
    g += `<rect x='${lx - 6}' y='${ly - 6}' width='12' height='12' fill='${LIVE}' stroke='${SURF}' stroke-width='2' transform='rotate(45 ${lx} ${ly})'/>`;
  }
  const opt = L.optimum.setting;
  if (showOpt && opt && opt.x[2] === c) {
    const cx = sx(opt.x[0]), cy = sy(opt.x[1]);
    const star = Array.from({ length: 10 }, (_, k) => { const r = k % 2 ? 4 : 10, t = (Math.PI / 5) * k - Math.PI / 2; return `${(cx + r * Math.cos(t)).toFixed(1)},${(cy + r * Math.sin(t)).toFixed(1)}`; }).join(' ');
    g += `<polygon points='${star}' fill='${OPT}' stroke='${SURF}' stroke-width='1.5'/>`;
  }
  // axes
  for (const [k, v] of LEVELS.ppc.entries()) g += T(sx(k - 1), oy + h + 15, v, { size: 11, fill: SEC, anchor: 'middle' });
  for (const [k, v] of LEVELS.edge.entries()) g += T(ox - 6, sy(k - 1) + 4, v, { size: 11, fill: SEC, anchor: 'end' });
  g += T(ox + w / 2, oy - 8, label, { size: 12, fill: INK, anchor: 'middle', weight: 600 });
  return g;
}
const defs = `<defs><pattern id='hatch' width='6' height='6' patternUnits='userSpaceOnUse' patternTransform='rotate(45)'><rect width='6' height='6' fill='#ffffff' fill-opacity='0.55'/><line x1='0' y1='0' x2='0' y2='6' stroke='${SEC}' stroke-width='1.2'/></pattern></defs>`;
function legendBar(x, y, bands, fmt, title) {
  let g = T(x, y - 6, title, { size: 11, fill: SEC });
  const n = bands.length + 1, bw = 34;
  for (let k = 0; k < n; k++) g += `<rect x='${x + k * bw}' y='${y}' width='${bw - 2}' height='10' fill='${RAMP[Math.min(RAMP.length - 1, Math.round((k * (RAMP.length - 1)) / bands.length))]}'/>`;
  for (const [k, t] of bands.entries()) g += T(x + (k + 1) * bw - 1, y + 22, fmt(t), { size: 9, fill: SEC, anchor: 'middle' });
  return g;
}
function grid6(name, { zOf, bands, fmt, legend, legendFmt, showNI = false, showOpt = false, keyText }) {
  const w = 190, h = 160, gx = 70, gy = 52, W = 3 * w + 2 * gx + 110, H = langs.length * (h + gy) + 120;
  let g = defs;
  langs.forEach((lang, li) => {
    const oy = 40 + li * (h + gy);
    g += T(14, oy + h / 2, LANG[lang], { size: 12, weight: 600, rot: -90, anchor: 'middle' });
    [-1, 0, 1].forEach((c, ci) => { g += panel(80 + ci * (w + gx), oy, w, h, { lang, c, zOf: (x) => zOf(lang, x), bands: bands(lang), fmt: (r) => fmt(lang, r), showNI, showOpt, label: `thinking ${thinkName(c)}` }); });
  });
  const by = langs.length * (h + gy) + 40;
  g += T(80 + (3 * w + 2 * gx) / 2, by - 12, 'pages a call', { size: 11, fill: SEC, anchor: 'middle' });
  g += T(34, 40 + h / 2, 'image long edge (px)', { size: 11, fill: SEC, rot: -90, anchor: 'middle' });
  g += legendBar(80, by + 20, bands(langs[0]), legendFmt, legend);
  g += T(80 + 3 * w + 2 * gx - 300, by + 30, keyText, { size: 10, fill: SEC });
  return save(name, svgDoc(W, H, g));
}

// ── F1: the design cube ──
async function f1() {
  const L = S.langs.de;
  const order = [];
  if (RUNS_DIR) for (const lang of langs) for (const id of fs.readdirSync(path.join(RUNS_DIR, lang))) {
    try { const r = JSON.parse(fs.readFileSync(path.join(RUNS_DIR, lang, id, 'run.json'), 'utf8')); order.push({ lang, id, t: Date.parse(r.started_at) }); } catch { /* not a run */ }
  }
  const first = new Map();
  for (const o of order.sort((a, b) => a.t - b.t)) if (!first.has(o.id)) first.set(o.id, first.size);
  const W = 560, H = 470, cx = 270, cy = 250, s = 120;
  // oblique projection: x1 right, x2 depth (up-right), x3 up
  const P = ([a, b, c]) => [cx + s * a + 0.55 * s * b * Math.cos(Math.PI / 6), cy - s * c - 0.55 * s * b * Math.sin(Math.PI / 6)];
  let g = '';
  const corners = []; for (const a of [-1, 1]) for (const b of [-1, 1]) for (const c of [-1, 1]) corners.push([a, b, c]);
  for (const p of corners) for (const q of corners) { const d = p.reduce((n, v, i) => n + (v !== q[i]), 0); if (d === 1 && p.join() < q.join()) { const [x1, y1] = P(p), [x2, y2] = P(q); const back = p[1] === 1 && q[1] === 1 || p[0] === -1 && q[0] === -1 && p[2] === -1 && q[2] === -1; g += `<line x1='${x1}' y1='${y1}' x2='${x2}' y2='${y2}' stroke='${back ? GRID : MUTED}' stroke-width='1.2'/>`; } }
  const pts = L.runs.filter((r) => !r.live && r.x[1] !== null && !r.id.startsWith('D'));
  const n = Math.max(1, first.size - 1);
  const col = (id) => RAMP[2 + Math.round(((first.get(id) ?? 0) / n) * (RAMP.length - 3))];
  for (const r of pts.sort((a, b) => b.x[1] - a.x[1])) {
    const [x, y] = P(r.x); const isC = r.id.startsWith('C');
    if (isC && r.id !== 'C1') continue;
    g += `<circle cx='${x}' cy='${y}' r='${r.id.startsWith('X') ? 6 : 8}' fill='${col(r.id)}' stroke='${r.id.startsWith('X') ? INK : SURF}' stroke-width='2'${r.id.startsWith('X') ? " stroke-dasharray='2 2'" : ''}/>`;
    g += T(x + 10, y - 8, isC ? 'C1–C3' : r.id, { size: 10, fill: INK });
  }
  const [lx, ly] = P([0, 0.94, -1]);
  g += `<rect x='${lx - 7}' y='${ly - 7}' width='14' height='14' fill='${LIVE}' stroke='${SURF}' stroke-width='2' transform='rotate(45 ${lx} ${ly})'/>` + T(lx + 12, ly + 16, 'live', { size: 10, fill: INK });
  // axis labels
  const lab = (p, s2, anchor = 'middle') => { const [x, y] = P(p); return T(x, y, s2, { size: 11, fill: SEC, anchor }); };
  g += lab([-1, -1.25, -1.25], '1') + lab([0, -1.25, -1.25], '4') + lab([1, -1.25, -1.25], '8') + lab([0, -1.25, -1.55], 'pages a call');
  g += lab([1.2, -1, -1.12], '1,024', 'start') + lab([1.2, 0, -1.12], '1,600', 'start') + lab([1.2, 1, -1.12], '2,400', 'start') + lab([1.55, 0, -0.85], 'long edge (px)', 'start');
  g += lab([-1.15, -1, -1], 'low', 'end') + lab([-1.15, -1, 0], 'medium', 'end') + lab([-1.15, -1, 1], 'high', 'end') + T(28, P([-1, -1, 0])[1], 'thinking', { size: 11, fill: SEC, rot: -90, anchor: 'middle' });
  g += legendBar(330, 30, Array.from({ length: 5 }, (_, k) => k), () => '', 'run order: first → last');
  return save('f1-design-cube', svgDoc(W, H, g));
}

// ── F5: cost against accuracy ──
async function f5() {
  const w = 330, h = 280, W = langs.length * (w + 90) + 40, H = h + 110;
  let g = '';
  langs.forEach((lang, li) => {
    const L = S.langs[lang], ox = 70 + li * (w + 90), oy = 30;
    const rs = L.runs;
    const xmax = Math.max(...rs.map((r) => r.usd_hi)) * 1.05, ymin = Math.min(0, ...rs.map((r) => 100 * r.delta_lo)) - 0.1, ymax = Math.max(...rs.map((r) => 100 * r.delta_hi)) + 0.1;
    const X = (v) => ox + (v / xmax) * w, Y = (v) => oy + h - ((v - ymin) / (ymax - ymin)) * h;
    for (let v = 0; v <= xmax; v += xmax > 60 ? 20 : 10) g += `<line x1='${X(v)}' y1='${oy}' x2='${X(v)}' y2='${oy + h}' stroke='${GRID}'/>` + T(X(v), oy + h + 15, `$${v}`, { size: 10, fill: SEC, anchor: 'middle' });
    for (let v = Math.ceil(ymin * 2) / 2; v <= ymax; v += 0.5) g += `<line x1='${ox}' y1='${Y(v)}' x2='${ox + w}' y2='${Y(v)}' stroke='${GRID}'/>` + T(ox - 6, Y(v) + 3, `${v > 0 ? '+' : ''}${v.toFixed(1)}`, { size: 10, fill: SEC, anchor: 'end' });
    // noise floor: the A-vs-A band (centre replicates) around zero; the margin line at +1 pp
    const band = L.noise.band_pp;
    if (band) g += `<rect x='${ox}' y='${Y(band)}' width='${w}' height='${Y(-band) - Y(band)}' fill='${MUTED}' fill-opacity='0.16'/>`;
    g += `<line x1='${ox}' y1='${Y(S.margin_pp)}' x2='${ox + w}' y2='${Y(S.margin_pp)}' stroke='${INK}' stroke-dasharray='5 3' stroke-width='1.5'/>` + T(ox + w - 2, Y(S.margin_pp) - 4, 'margin +1 pp', { size: 9, fill: SEC, anchor: 'end' });
    // Pareto front
    const fr = rs.filter((r) => L.pareto.includes(r.id)).sort((a, b) => a.usd - b.usd);
    g += `<polyline points='${fr.map((r) => `${X(r.usd)},${Y(100 * r.delta)}`).join(' ')}' fill='none' stroke='${OPT}' stroke-width='2' stroke-opacity='0.6'/>`;
    for (const r of rs) {
      const x = X(r.usd), y = Y(100 * r.delta), opt = L.optimum.setting && r.x.join() === L.optimum.setting.x.join();
      g += `<line x1='${X(r.usd_lo)}' y1='${y}' x2='${X(r.usd_hi)}' y2='${y}' stroke='${MUTED}'/><line x1='${x}' y1='${Y(100 * r.delta_lo)}' x2='${x}' y2='${Y(100 * r.delta_hi)}' stroke='${MUTED}'/>`;
      if (r.live) g += `<rect x='${x - 6}' y='${y - 6}' width='12' height='12' fill='${LIVE}' stroke='${SURF}' stroke-width='2' transform='rotate(45 ${x} ${y})'/>`;
      else g += `<circle cx='${x}' cy='${y}' r='${opt ? 7 : 5}' fill='${opt ? OPT : r.pool === 'default' ? INK : SURF}' stroke='${opt ? SURF : INK}' stroke-width='${opt ? 2 : 1.5}'/>`;
      g += T(x + 7, y - 5, r.id, { size: 9, fill: SEC });
    }
    g += `<rect x='${ox}' y='${oy}' width='${w}' height='${h}' fill='none' stroke='${MUTED}'/>`;
    g += T(ox + w / 2, oy - 10, LANG[lang], { size: 12, weight: 600, anchor: 'middle' });
    g += T(ox + w / 2, oy + h + 32, 'quota cost, US $ a 1,000 pages (list-price equivalent)', { size: 11, fill: SEC, anchor: 'middle' });
    g += T(ox - 44, oy + h / 2, 'δ CER against live (pp)', { size: 11, fill: SEC, rot: -90, anchor: 'middle' });
  });
  g += T(70, H - 22, 'filled: default pool · open: .agy-james pool · orange diamond: live · blue line: Pareto front · grey band: A-vs-A noise floor (centre replicates)', { size: 10, fill: SEC });
  return save('f5-cost-vs-accuracy', svgDoc(W, H, g));
}

const coefOf = (lang, k) => S.langs[lang].fits[k].coef;
const nice = (lo, hi, n) => Array.from({ length: n - 1 }, (_, i) => lo + ((hi - lo) * (i + 1)) / n);
// One colour scale for both languages, so a band means the same value in every panel.
const rangeOf = (_lang, k) => { const z = langs.flatMap((l) => S.langs[l].slices[k].flatMap((s) => s.z.flat())); return [Math.min(...z), Math.max(...z)]; };
async function main() {
  await f1();
  if (!S.langs.de.fits?.cer) { console.log('design incomplete: F2–F4 need the 15-run fit'); await f5(); return; }
  const cerBands = (lang) => { const [lo, hi] = rangeOf(lang, 'cer'); return nice(Math.max(0, lo), hi, 9); };
  await grid6('f2-cer-contours', { zOf: (lang, x) => pred(coefOf(lang, 'cer'), x), bands: cerBands, fmt: (lang, r) => `${(100 * r.cer).toFixed(2)}%`, legend: 'predicted CER (%)', legendFmt: (t) => (100 * t).toFixed(1), showNI: true, keyText: 'dots: design runs (filled default pool, open .agy-james) · diamond: live · dashed: δ CER upper 95 % = +1 pp' });
  const usdBands = (lang) => { const [lo, hi] = rangeOf(lang, 'usd'); return nice(Math.max(0, lo), hi, 9); };
  await grid6('f3-cost-contours', { zOf: (lang, x) => pred(coefOf(lang, 'usd'), x), bands: usdBands, fmt: (lang, r) => `$${r.usd.toFixed(1)}`, legend: 'predicted quota cost (US $ a 1,000 pages)', legendFmt: (t) => t.toFixed(0), keyText: 'dots: design runs, measured cost · diamond: live' });
  await grid6('f4-feasible-cost', { zOf: (lang, x) => pred(coefOf(lang, 'usd'), x), bands: usdBands, fmt: (lang, r) => `$${r.usd.toFixed(1)}`, legend: 'predicted quota cost (US $ a 1,000 pages)', legendFmt: (t) => t.toFixed(0), showNI: true, showOpt: true, keyText: 'hatched: not shown non-inferior on CER · star: optimum · diamond: live' });
  await f5();
}
await main();
