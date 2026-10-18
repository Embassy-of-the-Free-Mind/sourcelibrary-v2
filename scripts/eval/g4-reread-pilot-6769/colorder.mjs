#!/usr/bin/env node
// PRIOR ART: scripts/audit/spread-screen.mjs and scripts/batch/spread-folds.mjs find the FOLD of a two-page spread (one
// gutter, from the binding's shadow); they do not find text columns inside a page. The #6769 colfix experiment
// (2026-10-16-g4l-hebrew-right-column-first-instruction-6769.md) showed a prompt cannot fix G4L's Hebrew column order
// and named two order CHECKS, neither built; this is the second one (locate each column's first lines in the read).
/**
 * #6769 column-order check for right-to-left books (Rashi / Hebrew): did a read give the text columns right to left?
 *
 *   node scripts/eval/g4-reread-pilot-6769/colorder.mjs sheet --img=page.jpg --out=DIR       # columns + strip sheet
 *   node scripts/eval/g4-reread-pilot-6769/colorder.mjs read-sheets --dir=SHEETS [--model=gemini-4-argon-low] [--concurrency=2]
 *   node scripts/eval/g4-reread-pilot-6769/colorder.mjs check --cols=DIR/cols.json --strips=strips.txt --read=read.txt
 *
 * sheet: finds the text columns (runs of x where the page has many ink/paper transitions down y — a column of lines —
 * and not a solid dark binding or blank paper), crops the first lines of each, and stacks the crops into ONE image,
 * each strip labelled with its number, numbered right to left. One model call transcribes the sheet ("1: …", "2: …").
 * check: finds each strip's text in the full read (Hebrew letters only, final forms folded, 3-gram offset voting) and
 * asks whether the located strips come in right-to-left order. A strip that is not found (a sliver of the facing page,
 * a misread) is left out, never guessed. Verdict: correct | reversed | undetermined (< 2 strips located).
 * Pure functions are exported for the scorer.
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { agyCall, installToolGate, CLI_SAFE_ARGS } from '../../lib/agy-cli.mjs';

const W = 1000; // analysis width

/** Text columns of a page image, right to left: [{x0, x1, y0, y1}] in ORIGINAL pixels. */
export async function findColumns(buf) {
  const meta = await sharp(buf, { limitInputPixels: false }).metadata();
  const scale = meta.width / W, H = Math.round(meta.height / scale);
  const g = await sharp(buf, { limitInputPixels: false }).resize(W, H, { fit: 'fill' }).greyscale().raw().toBuffer();
  const blur = await sharp(g, { raw: { width: W, height: H, channels: 1 } }).blur(12).raw().toBuffer();
  // ink = darker than its neighbourhood ON PAPER (a bright neighbourhood): letters, not the grain of a dark binding,
  // cardboard or the black surround, which flicker at 60+ transitions per 100 rows (a text column runs ~5–25).
  const ink = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) ink[i] = blur[i] > 110 && g[i] < blur[i] - 18 ? 1 : 0;
  // Per x: transitions down y in the middle band, per 100 rows. A column of text lines alternates ink and paper.
  const yA = Math.round(H * 0.08), yB = Math.round(H * 0.92);
  const dens = new Float64Array(W);
  for (let x = 0; x < W; x++) {
    let t = 0;
    for (let y = yA + 1; y < yB; y++) if (ink[y * W + x] !== ink[(y - 1) * W + x]) t++;
    dens[x] = (100 * t) / (yB - yA);
    if (dens[x] > 40) dens[x] = 0; // texture, not lines
  }
  const k = 4, sm = dens.map((_, x) => { let s = 0, n = 0; for (let j = Math.max(0, x - k); j <= Math.min(W - 1, x + k); j++) { s += dens[j]; n++; } return s / n; });
  const top = [...sm].sort((a, b) => b - a)[Math.floor(W * 0.1)];
  const thr = top * 0.35;
  const runs = [];
  for (let x = 0, s = -1; x <= W; x++) {
    const on = x < W && sm[x] > thr;
    if (on && s < 0) s = x;
    if (!on && s >= 0) { runs.push([s, x - 1]); s = -1; }
  }
  // Merge runs split by a dip narrower than 0.6% of the width (a word space aligned down the column), drop slivers.
  const merged = [];
  for (const r of runs) { const p = merged.at(-1); if (p && r[0] - p[1] < W * 0.006) p[1] = r[1]; else merged.push([...r]); }
  const cols = merged.filter(([a, b]) => b - a >= W * 0.06);
  const out = [];
  for (const [a, b] of cols) {
    // First and last text rows of this column: rows with ink in at least 8% of the column's width.
    const rowInk = (y) => { let s = 0; for (let x = a; x <= b; x++) s += ink[y * W + x]; return s / (b - a + 1); };
    let y0 = 0, y1 = H - 1;
    while (y0 < H && rowInk(y0) < 0.08) y0++;
    while (y1 > y0 && rowInk(y1) < 0.08) y1--;
    out.push({ x0: Math.round(a * scale), x1: Math.round(b * scale), y0: Math.round(y0 * scale), y1: Math.round(y1 * scale) });
  }
  return { width: meta.width, height: meta.height, columns: out.sort((p, q) => q.x0 - p.x0) };
}

