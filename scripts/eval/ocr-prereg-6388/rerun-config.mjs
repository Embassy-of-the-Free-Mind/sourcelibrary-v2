#!/usr/bin/env node
// PRIOR ART: reads.mjs `prompt` + `lite` stages in this directory — the same live prompt assembly, the same
// realtime-ocr.mjs generationConfig and the same metered gemini-script-client call, copied. reads.mjs writes the
// one-off #6388 arm files and caps at $1 across two runs; this is the recurring arm of #6429 series 1b: one run,
// one dated point in the quality history, a hard --max-usd, and no file in the repo.
/**
 * rerun-config.mjs — #6429 series 1b: today's production OCR prompt on gemini-3.1-flash-lite, re-run on the fixed
 * 90-page #6388 panel, scored against the panel key (panel-key.mjs). It moves when the prompt or the model changes,
 * not when pages are re-read (that is series 1a, the daily build). About monthly, by hand.
 *
 * Cost: the #6388 L1 run of exactly this config cost $0.204 for 90 pages (list price, reads/L1.jsonl.gz). The script
 * estimates from that before the first call, refuses if the estimate exceeds --max-usd, and stops mid-run when the
 * metered spend so far plus one page would exceed it. Every call is metered in gemini_usage (endpoint below).
 *
 * Writes NOTHING to pages or books. With --apply, one field in one ops_reports document:
 * `quality-history-<today>.served_text_config`. Page images are cached under $JOB_SCRATCH (or $TMPDIR).
 *
 *   node --env-file=.env.production.local scripts/eval/ocr-prereg-6388/rerun-config.mjs --estimate
 *   node --env-file=.env.production.local scripts/eval/ocr-prereg-6388/rerun-config.mjs --max-usd 0.50 --apply
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readSample, readArm, HERE } from './panel-key.mjs';

const MODEL = 'gemini-3.1-flash-lite';
const ENDPOINT = 'scripts/eval/ocr-prereg-6388/rerun-config.mjs';
const UA = 'SourceLibraryEval/1.0 (https://sourcelibrary.org; #6429)';
const LANGUAGE_INSTRUCTION = '**Source language:** Detect the primary language from the text. Pages may contain multiple languages — transcribe all of them. Report the primary language in the <language> tag (e.g. <language>Latin</language>).';

const args = process.argv.slice(2);
const opt = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const MAX_USD = Number(opt('--max-usd', '0.50'));
const APPLY = args.includes('--apply');
const ROOT = path.resolve(HERE, '../../..');
const CACHE = path.join(process.env.JOB_SCRATCH || process.env.TMPDIR || os.tmpdir(), 'quality-1b-img');

const sample = readSample();
const prior = [...readArm('L1').values()].filter((r) => r.cost != null);
const perPage = prior.reduce((a, r) => a + r.cost, 0) / prior.length;
const estimate = perPage * sample.length;
console.log(`1b: ${sample.length} pages × $${perPage.toFixed(5)} (mean of ${prior.length} #6388 L1 calls) = estimate $${estimate.toFixed(3)}; cap $${MAX_USD.toFixed(2)}`);
if (args.includes('--estimate')) process.exit(0);
if (!(MAX_USD > 0) || MAX_USD > 1) { console.error('--max-usd must be in (0, 1]'); process.exit(2); }
if (estimate > MAX_USD) { console.error(`estimate $${estimate.toFixed(3)} exceeds --max-usd ${MAX_USD}; not run`); process.exit(2); }

async function image(r) {
  fs.mkdirSync(CACHE, { recursive: true });
  const f = path.join(CACHE, `${r.uid.replace(/[^\w.-]/g, '_')}.jpg`);
  if (fs.existsSync(f) && fs.statSync(f).size > 1000) return fs.readFileSync(f);
  const res = await fetch(r.image, { signal: AbortSignal.timeout(60000), headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`image HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1000) throw new Error(`image only ${buf.length} bytes`);
  fs.writeFileSync(f, buf);
  return buf;
}

const { withMongo } = await import('../../lib/mongo.mjs');
const { callGemini } = await import('../../lib/gemini-script-client.mjs');
const { MODEL_PRICING } = await import('../../lib/model-pricing.mjs');
const { loadPanel, scorePanel, writePoint, PANEL_KEY } = await import('../quality-dashboard/trends.mjs');
const price = MODEL_PRICING[MODEL];
const costOf = (g) => ((g.inputTokens || 0) * price.input + ((g.outputTokens || 0) + (g.thinkingTokens || 0)) * price.output) / 1e6;

await withMongo(async (db) => {
  const p = await db.collection('prompts').findOne({ type: 'ocr', is_default: true }, { sort: { version: -1 } });
  const promptText = p.content.replace('{language_instruction}', LANGUAGE_INSTRUCTION).replace('{language}', '');
  const promptRef = { name: p.name, version: String(p.version ?? ''), hash: p.content_hash ?? null };
  console.log(`prompt ${p.name} v${promptRef.version}`);

  const reads = new Map();
  let spent = 0, stopped = 0, failed = 0, i = 0;
  const worker = async () => {
    while (i < sample.length) {
      const r = sample[i++];
      if (spent + 2 * perPage > MAX_USD) { stopped++; continue; }
      try {
        // realtime-ocr.mjs generationConfig: temperature 0.1, thinkingBudget 0, maxOutputTokens 16384
        const g = await callGemini({ model: MODEL, prompt: promptText, endpoint: ENDPOINT, imageParts: [await image(r)], type: 'ocr', bookId: r.book_id, pageIds: [r.page_id], temperature: 0.1, maxOutputTokens: 16384, thinkingBudget: 0 });
        spent += costOf(g);
        reads.set(r.uid, { uid: r.uid, text: g.text || '', finishReason: g.finishReason ?? null });
      } catch (e) {
        failed++;
        reads.set(r.uid, { uid: r.uid, text: '', error: String(e.message).slice(0, 200) });
      }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  console.log(`read ${reads.size}/${sample.length} pages (${failed} failed, ${stopped} skipped at the cap); spent $${spent.toFixed(4)}`);
  if (stopped) { console.error('stopped at the cap: a partial panel is not a point. Nothing written.'); process.exitCode = 2; return; }

  const { lib, panel } = await loadPanel(ROOT);
  const scored = scorePanel(reads, panel, lib);
  console.log(Object.entries(scored.strata).map(([k, v]) => `${k} ${(100 * v.mean_cer).toFixed(1)}% (${v.n_scored})`).join(' · '));
  const today = new Date().toISOString().slice(0, 10);
  if (!APPLY) { console.log('(no --apply: nothing written)'); return; }
  await writePoint(db, today, 'served_text_config', {
    ...scored, key: PANEL_KEY.kind, model: MODEL, prompt: promptRef, spend_usd: Math.round(spent * 1e4) / 1e4, failed, source: ENDPOINT,
  });
  console.log(`wrote ops_reports quality-history-${today}.served_text_config`);
}, { timeoutMs: 1800_000 });
