#!/usr/bin/env node
// PRIOR ART: scripts/eval/tibetan-mt-ab/gemini-arms.mjs — same call shape (production prompt via buildTranslationPrompt,
// thinking off, temperature 0, BLOCK_NONE), but it reads a pinned Yigdzin data dir; this reads translation-vs-reference
// records (source_text) and can swap in a corrected transcription per page (#5695 addendum 3), and names arms
// freely so the same model can run twice (X1 noise floor).
/** Gemini lever arms for #5695 T2 over translation-vs-reference records: one page per call on the production prompt, optional corrected-source override, hard USD cap. */
/**
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/translation-vs-reference/t2/gemini-arms.mjs \
 *     --input records.jsonl --out <dir> --arms lite-a=gemini-3.1-flash-lite,lite-b=gemini-3.1-flash-lite,flash=gemini-3-flash-preview \
 *     [--override corrected.json] [--ids id,id] [--max-usd 2]
 * --override: { "<book>_<page5>": "corrected source text" }; only those pages run, the arm name gets no suffix (name it yourself).
 * Output <out>/<arm>/<id>.json {text, tokens, cost_usd, prompt_ref}. Resumable. No writes to Mongo except the usage meter.
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { callGemini } from '../../../lib/gemini-script-client.mjs';
import { buildTranslationPrompt, loadTranslationPrompts, SAFETY_SETTINGS } from '../../../lib/translate-core.mjs';
import { costOf } from '../../../lib/model-pricing.mjs';
import { readJsonl, itemId } from '../common.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] != null ? args[i + 1] : d; };
const INPUT = opt('input'); const OUT = opt('out'); const MAX_USD = Number(opt('max-usd', 2));
const ARMS = opt('arms').split(',').map((a) => a.split('='));
const OVERRIDE = opt('override') ? JSON.parse(fs.readFileSync(opt('override'), 'utf8')) : null;
const IDS = opt('ids') ? opt('ids').split(',') : null;
const maxOutputTokensFor = (ocrChars) => Math.min(32768, Math.max(4096, ocrChars + 1200));

const client = new MongoClient(process.env.MONGODB_URI); await client.connect();
const db = client.db('bookstore');
const prompts = await loadTranslationPrompts(db);
console.log(`prompt ${prompts.translation.ref.name} v${prompts.translation.ref.version}`);
const records = readJsonl(INPUT).filter((r) => (!IDS || IDS.includes(itemId(r))) && (!OVERRIDE || OVERRIDE[itemId(r)]));
let spent = 0; let n = 0;
try {
  for (const [arm, model] of ARMS) {
    fs.mkdirSync(path.join(OUT, arm), { recursive: true });
    for (const r of records) {
      const id = itemId(r); const outf = path.join(OUT, arm, `${id}.json`);
      if (fs.existsSync(outf)) { spent += JSON.parse(fs.readFileSync(outf, 'utf8')).cost_usd || 0; continue; }
      if (spent > MAX_USD) throw new Error(`spend cap: $${spent.toFixed(2)} > $${MAX_USD}`);
      const book = await db.collection('books').findOne({ id: r.book_id }, { projection: { title: 1, display_title: 1, author: 1, language: 1, published: 1, year: 1, image_source: 1 } });
      const ocrText = (OVERRIDE ? OVERRIDE[id] : r.source_text).trim();
      const { prompt, promptRef } = buildTranslationPrompt({ prompts, book, ocrText, previousTranslation: null });
      let res = null;
      for (let attempt = 1; attempt <= 4 && !res; attempt++) {
        try {
          res = await callGemini({ model, prompt, endpoint: 'scripts/eval/translation-vs-reference/t2/gemini-arms.mjs', thinkingBudget: 0, temperature: 0,
            maxOutputTokens: maxOutputTokensFor(ocrText.length), safetySettings: SAFETY_SETTINGS, type: 'eval', bookId: r.book_id, pageIds: [id], promptVersion: `v${promptRef.version}`, triggeredBy: 'xlref-t2' });
        } catch (err) {
          if (attempt >= 4 || !/Gemini (503|429|500)/.test(String(err.message))) { fs.writeFileSync(outf.replace(/\.json$/, '.failed.json'), JSON.stringify({ id, arm, error: String(err.message).slice(0, 300) })); console.log(`${arm} ${id} FAILED ${String(err.message).slice(0, 100)}`); break; }
          await new Promise((ok) => setTimeout(ok, 5000 * attempt));
        }
      }
      if (!res) continue;
      const cost_usd = costOf(model, res.inputTokens, res.outputTokens);
      spent += cost_usd; n++;
      fs.writeFileSync(outf, JSON.stringify({ id, arm, model, text: res.text, finishReason: res.finishReason, inputTokens: res.inputTokens, outputTokens: res.outputTokens, thinkingTokens: res.thinkingTokens, thinkingConfig: { thinkingBudget: 0 }, temperature: 0, cost_usd, prompt_ref: promptRef, src_chars: ocrText.length, source_override: !!OVERRIDE }, null, 1));
    }
    console.log(`${arm}: cumulative $${spent.toFixed(4)}`);
  }
} finally { await client.close(); }
console.log(`spent $${spent.toFixed(4)} (incl. resumed) over ${n} new calls`);