/** The strip sheet: each column's first lines (STRIP_FRAC of the page height below its first ink row), numbered. */
export async function stripSheet(buf, columns, { height, frac = 0.07, startFrac = 0.03 } = {}) {
  const strips = [];
  for (const [i, c] of columns.entries()) {
    // Skip the first few % of the column: a running head or catchword sits there and is shared by every column.
    const top = Math.min(c.y1 - 1, c.y0 + Math.round(height * startFrac));
    const h = Math.max(20, Math.min(Math.round(height * frac), c.y1 - top));
    const img = await sharp(buf, { limitInputPixels: false }).extract({ left: c.x0, top, width: c.x1 - c.x0 + 1, height: h }).resize({ width: 1400, height: 400, fit: 'inside' }).jpeg({ quality: 90 }).toBuffer();
    const m = await sharp(img).metadata();
    strips.push({ n: i + 1, img, w: m.width, h: m.height, crop: { left: c.x0, top, width: c.x1 - c.x0 + 1, height: h } });
  }
  const LAB = 70, GAP = 30, sw = 1400 + LAB;
  const sh = strips.reduce((s, x) => s + x.h + GAP, GAP);
  const comps = []; let y = GAP;
  for (const s of strips) {
    const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${LAB}" height="${s.h}"><text x="8" y="${Math.min(s.h - 8, 50)}" font-family="DejaVu Sans, sans-serif" font-size="44" font-weight="bold" fill="#c00">${s.n}</text></svg>`);
    comps.push({ input: svg, left: 0, top: y }, { input: s.img, left: LAB, top: y });
    y += s.h + GAP;
  }
  const sheet = await sharp({ create: { width: sw, height: sh, channels: 3, background: 'white' } }).composite(comps).jpeg({ quality: 88 }).toBuffer();
  return { sheet, strips: strips.map(({ img, ...r }) => r) };
}

export const STRIP_PROMPT = (n) => `The attached image is a sheet of ${n} numbered strips (red numbers 1 to ${n} at the left). Each strip is a few lines cut from a Hebrew page printed in Rashi or square script.

For each strip, transcribe its text exactly as printed, its lines joined by spaces. Do not translate, do not expand abbreviations, do not add anything that is not printed.

Reply with exactly ${n} lines between the markers, one per strip, in number order, each starting with its number and a colon:
<<<BEGIN>>>
1: ...
<<<END>>>`;

/** Hebrew letters only, final forms folded, niqqud and everything else dropped. */
export function heb(t) {
  const fin = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };
  return [...String(t || '').normalize('NFD')].filter((c) => /[א-ת]/.test(c)).map((c) => fin[c] || c).join('');
}

/** Best offset of `needle` in `hay` by 3-gram offset voting: {pos (fraction of hay), score (share of needle grams)}. */
export function locate(needle, hay) {
  const a = heb(needle), r = heb(hay);
  if (a.length < 12 || r.length < 12) return null;
  const idx = new Map();
  for (let i = 0; i + 3 <= r.length; i++) { const g = r.slice(i, i + 3); (idx.get(g) || idx.set(g, []).get(g)).push(i); }
  const votes = new Map(), B = 8; // offsets bucketed: OCR insertions/deletions shift the alignment a little
  const ng = a.length - 2;
  for (let j = 0; j < ng; j++) for (const i of idx.get(a.slice(j, j + 3)) || []) { const o = Math.floor((i - j) / B); votes.set(o, (votes.get(o) || 0) + 1); }
  let best = null;
  for (const [o, v] of votes) { const s = v + (votes.get(o - 1) || 0) + (votes.get(o + 1) || 0); if (!best || s > best.s) best = { o, s }; }
  if (!best) return null;
  return { pos: Math.max(0, best.o * B) / r.length, score: Math.min(1, best.s / ng), at: Math.max(0, best.o * B) };
}

