#!/usr/bin/env node
// PRIOR ART: scripts/eval/xlref-t4/arms.mjs (#5695 T4) — this is that runner (production door, metered on an
// envelope, resumable, refuses past a cap). It cannot be reused as-is: its arms vary the MODEL or the context under
// the default prompt; here the arm IS the prompt row (v13 twice, v17 study, v17 reading) and no arm gets the
// previous page's served translation. scripts/eval/translation-prompt-ab.mjs takes two versions of ONE prompt name
// over its own 320-page draw and is unmetered.
/** Prompt arms for #5698: v13 twice (noise floor), v17-study, v17-reading on the pinned #5695 reference pages; envelope prompt-v17-5698. */
/**
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/translation-prompt-v17/run-arms.mjs [--dry-run] [--max-usd 6]
 *
 * Output: results/translation-prompt-v17-2026-10/work/<arm>/<book>_<page>.json (working dir, not committed);
 * pack.py folds it into arms.jsonl. Rule: scripts/eval/PREREGISTRATION-translation-prompt-v17.md.
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { callGemini } from '../../lib/gemini-script-client.mjs';
import { buildTranslationPrompt, getTranslateModelForBook, SAFETY_SETTINGS, sanitizeTranslationTags } from '../../lib/translate-core.mjs';
import { costOf } from '../../lib/model-pricing.mjs';
import { getScopeSpendUsd } from '../../lib/spend-guard.mjs';
import { readJsonl } from '../translation-vs-reference/common.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] != null ? args[i + 1] : d; };
const DIR = new URL('../results/translation-prompt-v17-2026-10/', import.meta.url).pathname;
const MAX_USD = Number(opt('max-usd', 6));
const DRY = args.includes('--dry-run');
const CONC = Number(opt('concurrency', 4));
const ENVELOPE = 'prompt-v17-5698';
const ARMS = {
  'v13-a': { name: 'Standard Translation', version: 13 },
  'v13-b': { name: 'Standard Translation', version: 13 },
  'v17-study': { name: 'Standard Translation (study)', version: 17 },
  'v17-reading': { name: 'Standard Translation (reading)', version: 17 },
};
// EXPLORATORY, after unblinding (experiment file, "As executed"): the study row with the two edits the result
// named, built in memory (no prompt row is seeded for it). Run with --arms v17-study-fix; mechanical scoring only.
const FIX = [
  ['- <note>type: X</note> — OUR notes, each opening with its type: original, clarification, context, alternative or image (see "Notes are a typed apparatus")\n',
   '- <note>X</note> — OUR notes. X opens with one of five type words: original, clarification, context, alternative or image (see "Notes are a typed apparatus"). <term> and <gloss> are their own tags and keep their own syntax: never write <note>term: …</note> or <note>gloss: …</note>\n'],
  ['- Do not stack notes: at most one note of each type on a phrase.\n',
   '- Do not stack notes: at most one note of each type on a phrase.\n- The five type words are the only ones. A term kept in transliteration is still <term>X</term> <gloss>meaning</gloss>, exactly as before; it is never a note.\n- An alternative must differ in SENSE from the text. A synonym or a restyling ("or \\"enduring\\"") is not an alternative: leave it out.\n'],
];
const ONLY = opt('arms') ? opt('arms').split(',') : null;
const maxOutputTokensFor = (ocrChars) => Math.min(32768, Math.max(4096, Math.ceil(ocrChars) + 1200)); // translate-worker, one page

const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db('bookstore');
const rows = {};
for (const [arm, q] of Object.entries(ARMS)) {
  const row = await db.collection('prompts').findOne({ type: 'translation', ...q });
  if (!row) throw new Error(`prompt row for ${arm} not found — seed it first (translation-prompt-v17-typed-notes.mjs --apply)`);
  rows[arm] = { text: row.content, ref: { id: String(row._id), name: row.name, version: row.version, content_hash: row.content_hash } };
  console.log(`${arm.padEnd(12)} ${row.name} v${row.version} ${row.content_hash.slice(0, 8)} default=${!!row.is_default} ${row.content.length} chars`);
}
{
  let t = rows['v17-study'].text;
  for (const [find, rep] of FIX) { if (t.split(find).length !== 2) throw new Error(`fix anchor not found once: ${find.slice(0, 60)}`); t = t.replace(find, rep); }
  rows['v17-study-fix'] = { text: t, ref: { id: null, name: 'Standard Translation (study) + fix [in memory]', version: 17, content_hash: (await import('node:crypto')).createHash('md5').update(t).digest('hex') } };
  console.log(`v17-study-fix in-memory ${rows['v17-study-fix'].ref.content_hash.slice(0, 8)} ${t.length} chars`);
}
if (rows['v13-a'].text === rows['v17-study'].text || rows['v17-study'].text === rows['v17-reading'].text) throw new Error('two arms load the SAME prompt text');
if (!rows['v13-a'].ref || (await db.collection('prompts').findOne({ type: 'translation', is_default: true })).version !== 13) throw new Error('the live default is no longer v13 — the baseline arm is not production');

const recs = readJsonl(path.join(DIR, 'sample.jsonl'));
const ctl = await db.collection('system_config').findOne({ _id: 'processing_control' });
const env = ctl?.allow_scopes?.[ENVELOPE];
if (!DRY && !env?.created_at) throw new Error(`envelope ${ENVELOPE} missing — refusing to spend`);
const metered = async () => { const s = await getScopeSpendUsd(db, { ids: [ENVELOPE], since: new Date(env.created_at) }); if (s.meterError) throw new Error(`envelope meter unreadable: ${s.meterError}`); return s.usd; };
let envUsd = DRY ? 0 : await metered();
let runUsd = 0;
console.log(`envelope ${ENVELOPE}: measured $${envUsd.toFixed(3)} / cap $${MAX_USD}`);

const books = new Map();
async function bookOf(id) {
  if (!books.has(id)) books.set(id, await db.collection('books').findOne({ id }, { projection: { id: 1, title: 1, display_title: 1, author: 1, year: 1, published: 1, language: 1, image_source: 1 } }));
  return books.get(id);
}

async function runOne(arm, r) {
  const id = `${r.book_id}_${r.page_number}`;
  const outf = path.join(DIR, 'work', arm, `${id}.json`);
  if (fs.existsSync(outf)) return;
  const book = await bookOf(r.book_id);
  if (!book) throw new Error(`book ${r.book_id} not found`);
  const model = getTranslateModelForBook(book);
  // The arm's prompt goes in through the production door; no previous-page translation in any arm (preregistered).
  const { prompt } = buildTranslationPrompt({ prompts: { translation: rows[arm], english: rows[arm] }, book, ocrText: r.source_text, previousTranslation: null });
  const maxOutputTokens = maxOutputTokensFor(r.source_text.length);
  const generationConfig = { temperature: 1, maxOutputTokens, thinkingConfig: { thinkingBudget: 0 } };
  if (DRY) { runUsd += costOf(model, prompt.length / 3.5, r.source_text.length / 3 + 500); return; }
  if (envUsd + runUsd > MAX_USD - 0.05) throw new Error(`spend cap: envelope $${envUsd.toFixed(3)} + run $${runUsd.toFixed(3)} ≥ $${MAX_USD}`);
  let res; const t0 = Date.now();
  for (let attempt = 1; ; attempt++) {
    try {
      res = await callGemini({ model, prompt, endpoint: 'scripts/eval/translation-prompt-v17/run-arms.mjs', thinkingBudget: 0, temperature: 1, maxOutputTokens, safetySettings: SAFETY_SETTINGS, type: 'eval', bookId: ENVELOPE, pageIds: [id], promptVersion: `v${rows[arm].ref.version}`, triggeredBy: `prompt-v17-5698:${arm}` });
      break;
    } catch (err) {
      if (attempt >= 4 || !/(503|429|500|overloaded|UNAVAILABLE)/i.test(String(err.message))) {
        fs.mkdirSync(path.dirname(outf), { recursive: true });
        fs.writeFileSync(outf.replace(/\.json$/, '.failed.json'), JSON.stringify({ id, arm, error: String(err.message).slice(0, 300), attempts: attempt }, null, 1));
        console.log(`${arm} ${id} FAILED: ${String(err.message).slice(0, 120)}`); return;
      }
      await new Promise((ok) => setTimeout(ok, 4000 * attempt));
    }
  }
  const cost_usd = costOf(model, res.inputTokens, res.outputTokens);
  runUsd += cost_usd;
  fs.mkdirSync(path.dirname(outf), { recursive: true });
  fs.writeFileSync(outf, JSON.stringify({ id, arm, book_id: r.book_id, page_number: r.page_number, lang: r.lang, set: r.set, model, text: sanitizeTranslationTags(res.text), raw_differs: sanitizeTranslationTags(res.text) !== res.text, finishReason: res.finishReason, inputTokens: res.inputTokens, outputTokens: res.outputTokens, cost_usd, ms: Date.now() - t0, generationConfig, prompt_ref: rows[arm].ref, ocr_chars: r.source_text.length }, null, 1));
}

try {
  for (const arm of (ONLY || Object.keys(ARMS))) {
    const queue = [...recs];
    await Promise.all(Array.from({ length: CONC }, async () => { while (queue.length) await runOne(arm, queue.shift()); }));
    console.log(`${arm}: done; run spend so far $${runUsd.toFixed(4)}`);
  }
} finally {
  if (!DRY) { try { envUsd = await metered(); } catch {} }
  await c.close();
}
console.log(`${DRY ? 'ESTIMATED' : 'spent (computed)'} $${runUsd.toFixed(4)}; envelope measured $${envUsd.toFixed(3)}`);
