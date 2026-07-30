#!/usr/bin/env node
/**
 * Occlusion cloze with SHAPED masks — a graded membership probe (#3235/#3444).
 *
 * A rectangular mask gives every covered line the same cue density, so it yields
 * one binary observation: reconstructed or not. A shaped mask varies cue density
 * BY LINE within a single image — wide at the middle, narrow at the tips — so one
 * page produces a dose-response curve instead of a single point. That is the
 * graded instrument `ocr-memorization-paper.md` calls for.
 *
 * Why this measures training-set membership: the model cannot READ covered pixels
 * (verified: mask interior stddev 0.17 vs 43.1 for real text on the same page).
 * Anything it emits for a covered region came from somewhere other than the page.
 * Visible fragments let it identify WHICH passage it is looking at; whether it can
 * then complete the passage is the membership signal.
 *
 * Shapes:
 *   rect     baseline — uniform cue density, one observation
 *   diamond  cue density varies by line: near-full at top/bottom, minimal at centre
 *   ellipse  same idea, smoother gradient
 *   bowtie   INVERTED — maximal cover at the tips, minimal at centre. A control:
 *            if reconstruction tracks cue density, diamond and bowtie must differ.
 *
 * Both diamond and bowtie leave fragments on BOTH edges of most lines, where a
 * rectangle leaves them only on one — which is what makes it a cloze rather than
 * a blackout (a full-width bar removes the anchor along with the content, and the
 * model then simply reports the bar; observed on Aeneid I).
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/eval/cloze-probe.mjs --slug=latin-vulgate-genesis-1 \
 *     --rect=0.235,0.224,0.205,0.058 --shapes=rect,diamond,bowtie \
 *     --models=lite --runs=3 --save-image=/tmp/probe
 *
 *   --temp=N   sampling temperature (default 0.1 — MATCHES PRODUCTION, not 0;
 *              at 0 the model is a deterministic fixed point and N runs give one
 *              sample, measured 1 distinct output in 10)
 *   --dry-run  render and save the masked images only, no API calls
 */

import { loadEnv, getPage, disconnect } from './lib/sampling.mjs';
import { runModel, resolveModel, fetchImage } from './lib/runners.mjs';
import { getPageSource } from '../lib/page-image-url.mjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv();

const args = Object.fromEntries(process.argv.slice(2).filter(a => a.startsWith('--'))
  .map(a => { const [k, v] = a.slice(2).split('='); return [k, v === undefined ? true : v]; }));

const GREY = '#787878'; // 120,120,120 — matches the existing occlusion arms

/**
 * Build an SVG mask of `shape` filling the given pixel box.
 * Coordinates are relative to the box, composited at (left, top).
 */
function maskSvg(shape, w, h) {
  const body = {
    rect: `<rect x="0" y="0" width="${w}" height="${h}" fill="${GREY}"/>`,
    // Widest at the vertical centre, tapering to points at top and bottom, so
    // the top and bottom lines keep most of their text and the middle line keeps
    // almost none.
    diamond: `<polygon points="${w / 2},0 ${w},${h / 2} ${w / 2},${h} 0,${h / 2}" fill="${GREY}"/>`,
    ellipse: `<ellipse cx="${w / 2}" cy="${h / 2}" rx="${w / 2}" ry="${h / 2}" fill="${GREY}"/>`,
    // Inverted diamond: full width at top and bottom, pinched at the centre.
    // The control — reconstruction should track cue density, so if diamond and
    // bowtie behave identically the gradient is not what is driving the result.
    bowtie: `<polygon points="0,0 ${w},0 ${w / 2},${h / 2} ${w},${h} 0,${h} ${w / 2},${h / 2}" fill="${GREY}"/>`,
  }[shape];
  if (!body) throw new Error(`unknown shape: ${shape}`);
  return Buffer.from(`<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`);
}

/** Fraction of the box's pixels the shape actually covers — the honest "dose". */
function coveredFraction(shape) {
  return { rect: 1.0, diamond: 0.5, ellipse: Math.PI / 4, bowtie: 0.5 }[shape];
}

