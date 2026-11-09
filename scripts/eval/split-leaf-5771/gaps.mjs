#!/usr/bin/env node
// PRIOR ART: scripts/split-pecha.mjs rowBrightness()/darkestRow() (#2657: snap a Gemini-proposed cut to the darkest
// row of the inter-leaf zone) and leafsplit.py (the ledgers' detector: text bands from gradient energy, with a halves
// fallback). Neither proposes cuts with no model AND no band-count prior: EAP pecha photos lie on a dark cloth, so the
// gaps between leaves are runs of rows that are dark across the middle of the frame. This finds those runs and cuts at
// their middles, then compares with the ledger cut; every disagreement is looked at by eye before it is used.
/**
 * gaps.mjs — $0, files only.
 *   node scripts/eval/split-leaf-5771/gaps.mjs --frames=frames.jsonl --crops=DIR --out=gaps.jsonl
 * Rebuilds each frame from its leaf crops in DIR (they partition it), takes the mean luminance of every row over the
 * middle 50% of the width, and calls a row "cloth" when it is darker than the midpoint of the 5th and 60th luminance
 * percentiles. A leaf is a run of non-cloth rows taller than 6% of the frame; cuts sit in the middle of the cloth
 * between leaves. Prints frames where the leaf count or a cut (> 2% of H) differs from the cut used.
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const frames = fs.readFileSync(arg('frames'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const D = arg('crops');
const W = 400;
const out = [];
for (const f of frames) {
  const leaves = fs.readdirSync(D).filter((x) => x.startsWith(`${f.uid}-L`) && x.endsWith('.jpg')).sort();
  const parts = await Promise.all(leaves.map((x) => sharp(path.join(D, x)).resize({ width: W }).greyscale().raw().toBuffer({ resolveWithObject: true })));
  const rows = [];
  for (const p of parts) for (let y = 0; y < p.info.height; y++) { let s = 0; for (let x = W / 4; x < (3 * W) / 4; x++) s += p.data[y * W + x]; rows.push(s / (W / 2)); }
  const H = rows.length, sm = rows.map((_, i) => { let s = 0, n = 0; for (let k = -2; k <= 2; k++) if (rows[i + k] != null) { s += rows[i + k]; n++; } return s / n; });
  const sorted = [...sm].sort((a, b) => a - b), thr = (sorted[Math.floor(H * 0.05)] + sorted[Math.floor(H * 0.6)]) / 2;
  const runs = []; let st = null;
  sm.forEach((v, i) => { if (v > thr && st == null) st = i; if ((v <= thr || i === H - 1) && st != null) { runs.push([st, i]); st = null; } });
  const lv = runs.filter(([a, b]) => b - a > 0.06 * H);
  const spans = lv.map(([a, b], i) => [i === 0 ? 0 : Math.round((lv[i - 1][1] + a) / 2), i === lv.length - 1 ? H : Math.round((b + lv[i + 1][0]) / 2)]).map(([a, b]) => [+(a / H).toFixed(3), +(b / H).toFixed(3)]);
  const used = f.spans || [[0, 1]];
  const differ = spans.length !== used.length || spans.some((s, i) => Math.abs(s[1] - used[i][1]) > 0.02);
  out.push({ uid: f.uid, used, gaps: spans, differ });
  if (differ) console.log(f.uid, 'used', JSON.stringify(used), 'gaps', JSON.stringify(spans));
}
fs.writeFileSync(arg('out'), out.map((x) => JSON.stringify(x)).join('\n') + '\n');
console.log(`${out.filter((x) => x.differ).length} of ${out.length} frames differ`);
