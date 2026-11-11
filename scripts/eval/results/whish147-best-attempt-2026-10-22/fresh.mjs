// FRESH READ (#7119, Derek's inbox note of 2026-10-22 23:30: "split then fresh with opus"): a direct Opus read of
// every leaf, in Malayalam script, from column crops cut at the leaf's two string holes. No edition text is shown.
// One sealed claudeCall per leaf: p01.. are the column pieces left to right (left | middle | right; a piece wider than
// 1,600 px is cut in two overlapping halves), each at full resolution.
//   node fresh.mjs --leaves=4-b,5-t,... [--stage=fresh] [--concurrency=3]     (scan-leaf keys, e.g. 5-t = scan 5 upper)
//   node fresh.mjs --all [--concurrency=3]
// PRIOR ART: ../whish147-line-strips-2026-10-22/ (#7148) cut single-row strips (worse: CER 0.60/0.65) and half-leaf
// reads (0.51/0.54); this cuts whole columns at the holes so no crop is downscaled and every row stays whole within a
// column. collate.mjs supplies the sealed-call harness (lib.mjs).
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { SCRATCH, boxes, sealedCall, pool } from './lib.mjs';

const args = process.argv.slice(2);
const arg = (n) => args.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const STAGE = arg('stage') || 'fresh';
const CONC = Number(arg('concurrency') || 3);
const OUT = path.join(SCRATCH, 'fresh-crops');
fs.mkdirSync(OUT, { recursive: true });
const MAXW = 1600, OV = 60;

export const FRESH_PROMPT = (k) => `The files ${Array.from({ length: k }, (_, i) => `p${String(i + 1).padStart(2, '0')}.jpg`).join(', ')} are pieces of ONE palm leaf of a Kerala manuscript (Sanskrit in Malayalam script, Calicut 1822), cut left to right; neighbouring pieces overlap slightly. The leaf has two string holes; the pieces are cut at the holes (left column | middle column | right column; a wide column may come as two pieces). Open every file with the Read tool.

Transcribe the leaf in MALAYALAM SCRIPT exactly as written: keep the scribe's dot-reph ൎ, doubled consonants, visarga sandhi and chillu letters; no normalisation, and no spaces the scribe did not leave. Give numbered physical rows, top to bottom. The top one or two rows and the bottom one or two rows run the full width; every row reads straight across both holes, so row N = left row N + middle row N + right row N, joined with ‖ at each hole (do not repeat text that appears twice in an overlap). Write [illegible] where you cannot read. Do NOT supply text from memory of the Sāṅkhyakārikā or of any commentary: if you recognise the passage, still write only what the strokes show.

Answer only:
ROW 1 | <Malayalam text, with ‖ at each hole>
ROW 2 | ...
NOTE | <one line: e.g. how much of the leaf you could read>`;

/** String-hole centres (x, in scan pixels) inside a leaf box: the darkest smoothed column in each outer band. */
async function holes(img, box) {
  const [x0, y0, x1, y1] = box;
  const W = x1 - x0, H = y1 - y0;
  const band = { left: x0, top: y0 + Math.round(H * 0.3), width: W, height: Math.round(H * 0.4) };
  const k = 4;
  const { data, info } = await sharp(img).extract(band).greyscale().resize({ width: Math.round(W / k) }).raw().toBuffer({ resolveWithObject: true });
  const col = new Float64Array(info.width);
  for (let x = 0; x < info.width; x++) { let s = 0; for (let y = 0; y < info.height; y++) s += data[y * info.width + x]; col[x] = s / info.height; }
  const sm = col.map((_, i) => { let s = 0, n = 0; for (let j = Math.max(0, i - 6); j <= Math.min(col.length - 1, i + 6); j++) { s += col[j]; n++; } return s / n; });
  const argmin = (a, b) => { let bi = a; for (let i = a; i < b; i++) if (sm[i] < sm[bi]) bi = i; return bi; };
  const w = info.width;
  const h1 = argmin(Math.round(w * 0.2), Math.round(w * 0.45)), h2 = argmin(Math.round(w * 0.55), Math.round(w * 0.8));
  return [x0 + h1 * k, x0 + h2 * k];
}

export async function leafPieces(n, leaf) {
  const B = boxes();
  const img = path.join(SCRATCH, 'img', `${n}.jpg`);
  const bx = B[n].leaves[leaf];
  const box = [bx.L[0], bx.L[1], bx.R[2], bx.L[3]];
  const [h1, h2] = await holes(img, box);
  const cols = [[box[0], h1 + OV], [h1 - OV, h2 + OV], [h2 - OV, box[2]]];
  const pieces = [];
  for (const [a, b] of cols) {
    if (b - a <= MAXW) pieces.push([a, b]);
    else { const m = Math.round((a + b) / 2); pieces.push([a, m + OV], [m - OV, b]); }
  }
  const files = [];
  for (let i = 0; i < pieces.length; i++) {
    const f = path.join(OUT, `${n}-${leaf}-${i + 1}.jpg`);
    if (!fs.existsSync(f)) await sharp(img).extract({ left: pieces[i][0], top: box[1], width: pieces[i][1] - pieces[i][0], height: box[3] - box[1] }).jpeg({ quality: 92 }).toFile(f);
    files.push(f);
  }
  return { files, holes: [h1, h2], pieces };
}

async function main() {
  const B = boxes();
  let keys = arg('leaves') ? arg('leaves').split(',') : [];
  if (args.includes('--all')) keys = Object.keys(B).map(Number).sort((a, b) => a - b).flatMap((n) => Object.keys(B[n].leaves).map((l) => `${n}-${l}`));
  const meta = {};
  await pool(keys, CONC, async (key) => {
    const [n, leaf] = key.split('-');
    const { files, holes: hs, pieces } = await leafPieces(Number(n), leaf);
    const r = await sealedCall({ stage: STAGE, id: key, model: 'opus', prompt: FRESH_PROMPT(files.length), images: files });
    meta[key] = { holes: hs, pieces, ok: r.meta.ok };
    const rows = (r.text.match(/^ROW\s+\d+/gm) || []).length;
    console.log(`${key}: ${r.meta.ok ? 'ok' : r.meta.error_class} ${files.length} pieces, ${rows} rows (${r.meta.secs}s${r.cached ? ', cached' : ''})`);
  });
  const mf = path.join(path.dirname(new URL(import.meta.url).pathname), `fresh-pieces-${STAGE}.json`);
  const prev = fs.existsSync(mf) ? JSON.parse(fs.readFileSync(mf, 'utf8')) : {};
  fs.writeFileSync(mf, JSON.stringify({ ...prev, ...meta }, null, 0));
}
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) await main();
