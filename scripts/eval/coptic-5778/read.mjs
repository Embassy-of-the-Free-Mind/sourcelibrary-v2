#!/usr/bin/env node
/**
 * PRIOR ART: scripts/eval/en-ocr-reference-5124.mjs --stage=ocr (same runner, same live prompt,
 * but its page pool and eval store are English/Wikisource-specific); scripts/eval/ocr-ab-test.mjs
 * style A/B runners write to their own stores. Reused: lib/runners.mjs `runGemini`/`fetchImage`,
 * lib/production-prompt.mjs. This reads the 15 sampled Coptic pages once per engine (#5778).
 *
 * Writes ONLY to --out (reads.jsonl) and --images (a scratch dir). Never to `pages` or `books`.
 *
 * usage-ok: one-off hand-run eval, 15 pages × 2 engines realtime (≈$0.15), hard stop at --max-cost,
 * never scheduled. Usage is logged by runGemini under endpoint eval/coptic-5778.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { withMongo } from '../../lib/mongo.mjs';
import { OCR_MODEL_LITE, OCR_MODEL_FLASH } from '../../lib/ocr-routing.mjs';
import { runGemini, fetchImage } from '../lib/runners.mjs';
import { getProductionOcrPrompt } from '../lib/production-prompt.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const OUT = arg('--out'); const IMAGES = arg('--images'); const MAX_COST = +arg('--max-cost', 1.5);
const ARMS = [{ arm: 'lite', model: OCR_MODEL_LITE }, { arm: 'flash', model: OCR_MODEL_FLASH }];
const MAX_BYTES = 6 * 1024 * 1024, MAX_SIDE = 3200;

const sample = fs.readFileSync(path.join(OUT, 'sample.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const outFile = path.join(OUT, 'reads.jsonl');
const done = new Set(fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8').trim().split('\n').filter(Boolean).map((l) => { const r = JSON.parse(l); return `${r.id}|${r.arm}`; }) : []);
fs.mkdirSync(IMAGES, { recursive: true });

let prompt;
await withMongo(async (db) => { prompt = await getProductionOcrPrompt(db); });
const promptHash = crypto.createHash('sha256').update(prompt.text).digest('hex').slice(0, 16);
console.log(`prompt ${prompt.name} v${prompt.version} sha ${promptHash}`);

let spent = 0;
for (const s of sample) {
  const imgFile = path.join(IMAGES, `${s.id}.jpg`);
  let buf, resized = false;
  if (fs.existsSync(imgFile)) buf = fs.readFileSync(imgFile);
  else {
    buf = await fetchImage(s.image_url, 120000);
    const meta = await sharp(buf, { limitInputPixels: false }).metadata();
    // Inline requests cap near 20 MB; the pipeline reads the archived derivative, not a 100 MB master.
    if (buf.length > MAX_BYTES || Math.max(meta.width, meta.height) > MAX_SIDE * 2) {
      buf = await sharp(buf, { limitInputPixels: false }).resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside' }).jpeg({ quality: 90 }).toBuffer(); resized = true;
    }
    fs.writeFileSync(imgFile, buf);
  }
  for (const { arm, model } of ARMS) {
    if (done.has(`${s.id}|${arm}`)) continue;
    if (spent >= MAX_COST) { console.error(`STOP: spent $${spent.toFixed(3)} ≥ --max-cost`); process.exit(2); }
    let res, err = null;
    for (let attempt = 0; attempt < 3 && !res; attempt++) {
      try { res = await runGemini(model, buf, prompt.text, { temperature: 0, maxTokens: 8000, thinkingBudget: 0, endpoint: 'eval/coptic-5778', usageType: 'ocr' }); }
      catch (e) { err = String(e.message || e); await new Promise((r) => setTimeout(r, 5000 * (attempt + 1))); }
    }
    const row = res
      ? { id: s.id, arm, model, prompt_id: `ocr-default-v${prompt.version}`, prompt_hash: promptHash, image_bytes: buf.length, resized, text: res.text, finish_reason: res.finishReason, input_tokens: res.inputTokens, output_tokens: res.outputTokens, thinking_tokens: res.thinkingTokens, cost_usd: res.costUsd, duration_ms: res.durationMs, at: new Date().toISOString() }
      : { id: s.id, arm, model, error: err, at: new Date().toISOString() };
    spent += res?.costUsd || 0;
    fs.appendFileSync(outFile, JSON.stringify(row) + '\n');
    console.log(s.id, arm, res ? `${res.text.length} chars ${res.finishReason} $${res.costUsd.toFixed(4)}` : `ERROR ${err}`);
  }
}
console.log(`spent $${spent.toFixed(4)}`);
