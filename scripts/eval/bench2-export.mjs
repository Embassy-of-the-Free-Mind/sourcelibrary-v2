#!/usr/bin/env node
// PRIOR ART: scripts/_tmp_mineru_fetch.mjs — throwaway (/tmp paths, difflib scoring,
// not wired to ground-truth/ or lib/metrics.mjs); this replaces it properly against
// the pinned ground-truth set. Export path reuses lib/sampling.mjs + lib/runners.mjs.
/**
 * bench2-export.mjs — export the pinned ground-truth pages as image files + a
 * manifest, for running self-hosted OCR engines (CHURRO, Surya, Kraken, BDRC…)
 * on a remote box. The engine writes one <slug>.txt per image; score the results
 * with score-transcripts.mjs --dir=… --engine=… (same two-stage scoring and
 * raw-outputs JSONL as the Gemini scorecard arms, so stats-cross-model.mjs can
 * compare engines directly).
 *
 *   node scripts/eval/bench2-export.mjs --out=/path/bench2 [--only=regex] [--width=N]
 *
 * --only filters ground-truth basenames (same semantics as qa-eval scorecard).
 * --width resizes like the scorecard's resolution arm so a remote run is
 * pixel-comparable to a @wN Gemini arm; default exports the native pipeline image
 * (getPageSource — the same source production OCR saw).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadEnv, connect, disconnect, getPage } from './lib/sampling.mjs';
import { fetchImage } from './lib/runners.mjs';
import { getPageSource } from '../lib/page-image-url.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2)
  .filter(a => a.startsWith('--')).map(a => {
    const i = a.indexOf('=');
    return i === -1 ? [a.slice(2), true] : [a.slice(2, i), a.slice(i + 1)];
  }));

if (!args.out) { console.error('--out=<dir> required'); process.exit(1); }
const only = args.only ? new RegExp(args.only) : null;
const gtDir = path.join(__dirname, 'ground-truth');
fs.mkdirSync(args.out, { recursive: true });

loadEnv();
const manifest = [];
let exported = 0, skipped = 0;
for (const f of fs.readdirSync(gtDir).filter(f => f.endsWith('.json')).sort()) {
  if (only && !only.test(f)) continue;
  const gt = JSON.parse(fs.readFileSync(path.join(gtDir, f), 'utf8'));
  if (!gt.ocr_ground_truth || !gt.book_id) continue;
  const slug = f.replace(/\.json$/, '');
  const page = await getPage(gt.book_id, gt.page_number);
  if (!page) { console.log(`  ! ${slug}: page not found`); skipped++; continue; }
  const imageUrl = getPageSource(page);
  if (!imageUrl) { console.log(`  ! ${slug}: no usable page image`); skipped++; continue; }
  let buf;
  try {
    buf = await fetchImage(imageUrl);
  } catch (e) {
    console.log(`  ! ${slug}: fetch failed (${e.message})`); skipped++; continue;
  }
  let width;
  if (args.width) {
    const target = parseInt(args.width, 10);
    const sharp = (await import('sharp')).default;
    const meta = await sharp(buf).metadata();
    width = Math.min(target, meta.width);
    if (meta.width > target) buf = await sharp(buf).resize({ width: target }).jpeg({ quality: 90 }).toBuffer();
  }
  fs.writeFileSync(path.join(args.out, `${slug}.jpg`), buf);
  manifest.push({
    slug, work: gt.work, book_id: gt.book_id, page_number: gt.page_number,
    script: gt.script, language: gt.language, image_url: imageUrl,
    bytes: buf.length, ...(width ? { resized_width: width } : {}),
  });
  console.log(`  ✓ ${slug} (${(buf.length / 1024).toFixed(0)}KB)`);
  exported++;
}
fs.writeFileSync(path.join(args.out, 'manifest.json'), JSON.stringify({
  exported_at: new Date().toISOString(),
  only: args.only || null, width: args.width ? parseInt(args.width, 10) : null,
  pages: manifest,
}, null, 2));
console.log(`\nExported ${exported} pages to ${args.out} (${skipped} skipped). Engine contract: write <slug>.txt per image, then score-transcripts.mjs --dir=… --engine=<name>.`);
await disconnect();