async function main() {
  const sharp = (await import('sharp')).default;
  const slug = args.slug;
  const gt = JSON.parse(fs.readFileSync(path.join(__dirname, 'ground-truth', `${slug}.json`), 'utf8'));
  const [xf, yf, wf, hf] = String(args.rect).split(',').map(Number);
  const shapes = String(args.shapes || 'rect,diamond,bowtie').split(',');
  const models = String(args.models || 'lite').split(',').map(resolveModel);
  const runs = parseInt(args.runs || '3');
  // Production OCR runs at 0.1 (pipeline-orchestrator.mjs:1596), NOT 0. At 0 the
  // model is deterministic — 10 repeats produced 1 distinct output — so repeats
  // only inform at production temperature.
  const temperature = parseFloat(args.temp ?? '0.1');
  const width = parseInt(args.width || '2000');
  const probe = args.probe ? new RegExp(args.probe, 'i') : null;

  const page = await getPage(gt.book_id, gt.page_number);
  const url = page && getPageSource(page);
  if (!url) { console.error('no page image'); process.exit(1); }
  let base = await fetchImage(url);
  const meta0 = await sharp(base).metadata();
  if (meta0.width > width) base = await sharp(base).resize({ width }).jpeg({ quality: 90 }).toBuffer();
  const meta = await sharp(base).metadata();
  const box = {
    left: Math.round(meta.width * xf), top: Math.round(meta.height * yf),
    width: Math.round(meta.width * wf), height: Math.round(meta.height * hf),
  };

  console.log(`\n  ${gt.work}  (page ${gt.page_number}, ${meta.width}x${meta.height})`);
  console.log(`  mask box ${box.width}x${box.height} at (${box.left},${box.top})`);
  console.log(`  temp=${temperature} runs=${runs} models=${models.join(',')}\n`);

  const rows = [];
  for (const shape of shapes) {
    const svg = maskSvg(shape, box.width, box.height);
    // Materialize the composite BEFORE any further resize — sharp's
    // composite().resize() in one chain silently shifts the mask (the occlusion
    // v2 tooling note); we resize first, above, and never after.
    const masked = await sharp(base)
      .composite([{ input: svg, top: box.top, left: box.left }])
      .jpeg({ quality: 90 }).toBuffer();

    if (args['save-image']) {
      fs.mkdirSync(args['save-image'], { recursive: true });
      const f = path.join(args['save-image'], `${slug}__${shape}.jpg`);
      fs.writeFileSync(f, masked);
      console.log(`  saved ${path.basename(f)}  (covers ~${(coveredFraction(shape) * 100).toFixed(0)}% of the box)`);
    }
    if (args['dry-run']) continue;

    for (const model of models) {
      for (let i = 0; i < runs; i++) {
        await new Promise(r => setTimeout(r, 250));
        try {
          const res = await runModel(model, masked, args.prompt || fs.readFileSync(args['prompt-file'], 'utf8'),
            { maxTokens: 16000, temperature });
          const reconstructed = probe ? probe.test(res.text) : null;
          rows.push({ shape, model, run: i + 1, reconstructed,
            warned: /<warning>/i.test(res.text), unclear: /<unclear>/i.test(res.text),
            text: res.text, costUsd: res.costUsd });
          console.log(`  ${shape.padEnd(8)} ${model.slice(0, 20).padEnd(20)} run${i + 1}  ` +
            (reconstructed === null ? '' : (reconstructed ? 'RECONSTRUCTED  ' : 'left gap       ')) +
            `warning=${/<warning>/i.test(res.text) ? 'yes' : 'no '}`);
        } catch (e) { console.log(`  ! ${shape} run${i + 1}: ${String(e.message).slice(0, 80)}`); }
      }
    }
  }

  if (rows.length) {
    console.log(`\n  ${'shape'.padEnd(10)} ${'covered'.padStart(8)} ${'reconstructed'.padStart(14)} ${'warned'.padStart(8)}  distinct`);
    console.log('  ' + '─'.repeat(56));
    for (const shape of shapes) {
      const rs = rows.filter(r => r.shape === shape);
      if (!rs.length) continue;
      const rec = rs.filter(r => r.reconstructed).length;
      const uniq = new Set(rs.map(r => r.text.replace(/\s+/g, ' ').trim())).size;
      console.log(`  ${shape.padEnd(10)} ${((coveredFraction(shape) * 100).toFixed(0) + '%').padStart(8)} ` +
        `${(rec + '/' + rs.length).padStart(14)} ${(rs.filter(r => r.warned).length + '/' + rs.length).padStart(8)}  ${uniq}/${rs.length}`);
    }
    console.log(`\n  If reconstruction tracks cue density, diamond (tapered) and bowtie`);
    console.log(`  (pinched) must differ despite covering the same 50% — that contrast`);
    console.log(`  is the control against "any mask of this size does this".\n`);
    const out = path.join(__dirname, 'results', `cloze-probe-${slug}-${new Date().toISOString().slice(0, 10)}.json`);
    fs.writeFileSync(out, JSON.stringify({ slug, box, shapes, models, runs, temperature, rows }, null, 2));
    console.log(`  → ${path.relative(process.cwd(), out)}\n`);
  }
  await disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
