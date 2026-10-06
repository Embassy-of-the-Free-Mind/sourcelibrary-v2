#!/usr/bin/env node
/**
 * PRIOR ART: scripts/eval/lib/production-prompt.mjs (used here, for the live OCR prompt);
 * scripts/batch/realtime-ocr.mjs (its generationConfig is copied, but it WRITES pages, and this
 * probe must write nothing to Mongo); scripts/lib/translate-core.mjs buildTranslationPrompt (used
 * here, as the translate worker does, with no neighbours and no previous page); the #5664 3-page
 * pilot ran from a scratchpad and left no script.
 *
 * Mongolian Kanjur OCR probe (#5664): gemini-3-flash-preview reads 10 pages of BDRC W4CZ5370
 * (Beijing red Kanjur, 1718–20) with the production OCR prompt; each read is then translated to
 * English with Flash, one page per request, no context. The English is compared by hand with the
 * aligned Derge Tibetan (see the write-up in scripts/eval/experiments/).
 *
 * Reads Mongo (prompts) only. Writes files only, under scripts/eval/results/mongol-ocr-probe-5664/.
 * Spend: stops before a call would take the computed total past $2.50.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/mongol-ocr-probe-5664.mjs [--only v047_f193a]
 */
import fs from 'fs';
import path from 'path';
import { MongoClient } from 'mongodb';
import { callGemini } from '../lib/gemini-script-client.mjs';
import { getProductionOcrPrompt } from './lib/production-prompt.mjs';
import { buildTranslationPrompt, MODEL_FLASH } from '../lib/translate-core.mjs';

const DIR = 'scripts/eval/results/mongol-ocr-probe-5664';
const IMG = '/root/mongol-ocr-probe-5664/images';
const ENDPOINT = 'scripts/eval/mongol-ocr-probe-5664.mjs';
const CAP_USD = 2.5;
const PRICE = { input: 0.5, output: 3.0 }; // gemini-3-flash-preview, $/M (scripts/lib/model-pricing.mjs)
// --arm hinted: the same production prompt with only its {language_instruction} slot filled with the
// true language and script (the slot the prompt provides for this). Arm "production" leaves it on
// auto-detect, as getOcrPromptFromDb in the orchestrator does today.
const ARM = process.argv.includes('--arm') ? process.argv[process.argv.indexOf('--arm') + 1] : 'production';
const HINT = '**Source language:** Classical (literary) Mongolian in the traditional Uighur-Mongol vertical script, printed from woodblocks (Beijing Kanjur, 1718–20). It is NOT Manchu. Columns run top to bottom and are read from LEFT to RIGHT. Transcribe in Mongolian script (Unicode U+1800 block), one source column per line, in reading order. The margin carries a Chinese section/volume/folio label. Report the primary language in the <language> tag.';
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;

const pages = JSON.parse(fs.readFileSync(path.join(DIR, 'pages.json'), 'utf8'));
const c = new MongoClient(process.env.MONGODB_URI);
await c.connect();
const db = c.db('bookstore');
const ocrPrompt = await getProductionOcrPrompt(db);
if (ARM === 'hinted') {
  const raw = await db.collection('prompts').findOne({ type: 'ocr', is_default: true }, { sort: { version: -1 } });
  ocrPrompt.text = raw.content.replace('{language_instruction}', HINT).replace('{language}', '');
  ocrPrompt.arm = 'hinted';
}
const trRow = await db.collection('prompts').findOne({ type: 'translation', is_default: true }, { sort: { version: -1 } });
await c.close();
const prompts = { translation: { text: trRow.content, ref: { name: trRow.name, version: String(trRow.version), hash: trRow.content_hash } } };

const ledgerPath = path.join(DIR, 'spend.jsonl');
const spent = () => (fs.existsSync(ledgerPath) ? fs.readFileSync(ledgerPath, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [])
  .reduce((s, r) => s + r.cost_usd, 0);
function charge(kind, key, r) {
  const cost = (r.inputTokens * PRICE.input + r.outputTokens * PRICE.output) / 1e6;
  fs.appendFileSync(ledgerPath, JSON.stringify({ at: new Date().toISOString(), kind, key, model: MODEL_FLASH, in: r.inputTokens, out: r.outputTokens, cost_usd: cost }) + '\n');
  return cost;
}

// 429s (shared quota across the box's workers) are retried with a pause; nothing else is.
async function withRetry(fn) {
  for (let i = 0; ; i++) {
    try { return await fn(); } catch (e) {
      if (!/Gemini 429/.test(e.message) || i >= 6) throw e;
      console.log(`  429, waiting ${30 * (i + 1)}s`);
      await new Promise((r) => setTimeout(r, 30000 * (i + 1)));
    }
  }
}

const OUT = ARM === 'hinted' ? 'flash-hinted' : 'flash';
fs.mkdirSync(path.join(DIR, OUT), { recursive: true });
for (const p of pages) {
  if (only && p.key !== only) continue;
  const out = path.join(DIR, OUT, `${p.key}.json`);
  if (fs.existsSync(out)) { console.log(p.key, 'done already'); continue; }
  if (spent() > CAP_USD - 0.05) throw new Error(`spend cap: $${spent().toFixed(3)} computed`);
  const img = fs.readFileSync(path.join(IMG, `${p.key}.jpg`));
  const ocr = await withRetry(() => callGemini({
    model: MODEL_FLASH, prompt: ocrPrompt.text, imageParts: img, temperature: 0.1,
    maxOutputTokens: 16384, endpoint: ENDPOINT,
  }));
  const ocrCost = charge(`ocr-${ARM}`, p.key, ocr);
  // No context: the book carries only the language, no title, no neighbours, no previous page.
  const { prompt: trPrompt } = buildTranslationPrompt({ prompts, book: { language: 'Mongolian' }, ocrText: ocr.text });
  const tr = await withRetry(() => callGemini({
    model: MODEL_FLASH, prompt: trPrompt, temperature: 1.0,
    maxOutputTokens: Math.min(32768, Math.max(4096, ocr.text.length + 1200)), endpoint: ENDPOINT,
  }));
  const trCost = charge(`translate-${ARM}`, p.key, tr);
  fs.writeFileSync(out, JSON.stringify({
    key: p.key, arm: ARM, page: p, model: MODEL_FLASH,
    ocr_prompt: { arm: ARM, language_instruction: ARM === 'hinted' ? HINT : 'production auto-detect', name: ocrPrompt.name, version: ocrPrompt.version, content_hash: ocrPrompt.content_hash },
    translation_prompt: prompts.translation.ref,
    ocr: { text: ocr.text, finishReason: ocr.finishReason, inputTokens: ocr.inputTokens, outputTokens: ocr.outputTokens, cost_usd: ocrCost },
    translation: { text: tr.text, finishReason: tr.finishReason, inputTokens: tr.inputTokens, outputTokens: tr.outputTokens, cost_usd: trCost },
  }, null, 1));
  console.log(p.key, `ocr ${ocr.text.length}ch ${ocr.finishReason}`, `tr ${tr.text.length}ch`, `$${(ocrCost + trCost).toFixed(4)}`, `total $${spent().toFixed(3)}`);
}
