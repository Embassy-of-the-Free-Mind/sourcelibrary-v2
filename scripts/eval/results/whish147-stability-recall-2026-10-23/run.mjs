// Whish 147 stability / model / recall test (#7119): the fresh column read of #7119 run three times per leaf with
// Opus, Sonnet (with a row-count scaffold) and Fable, plus a masked-row recall probe and a blind sensibility judge.
// Read-only: writes reads under ./reads/<stage>/<leaf>.txt and nothing to the database.
//   JOB_SCRATCH=<dir with img/ and editions/> node run.mjs --stage=<name> --model=<opus|sonnet|fable> --leaves=4-b,5-t [--rows] [--mask] [--concurrency=3]
// PRIOR ART: ../whish147-best-attempt-2026-10-22/fresh.mjs (branch job-whish147-best, #7119) — the column cut at the
// two string holes and FRESH_PROMPT are copied unchanged; lib.mjs's sealedCall/pool are copied as ./lib.mjs. That
// script runs one Opus read per leaf; it has no repeat, no other model, no row scaffold and no masking.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { SCRATCH, boxes, sealedCall, pool } from './lib.mjs';

const args = process.argv.slice(2);
const arg = (n) => args.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const STAGE = arg('stage'), MODEL = arg('model') || 'opus', CONC = Number(arg('concurrency') || 3);
const ROWS = args.includes('--rows'), MASK = args.includes('--mask');
const OUT = path.join(SCRATCH, MASK ? 'crops-masked' : 'crops');
fs.mkdirSync(OUT, { recursive: true });
const MAXW = 1600, OV = 60;
const HERE = path.dirname(new URL(import.meta.url).pathname);

export const FRESH_PROMPT = (k) => `The files ${Array.from({ length: k }, (_, i) => `p${String(i + 1).padStart(2, '0')}.jpg`).join(', ')} are pieces of ONE palm leaf of a Kerala manuscript (Sanskrit in Malayalam script, Calicut 1822), cut left to right; neighbouring pieces overlap slightly. The leaf has two string holes; the pieces are cut at the holes (left column | middle column | right column; a wide column may come as two pieces). Open every file with the Read tool.

Transcribe the leaf in MALAYALAM SCRIPT exactly as written: keep the scribe's dot-reph ൎ, doubled consonants, visarga sandhi and chillu letters; no normalisation, and no spaces the scribe did not leave. Give numbered physical rows, top to bottom. The top one or two rows and the bottom one or two rows run the full width; every row reads straight across both holes, so row N = left row N + middle row N + right row N, joined with ‖ at each hole (do not repeat text that appears twice in an overlap). Write [illegible] where you cannot read. Do NOT supply text from memory of the Sāṅkhyakārikā or of any commentary: if you recognise the passage, still write only what the strokes show.

Answer only:
ROW 1 | <Malayalam text, with ‖ at each hole>
ROW 2 | ...
NOTE | <one line: e.g. how much of the leaf you could read>`;

// The Sonnet scaffold: the number of physical rows, counted on the leaf (rows.json), and a hard format.
const SCAFFOLD = (n) => `\n\nThis leaf has exactly ${n} physical rows of writing. Your answer must have exactly ${n} ROW lines, ROW 1 to ROW ${n}, one per physical row, top to bottom. Work row by row: for row N, read the left piece, then the middle piece(s), then the right piece at the same height, and join them with ‖. If a row cannot be read, still give its ROW line with [illegible].`;

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

/** The leaf's text band, for the mask: the middle third of the leaf box height, painted the leaf's median colour. */
async function maskedLeaf(img, box, n, leaf) {
  const f = path.join(OUT, `${n}-${leaf}-full.jpg`);
  if (fs.existsSync(f)) return f;
  const [x0, y0, x1, y1] = box;
  const H = y1 - y0, top = y0 + Math.round(H / 3), h = Math.round(H / 3);
  const { data } = await sharp(img).extract({ left: x0 + 200, top: y0 + 40, width: 400, height: 60 }).raw().toBuffer({ resolveWithObject: true });
  const ch = [0, 1, 2].map((c) => { const v = []; for (let i = c; i < data.length; i += 3) v.push(data[i]); v.sort((a, b) => a - b); return v[v.length >> 1]; });
  const patch = await sharp({ create: { width: x1 - x0, height: h, channels: 3, background: { r: ch[0], g: ch[1], b: ch[2] } } }).jpeg().toBuffer();
  await sharp(img).composite([{ input: patch, left: x0, top }]).jpeg({ quality: 92 }).toFile(f);
  return f;
}

export async function leafPieces(n, leaf) {
  const B = boxes();
  let img = path.join(SCRATCH, 'img', `${n}.jpg`);
  const bx = B[n].leaves[leaf];
  const box = [bx.L[0], bx.L[1], bx.R[2], bx.L[3]];
  const [h1, h2] = await holes(img, box);   // holes found on the unmasked image
  if (MASK) img = await maskedLeaf(img, box, n, leaf);
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
  const keys = arg('leaves').split(',');
  const rowsN = ROWS ? JSON.parse(fs.readFileSync(path.join(HERE, 'rows.json'), 'utf8')) : {};
  await pool(keys, CONC, async (key) => {
    const [n, leaf] = key.split('-');
    const { files } = await leafPieces(Number(n), leaf);
    let prompt = FRESH_PROMPT(files.length) + (ROWS ? SCAFFOLD(rowsN[key]) : '');
    let r = await sealedCall({ stage: STAGE, id: key, model: MODEL, prompt, images: files });
    let rows = (r.text.match(/^ROW\s+\d+/gm) || []).length;
    if (ROWS && r.meta.ok && rows !== rowsN[key]) {
      // one retry, as the brief allows: same prompt, a reminder of the count
      const p2 = prompt + `\n\n(Your previous answer had ${rows} ROW lines; it must have exactly ${rowsN[key]}.)`;
      r = await sealedCall({ stage: STAGE, id: `${key}.retry`, model: MODEL, prompt: p2, images: files });
      rows = (r.text.match(/^ROW\s+\d+/gm) || []).length;
      fs.copyFileSync(path.join(HERE, 'reads', STAGE, `${key}.retry.txt`), path.join(HERE, 'reads', STAGE, `${key}.final.txt`));
    }
    console.log(`${STAGE} ${key}: ${r.meta.ok ? 'ok' : r.meta.error_class} ${r.meta.model} ${files.length} pieces, ${rows} rows (${r.meta.secs}s${r.cached ? ', cached' : ''})`);
  });
}
await main();
