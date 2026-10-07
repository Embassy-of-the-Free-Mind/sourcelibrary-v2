#!/usr/bin/env node
// PRIOR ART: scripts/eval/tibetan-mt-ab/batch-arms.mjs (#4742/#5606) builds the same production single-page prompt
// and runs one Batch job per model, but calls @google/genai directly (not gemini-script-client), has no envelope
// check, and has no arms for thinking, continuity context, a source override (corrected OCR) or a check-and-fix
// pass. This runs those lever arms for #5695 T5 realtime through callGemini (thinking explicit, every call on the
// gemini_usage ledger with its book_id so the xlref-t5 envelope measures it), and writes outputs in the same
// shape as batch-arms.mjs so the #5606 arms and these sit side by side.
/**
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/xlref-t5/run-arms.mjs \
 *        --records <records.jsonl> --out <arms dir> --arm <label> --model <id> [--ids a,b] [--thinking N]
 *        [--context served-prev] [--source-override <jsonl id→text>] [--check-of <arm>] [--cap-usd 8] [--concurrency 4]
 *
 *   --thinking N|default   thinkingBudget N (default 0, the production lane's setting); `default` sends NO thinkingConfig
 *                          (the model's own dynamic thinking). Measured 2026-10-03: thinkingBudget 2048 on
 *                          gemini-3-flash-preview billed thinking on 1 of 68 pages, so a budget is a ceiling, not a request
 *   --context served-prev  seed continuity with the SERVED translation of page N-1, as the chained lane does
 *   --source-override F    translate this text instead of the page OCR (a by-eye corrected transcription)
 *   --check-of ARM         not a translation: show the model the source + ARM's English and ask it to check
 *                          negation, numbers and who-does-what, returning the corrected translation (one pass)
 * Every call: temperature 1.0 (the Gemini 3 API default the production lane leaves in place), BLOCK_NONE safety.
 * Refuses to start, and stops, when the xlref-t5 envelope's measured spend + this run's would pass its budget.
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { callGemini } from '../../lib/gemini-script-client.mjs';
import { buildTranslationPrompt, loadTranslationPrompts, sanitizeTranslationTags, PAGE_BREAK_SCOPED } from '../../lib/translate-core.mjs';
import { costOf } from '../../lib/model-pricing.mjs';
import { getScopeSpendUsd } from '../../lib/spend-guard.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] != null ? args[i + 1] : d; };
const RECORDS = opt('records'); const OUT = opt('out'); const ARM = opt('arm'); const MODEL = opt('model');
const IDS = opt('ids', null)?.split(','); const THINK_DEFAULT = opt('thinking', 0) === 'default'; const THINK = THINK_DEFAULT ? 0 : Number(opt('thinking', 0));
const CONTEXT = opt('context', null); const OVERRIDE = opt('source-override', null); const CHECK_OF = opt('check-of', null);
const CAP = Number(opt('cap-usd', 8)); const CONC = Number(opt('concurrency', 4));
const SCOPE = 'xlref-t5'; const ENDPOINT = 'scripts/eval/xlref-t5/run-arms.mjs';
if (!RECORDS || !OUT || !ARM || !MODEL) { console.error('--records --out --arm --model required'); process.exit(1); }
const SAFETY = ['HARM_CATEGORY_HARASSMENT', 'HARM_CATEGORY_HATE_SPEECH', 'HARM_CATEGORY_SEXUALLY_EXPLICIT', 'HARM_CATEGORY_DANGEROUS_CONTENT', 'HARM_CATEGORY_CIVIC_INTEGRITY']
  .map((category) => ({ category, threshold: 'BLOCK_NONE' }));
const idOf = (r) => `${r.book_id}_${String(r.page_number).padStart(5, '0')}`;

const CHECK_PROMPT = `You are checking an English translation of one page of a historical book against its source text.
Check ONLY these four things, sentence by sentence:
1. negation and polarity (affirmed vs negated, "never"/"always", prohibitions, conditions turned into their opposite);
2. numbers, quantities and list items (nothing dropped, merged or miscounted);
3. who does what to whom (subject/object, speaker/addressee, agent/patient);
4. a clause or sentence of the source that the translation silently omits.
Do not restyle, do not improve wording, do not add notes. If you find no such error, return the translation unchanged.
Return JSON only: {"issues":[{"type":"negation|number|role|omission","source":"≤15 words","was":"≤15 words","now":"≤15 words"}],"translation":"<the full translation, corrected only where an issue is listed, every tag and note kept>"}`;

const records = fs.readFileSync(RECORDS, 'utf8').trim().split('\n').map(JSON.parse).filter((r) => !IDS || IDS.includes(idOf(r)));
const overrides = OVERRIDE ? Object.fromEntries(fs.readFileSync(OVERRIDE, 'utf8').trim().split('\n').map(JSON.parse).map((o) => [o.id, o.text])) : null;
const dir = path.join(OUT, ARM); fs.mkdirSync(dir, { recursive: true });

const client = new MongoClient(process.env.MONGODB_URI); await client.connect();
const db = client.db(process.env.MONGODB_DB || 'bookstore');
const prompts = await loadTranslationPrompts(db);
const control = await db.collection('system_config').findOne({ _id: 'processing_control' });
const env = control?.allow_scopes?.[SCOPE];
if (!env?.budget_usd) { console.error(`no ${SCOPE} envelope`); process.exit(2); }
const budget = Math.min(CAP, env.budget_usd);
const envIds = env.book_ids;
const measured = async () => (await getScopeSpendUsd(db, { ids: envIds, since: new Date(env.created_at) }));
let m0 = await measured();
if (m0.meterError) { console.error(`envelope meter unreadable (${m0.meterError}) — refusing`); process.exit(2); }
console.log(`${ARM} (${MODEL}, thinking ${THINK}): ${records.length} pages; envelope ${SCOPE} measured $${m0.usd.toFixed(4)} / $${budget}`);

let spent = 0, done = 0, stop = false;
async function one(r) {
  const id = idOf(r);
  const f = path.join(dir, `${id}.json`);
  if (fs.existsSync(f) || stop) return;
  if (m0.usd + spent >= budget) { stop = true; console.log(`STOP: envelope $${(m0.usd + spent).toFixed(4)} ≥ $${budget}`); return; }
  const book = await db.collection('books').findOne({ id: r.book_id });
  const near = await db.collection('pages').find({ book_id: r.book_id, page_number: { $in: [r.page_number - 1, r.page_number, r.page_number + 1] } }, { projection: { page_number: 1, 'ocr.data': 1, 'translation.data': 1 } }).toArray();
  const by = Object.fromEntries(near.map((p) => [p.page_number, p]));
  const ocrText = overrides?.[id] ?? r.source_text;
  let prompt, promptRef, base = null;
  if (CHECK_OF) {
    base = r.candidates.find((c) => c.arm === CHECK_OF)?.text;
    if (!base) { console.log(`${id}: no ${CHECK_OF} text, skipped`); return; }
    prompt = `${CHECK_PROMPT}\n\n**Source page (${r.lang}):**\n${ocrText}\n\n**Translation to check:**\n${base}`;
    promptRef = { name: 'xlref-t5 check-and-fix', version: 1 };
  } else {
    const previousTranslation = CONTEXT === 'served-prev' ? (by[r.page_number - 1]?.translation?.data || null) : null;
    ({ prompt, promptRef } = buildTranslationPrompt({ prompts, book, ocrText, previousTranslation, prevOcrText: by[r.page_number - 1]?.ocr?.data || undefined, nextOcrText: by[r.page_number + 1]?.ocr?.data || undefined, pageBreak: PAGE_BREAK_SCOPED }));
  }
  const maxOutputTokens = Math.min(32768, Math.max(4096, ocrText.length + 1200)) + (THINK > 0 ? THINK : 0);
  const t0 = Date.now();
  let res;
  try {
    res = await callGemini({ model: MODEL, prompt, endpoint: ENDPOINT, type: 'translation', bookId: r.book_id, ...(THINK_DEFAULT ? { allowThinking: true } : { thinkingBudget: THINK }), temperature: 1.0, maxOutputTokens: maxOutputTokens + (THINK_DEFAULT ? 16384 : 0), safetySettings: SAFETY, promptVersion: String(promptRef?.version ?? ''), triggeredBy: 'xlref-t5' });
  } catch (e) { fs.writeFileSync(path.join(dir, `${id}.failed.json`), JSON.stringify({ id, arm: ARM, model: MODEL, error: String(e.message).slice(0, 500) }, null, 1)); console.log(`${id}: FAILED ${String(e.message).slice(0, 120)}`); return; }
  let text = res.text || '', issues = null;
  if (CHECK_OF) {
    try { const j = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```\s*$/g, '')); issues = j.issues || []; text = j.translation || base; } catch { issues = null; text = base; }
  }
  text = sanitizeTranslationTags(text);
  const cost = costOf(MODEL, res.inputTokens, res.outputTokens); // outputTokens already includes thinking (outputTokensFrom)
  spent += cost; done++;
  fs.writeFileSync(f, JSON.stringify({ id, arm: ARM, model: MODEL, text, finishReason: res.finishReason, inputTokens: res.inputTokens, outputTokens: res.outputTokens, thinkingTokens: res.thinkingTokens, cost_usd_realtime: cost, cost_usd_batch_equiv: cost * 0.5,
    generation_config: { temperature: 1.0, thinkingConfig: THINK_DEFAULT ? 'absent (model default: dynamic thinking)' : { thinkingBudget: THINK }, maxOutputTokens }, context: CONTEXT || 'none (single page, page-break lookahead only)', source_override: !!overrides?.[id], check_of: CHECK_OF, issues, base_sha: base ? base.length : null,
    prompt_ref: promptRef, ms: Date.now() - t0, at: new Date().toISOString() }, null, 1));
}
const queue = [...records];
await Promise.all(Array.from({ length: CONC }, async () => { while (queue.length && !stop) await one(queue.shift()); }));
const m1 = await measured();
console.log(`${ARM}: ${done} written this run, $${spent.toFixed(4)} realtime ($${(spent / 2).toFixed(4)} at Batch); envelope measured now $${m1.usd.toFixed(4)}`);
await client.close();
