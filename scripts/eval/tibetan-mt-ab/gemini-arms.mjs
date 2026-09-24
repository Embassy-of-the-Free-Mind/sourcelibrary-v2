#!/usr/bin/env node
// PRIOR ART: scripts/eval/translation-model-ab.mjs — N-arm paired model comparison on the
// production prompt, but it draws its own sample from Mongo (Chinese preview pages) and scores
// reference-free; here the sample is pinned in a data dir (Yigdzin reads, not `pages.ocr`), and the
// score is a blind judge against a human reference. `buildTranslationPrompt` / `costOf` are
// IMPORTED from scripts/lib, not copied, so the arms carry exactly the production prompt shape.
/** The two Gemini arms of the Tibetan translation A/B (#4742): flash and flash-lite on the production Tibetan prompt over the pinned 84000-matched sample, thinking off, cost and latency per page. */
/**
 * gemini-arms.mjs — run on Hetzner (the laptop is geo-blocked for Gemini).
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/tibetan-mt-ab/gemini-arms.mjs \
 *        --data /root/mtab --out /root/mtab/gemini --arms gemini-3-flash-preview,gemini-3.1-flash-lite [--ids a,b] [--dry-run] [--max-usd 2]
 *
 * Data dir layout (copied from the ops handoff data folder):
 *   ids.txt            "<book> <page>" per line — the sample
 *   yig/mtab-yig-<book>_<page5>.txt   the Yigdzin read (the text the retranslation would consume)
 *   books.json         { <book>: { title, author, year, language, ... } }  (read-only pull)
 *   prompt.json        { ref: {id,name,version,content_hash}, text }      the production translation prompt
 *
 * One call per page per arm, `previousTranslation` empty (a single page has no continuity
 * context in this design; every arm gets the same absence). Safety BLOCK_NONE and thinking OFF as
 * in translate-worker. Output: <out>/<arm>/<id>.json with text, tokens, ms and cost at realtime
 * rates (halve for the Batch projection). Resumable: existing files are skipped.
 */
import fs from 'node:fs';
import path from 'node:path';
import { callGemini } from '../../lib/gemini-script-client.mjs';
import { buildTranslationPrompt } from '../../lib/translate-core.mjs';
import { costOf } from '../../lib/model-pricing.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] != null ? args[i + 1] : d; };
const flag = (n) => args.includes(`--${n}`);
const DATA = opt('data');
const OUT = opt('out');
const ARMS = opt('arms', 'gemini-3-flash-preview,gemini-3.1-flash-lite').split(',');
const IDS = opt('ids', '') ? opt('ids').split(',') : null;
const MAX_USD = Number(opt('max-usd', 2));
const DRY = flag('dry-run');
if (!DATA || !OUT) { console.error('--data and --out are required'); process.exit(1); }

const SAFETY_SETTINGS = ['HARM_CATEGORY_HARASSMENT', 'HARM_CATEGORY_HATE_SPEECH', 'HARM_CATEGORY_SEXUALLY_EXPLICIT', 'HARM_CATEGORY_DANGEROUS_CONTENT', 'HARM_CATEGORY_CIVIC_INTEGRITY']
  .map((category) => ({ category, threshold: 'BLOCK_NONE' }));

const prompts = { translation: JSON.parse(fs.readFileSync(path.join(DATA, 'prompt.json'), 'utf8')) };
const books = JSON.parse(fs.readFileSync(path.join(DATA, 'books.json'), 'utf8'));
const ids = fs.readFileSync(path.join(DATA, 'ids.txt'), 'utf8').trim().split('\n').map((l) => l.trim().split(/\s+/))
  .map(([book, page]) => ({ book, page: Number(page), id: `${book}_${String(page).padStart(5, '0')}` }))
  .filter((r) => !IDS || IDS.includes(r.id));

// translate-worker's maxOutputTokensFor, for one page
const maxOutputTokensFor = (ocrChars) => Math.min(32768, Math.max(4096, ocrChars + 1200));

let spent = 0;
const summary = [];
for (const arm of ARMS) {
  fs.mkdirSync(path.join(OUT, arm), { recursive: true });
  for (const r of ids) {
    const outf = path.join(OUT, arm, `${r.id}.json`);
    if (fs.existsSync(outf)) { const j = JSON.parse(fs.readFileSync(outf, 'utf8')); spent += j.cost_usd || 0; summary.push(j); continue; }
    const ocrText = fs.readFileSync(path.join(DATA, 'yig', `mtab-yig-${r.id}.txt`), 'utf8').trim();
    const book = books[r.book];
    if (!book) throw new Error(`no book metadata for ${r.book}`);
    const { prompt, promptRef } = buildTranslationPrompt({ prompts, book, ocrText, previousTranslation: null });
    if (DRY) {
      // Tibetan tokenises poorly: ~1 token per 2 chars is the conservative guess, output ~ chars/3
      const est = costOf(arm, prompt.length / 3 + ocrText.length / 2, ocrText.length / 3 + 300);
      spent += est;
      console.log(`[dry] ${arm} ${r.id} prompt ${prompt.length} chars ≈ $${est.toFixed(4)}`);
      continue;
    }
    if (spent > MAX_USD) throw new Error(`spend cap: $${spent.toFixed(2)} > $${MAX_USD}`);
    const t0 = Date.now();
    let res;
    for (let attempt = 1; ; attempt++) {
      try {
        res = await callGemini({
      model: arm,
      prompt,
      endpoint: 'scripts/eval/tibetan-mt-ab/gemini-arms.mjs',
      thinkingBudget: 0,
      temperature: 0,
      maxOutputTokens: maxOutputTokensFor(ocrText.length),
      safetySettings: SAFETY_SETTINGS,
      type: 'eval',
      bookId: r.book,
      pageIds: [r.id],
      promptVersion: `v${promptRef.version}`,
      triggeredBy: 'tibetan-mt-ab',
        });
        break;
      } catch (err) {
        // 503/429 are the API's weather, not a result; four tries, then the page is a recorded failure
        if (attempt >= 4 || !/Gemini (503|429|500)/.test(String(err.message))) {
          fs.writeFileSync(outf.replace(/\.json$/, '.failed.json'), JSON.stringify({ id: r.id, arm, error: String(err.message).slice(0, 300), attempts: attempt }, null, 1));
          console.log(`${arm} ${r.id} FAILED after ${attempt}: ${String(err.message).slice(0, 120)}`);
          res = null;
          break;
        }
        await new Promise((ok) => setTimeout(ok, 5000 * attempt));
      }
    }
    if (!res) continue;
    const ms = Date.now() - t0;
    const cost_usd = costOf(arm, res.inputTokens, res.outputTokens);
    spent += cost_usd;
    const rec = { id: r.id, arm, text: res.text, finishReason: res.finishReason, inputTokens: res.inputTokens, outputTokens: res.outputTokens, thinkingTokens: res.thinkingTokens, ms, cost_usd, prompt_ref: promptRef, src_chars: ocrText.length };
    fs.writeFileSync(outf, JSON.stringify(rec, null, 1));
    summary.push(rec);
    console.log(`${arm} ${r.id} in ${res.inputTokens} out ${res.outputTokens} ${ms} ms $${cost_usd.toFixed(4)} ${res.finishReason}`);
  }
}
console.log(`${DRY ? 'estimated' : 'spent'} $${spent.toFixed(4)} over ${summary.length || ids.length * ARMS.length} calls`);
