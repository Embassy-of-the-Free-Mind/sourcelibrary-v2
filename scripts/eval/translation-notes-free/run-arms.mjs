#!/usr/bin/env node
// PRIOR ART: scripts/eval/translation-prompt-v17/run-arms.mjs (#5698) — this is that runner (production door, metered
// on an envelope, resumable, refuses past a cap), copied. What changed: the arms are v13 twice and `v13-plain`, the
// v13 text with its notes instructions edited out IN MEMORY by the same anchored-replace pattern as that file's FIX
// (each anchor found exactly once, else throw; no prompt row is seeded); the v17 arms are gone; the envelope is
// notes-free-5919; the edited prompt is printed in full and asserted free of "<note>" before any spend; the dry run
// refuses an estimate over $2. It reads the #5698 sample in place (results/translation-prompt-v17-2026-10/sample.jsonl).
/** Prompt arms for #5919: v13 twice (noise floor) and v13-plain (no notes instructions) on the pinned #5698 reference pages; envelope notes-free-5919. */
/**
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/translation-notes-free/run-arms.mjs [--dry-run] [--max-usd 3]
 *
 * Output: results/translation-notes-free-2026-10/work/<arm>/<book>_<page>.json (working dir, not committed);
 * score.mjs --pack folds it into arms.jsonl. Rule: issue #5919 (P1–P4 and the Decision), fixed before any output.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { MongoClient } from 'mongodb';
import { callGemini } from '../../lib/gemini-script-client.mjs';
import { buildTranslationPrompt, getTranslateModelForBook, SAFETY_SETTINGS, sanitizeTranslationTags } from '../../lib/translate-core.mjs';
import { costOf } from '../../lib/model-pricing.mjs';
import { getScopeSpendUsd } from '../../lib/spend-guard.mjs';
import { readJsonl } from '../translation-vs-reference/common.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] != null ? args[i + 1] : d; };
const DIR = new URL('../results/translation-notes-free-2026-10/', import.meta.url).pathname;
const SAMPLE = new URL('../results/translation-prompt-v17-2026-10/sample.jsonl', import.meta.url).pathname;
const MAX_USD = Number(opt('max-usd', 3));
const MAX_ESTIMATE_USD = 2;
const DRY = args.includes('--dry-run');
const CONC = Number(opt('concurrency', 4));
const ENVELOPE = 'notes-free-5919';
const ARMS = {
  'v13-a': { name: 'Standard Translation', version: 13 },
  'v13-b': { name: 'Standard Translation', version: 13 },
};
// v13-plain: the v13 text with the notes instructions removed (#5919). Built in memory; no prompt row is seeded.
// Each anchor must be found exactly once.
const PLAIN = [
  // 1. Inline annotations: no <note>; a term is kept, never defined; <gloss> only for a gloss printed in the source.
  ['- <note>X</note> — interpretive notes, interpolated clarifications\n- <term>X</term> — technical/foreign terms kept in transliteration\n- <gloss>X</gloss> — definition immediately after a <term> tag; also translate interlinear annotations\n',
   '- <term>X</term> — a technical/foreign term kept in transliteration. Do not define it.\n- <gloss>X</gloss> — ONLY for an interlinear gloss printed in the source: translate it. Never a definition of your own.\n'],
  // 2. Do NOT use: single brackets for supplied words only; no parenthetical glosses.
  ['- Square brackets [] for ANY purpose — no [interpolations], no [...continuation], no [L]etter repairs. Use XML tags instead:\n',
   '- Square brackets [] — allowed ONLY for words you must supply for the English sentence to work, e.g. "what a [mere trick] performs". No other use: no [...continuation], no [L]etter repairs. For those:\n'],
  ['  - Interpolated clarifications → <note>...</note>\n', ''],
  ['- Bare (parenthetical glosses) after terms — use <term>word</term> <gloss>meaning</gloss> instead\n',
   '- Parenthetical glosses or definitions — none, anywhere\n'],
  // 3. No "original:" notes. The second half of the sentence is not about notes and stays.
  ['Use <note>original: "..."</note> to preserve important original phrases for scholars, but the main text must be fully readable in English without knowing other languages.',
   'The main text must be fully readable in English without knowing other languages.'],
  // 4. Image descriptions stay in the OCR's own tag, translated literally.
  ['If the OCR contains <image-desc>...</image-desc>, translate the description and wrap the ENTIRE paragraph in <note>...</note>. Image descriptions are editorial content, not original text — they must be toggleable. Do NOT leave image description prose untagged. Example:\n  OCR: <image-desc>A woodcut of a pelican feeding her young</image-desc>\n  Translation: <note>A woodcut depicts a pelican feeding her young from her own breast, a symbol of self-sacrifice in alchemical tradition.</note>\n',
   'If the OCR contains <image-desc>...</image-desc>, keep the tag and translate the description literally inside it. Add no interpretation and wrap it in no other tag. Example:\n  OCR: <image-desc>Ein Holzschnitt: ein Pelikan füttert seine Jungen</image-desc>\n  Translation: <image-desc>A woodcut: a pelican feeding her young</image-desc>\n'],
  // 5. Instructions: items 4 and 5 lose their annotation half; the examples, 6, 7, 8 and the second 8 go.
  ['4. Translate embedded Latin/Greek/Hebrew phrases to English, noting originals when significant.\n5. For foreign terms kept in transliteration: <term>Chesed</term> <gloss>Mercy/Loving-kindness</gloss>\n',
   '4. Translate embedded Latin/Greek/Hebrew phrases to English.\n5. Keep foreign terms in transliteration as <term>X</term>, undefined.\n'],
  ['\n**Examples of annotated translation:**\n- "He composed a very worthy book On the World and Religion <note>original: "De Seculo, & Religione"</note>; one On Fate and Fortune <note>original: "De Fato, & Fortuna"</note>; and another On Law and Medicine <note>original: "Della Legge, e della Medicina"</note>."\n- "The <term>prima materia</term> <gloss>first matter</gloss> must be purified through <term>calcination</term> <gloss>heating to powder</gloss> before the <term>opus</term> <gloss>the Great Work</gloss> can proceed."\n- "According to the <term>Sefer Yetzirah</term> <gloss>Book of Formation</gloss>, the ten <term>sefirot</term> <gloss>divine emanations</gloss> correspond to the paths of wisdom."\n6. For interpolated clarifications: <note>from the aspect of the secret</note>\n7. Add <note>...</note> inline to explain historical references or difficult phrases.\n8. Style: warm museum label - explain rather than assume knowledge.\n9. Preserve the voice and spirit of the original.\n8. Wrap ALL image/illustration descriptions in <note>...</note> — readers can toggle these off.\n9. END with <summary>...</summary> and <keywords>...</keywords> for indexing.\n',
   // 6. The one added line (item 6).
   '6. Do not write notes, definitions, glosses or explanations of any kind. Another step writes the reader\'s notes; your output is the translation only.\n7. Preserve the voice and spirit of the original.\n8. END with <summary>...</summary> and <keywords>...</keywords> for indexing.\n'],
];
const ALL_ARMS = [...Object.keys(ARMS), 'v13-plain'];
const ONLY = opt('arms') ? opt('arms').split(',') : null;
const maxOutputTokensFor = (ocrChars) => Math.min(32768, Math.max(4096, Math.ceil(ocrChars) + 1200)); // translate-worker, one page

const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db('bookstore');
const rows = {};
for (const [arm, q] of Object.entries(ARMS)) {
  const row = await db.collection('prompts').findOne({ type: 'translation', ...q });
  if (!row) throw new Error(`prompt row for ${arm} not found`);
  rows[arm] = { text: row.content, ref: { id: String(row._id), name: row.name, version: row.version, content_hash: row.content_hash } };
  console.log(`${arm.padEnd(12)} ${row.name} v${row.version} ${row.content_hash.slice(0, 8)} default=${!!row.is_default} ${row.content.length} chars`);
}
{
  const def = await db.collection('prompts').findOne({ type: 'translation', is_default: true });
  if (def.name !== 'Standard Translation' || def.version !== 13 || def.content !== rows['v13-a'].text) throw new Error('the live default is no longer "Standard Translation" v13 — the baseline arm is not production');
  let t = rows['v13-a'].text;
  for (const [find, rep] of PLAIN) { if (t.split(find).length !== 2) throw new Error(`plain anchor not found once: ${find.slice(0, 60)}`); t = t.replace(find, () => rep); }
  if (t.includes('<note>') || /<\/?note\b/.test(t)) throw new Error('the edited prompt still contains a <note> tag');
  rows['v13-plain'] = { text: t, ref: { id: null, name: 'Standard Translation v13, notes instructions removed [in memory]', version: 13, content_hash: crypto.createHash('md5').update(t).digest('hex') } };
  fs.mkdirSync(path.join(DIR, 'work'), { recursive: true });
  fs.writeFileSync(path.join(DIR, 'prompt-v13-plain.txt'), t);
  fs.writeFileSync(path.join(DIR, 'work', 'prompt-v13.txt'), rows['v13-a'].text);
  console.log(`v13-plain    in-memory ${rows['v13-plain'].ref.content_hash.slice(0, 8)} (${rows['v13-plain'].ref.content_hash}) ${t.length} chars -> prompt-v13-plain.txt`);
}

const recs = readJsonl(SAMPLE);
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
  const failf = outf.replace(/\.json$/, '.failed.json');
  for (let attempt = 1; ; attempt++) {
    try {
      res = await callGemini({ model, prompt, endpoint: 'scripts/eval/translation-notes-free/run-arms.mjs', thinkingBudget: 0, temperature: 1, maxOutputTokens, safetySettings: SAFETY_SETTINGS, type: 'eval', bookId: ENVELOPE, pageIds: [id], promptVersion: `v${rows[arm].ref.version}`, triggeredBy: `notes-free-5919:${arm}` });
      break;
    } catch (err) {
      if (attempt >= 4 || !/(503|429|500|overloaded|UNAVAILABLE)/i.test(String(err.message))) {
        fs.mkdirSync(path.dirname(outf), { recursive: true });
        fs.writeFileSync(failf, JSON.stringify({ id, arm, error: String(err.message).slice(0, 300), attempts: attempt }, null, 1));
        console.log(`${arm} ${id} FAILED: ${String(err.message).slice(0, 120)}`); return;
      }
      await new Promise((ok) => setTimeout(ok, 4000 * attempt));
    }
  }
  const cost_usd = costOf(model, res.inputTokens, res.outputTokens);
  runUsd += cost_usd;
  fs.mkdirSync(path.dirname(outf), { recursive: true });
  fs.writeFileSync(outf, JSON.stringify({ id, arm, book_id: r.book_id, page_number: r.page_number, lang: r.lang, set: r.set, model, text: sanitizeTranslationTags(res.text), raw_text: sanitizeTranslationTags(res.text) !== res.text ? res.text : undefined, raw_differs: sanitizeTranslationTags(res.text) !== res.text, finishReason: res.finishReason, inputTokens: res.inputTokens, outputTokens: res.outputTokens, cost_usd, ms: Date.now() - t0, generationConfig, prompt_ref: rows[arm].ref, ocr_chars: r.source_text.length }, null, 1));
  if (fs.existsSync(failf)) fs.renameSync(failf, failf.replace(/\.failed\.json$/, '.failed-then-ok.txt'));
}

try {
  for (const arm of (ONLY || ALL_ARMS)) {
    const before = runUsd;
    const queue = [...recs];
    await Promise.all(Array.from({ length: CONC }, async () => { while (queue.length) await runOne(arm, queue.shift()); }));
    console.log(`${arm}: done; ${DRY ? 'estimate' : 'spend'} $${(runUsd - before).toFixed(4)}; run total $${runUsd.toFixed(4)}`);
  }
} finally {
  if (!DRY) { try { envUsd = await metered(); } catch {} }
  await c.close();
}
console.log(`${DRY ? 'ESTIMATED' : 'spent (computed)'} $${runUsd.toFixed(4)}; envelope measured $${envUsd.toFixed(3)}`);
if (DRY && runUsd > MAX_ESTIMATE_USD) { console.error(`ABORT: the estimate $${runUsd.toFixed(2)} is over $${MAX_ESTIMATE_USD}`); process.exit(2); }