export function parseStrips(reply, n) {
  const body = (String(reply).match(/<<<\s*BEGIN\s*>>>([\s\S]*?)(<<<\s*END\s*>>>|$)/) || [])[1] ?? String(reply);
  const out = {};
  for (const l of body.split('\n')) { const m = l.match(/^\s*(\d+)\s*[:.)]\s*(.*)$/); if (m && +m[1] >= 1 && +m[1] <= n) out[+m[1]] = m[2].trim(); }
  return out;
}

/** Order verdict from located strips (numbered right to left): positions must increase with the strip number. */
export function orderVerdict(strips, read, { minScore = 0.25 } = {}) {
  const loc = Object.entries(strips).map(([n, t]) => ({ n: +n, ...(locate(t, read) || {}) })).filter((x) => x.score >= minScore).sort((p, q) => p.n - q.n);
  if (loc.length < 2) return { verdict: 'undetermined', located: loc };
  let inv = 0; for (let i = 1; i < loc.length; i++) if (loc[i].at < loc[i - 1].at) inv++;
  return { verdict: inv === 0 ? 'correct' : 'reversed', inversions: inv, located: loc };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
  const cmd = process.argv[2];
  if (cmd === 'sheet') {
    const buf = fs.readFileSync(arg('img')); const out = arg('out'); fs.mkdirSync(out, { recursive: true });
    const cols = await findColumns(buf);
    const { sheet, strips } = await stripSheet(buf, cols.columns, { height: cols.height });
    fs.writeFileSync(path.join(out, 'sheet.jpg'), sheet);
    fs.writeFileSync(path.join(out, 'cols.json'), JSON.stringify({ ...cols, strips }, null, 1));
    console.log(JSON.stringify({ columns: cols.columns.length, strips: strips.length }));
  } else if (cmd === 'check') {
    const cols = JSON.parse(fs.readFileSync(arg('cols'), 'utf8'));
    const s = parseStrips(fs.readFileSync(arg('strips'), 'utf8'), cols.strips.length);
    console.log(JSON.stringify(orderVerdict(s, fs.readFileSync(arg('read'), 'utf8'))));
  } else if (cmd === 'read-sheets') {
    // One agy call per sheet (SHEETS/<page_id>/sheet.jpg → strips.raw.txt), plan mode + the view_file-only tool gate,
    // exactly as cli-ocr.mjs reads a page. Re-running skips sheets already read.
    const dir = arg('dir'), model = arg('model') || 'gemini-4-argon-low', conc = Number(arg('concurrency') || 2);
    const q = fs.readdirSync(dir).filter((d) => fs.existsSync(path.join(dir, d, 'sheet.jpg')) && !fs.existsSync(path.join(dir, d, 'strips.raw.txt')));
    console.log(`${q.length} sheets to read with ${model}`);
    await Promise.all(Array.from({ length: conc }, async () => {
      while (q.length) {
        const id = q.shift(), d = path.join(dir, id), n = JSON.parse(fs.readFileSync(path.join(d, 'cols.json'), 'utf8')).strips.length;
        const ws = path.join(d, 'ws'); fs.mkdirSync(ws, { recursive: true }); fs.copyFileSync(path.join(d, 'sheet.jpg'), path.join(ws, 'sheet.jpg'));
        installToolGate(ws);
        let r; for (let i = 0; i < 2; i++) { r = await agyCall(['-p', `${STRIP_PROMPT(n)}\n\nThe sheet is attached: @./sheet.jpg`, '--model', model, ...CLI_SAFE_ARGS], ws); if (!r.cls && Object.keys(parseStrips(r.text, n)).length) break; }
        fs.writeFileSync(path.join(d, 'strips.raw.txt'), r.text || '');
        fs.writeFileSync(path.join(d, 'strips.meta.json'), JSON.stringify({ model, secs: r.secs, error_class: r.cls, parsed: Object.keys(parseStrips(r.text, n)).length, n }));
        console.log(`  ${id} ${r.cls || 'ok'} ${Object.keys(parseStrips(r.text, n)).length}/${n} ${Math.round(r.secs)}s`);
      }
    }));
  } else { console.error('usage: colorder.mjs sheet|check (see header)'); process.exit(2); }
}
