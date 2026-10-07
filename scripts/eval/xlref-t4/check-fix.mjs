#!/usr/bin/env node
// PRIOR ART: scripts/eval/xlref-t4/arms.mjs (from T1) runs single-call translation arms; scripts/lib/translation-text-repair.mjs repairs TAGS, not meaning; the #5695 brief names a "negation/role check with one stronger-model fix pass on flagged pages" as a lever and nothing in scripts/eval or scripts/lib implements it (looked: git grep -i "negation" scripts/). This is that lever, files only.
/** Lever arm for #5695 T4: a cheap Lite check of an existing translation for reversed polarity / numbers / roles, then ONE Flash fix pass on the pages it flags. */
/**
 *   node --env-file=… scripts/eval/xlref-t4/check-fix.mjs --input <records.jsonl> --base-dir <arms dir> --base prod-A --out <arms dir> [--arm lite-checkfix] [--max-usd 8]
 * Output <out>/<arm>/<book>_<page>.json {text, flagged, flags[], check/fix tokens, cost_usd}. Unflagged pages keep the base text verbatim
 * (cost = the check only). Usage rows are metered on envelope xlref-t4.
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { callGemini } from '../../lib/gemini-script-client.mjs';
import { SAFETY_SETTINGS, MODEL_FLASH, MODEL_LITE, sanitizeTranslationTags } from '../../lib/translate-core.mjs';
import { costOf } from '../../lib/model-pricing.mjs';
import { getScopeSpendUsd } from '../../lib/spend-guard.mjs';
import { readJsonl } from '../translation-vs-reference/common.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] != null ? args[i + 1] : d; };
const INPUT = opt('input'); const BASEDIR = opt('base-dir'); const BASE = opt('base', 'prod-A'); const OUT = opt('out'); const ARM = opt('arm', 'lite-checkfix');
const MAX_USD = Number(opt('max-usd', 8)); const ENVELOPE = 'xlref-t4'; const CONC = Number(opt('concurrency', 4));

const CHECK = (src, en) => `You are checking an English translation of one page against its source text. Look ONLY for places where the English says the OPPOSITE of, or something materially different in polarity, quantity or roles from, the source:
- negation added or dropped (is / is not, permitted / forbidden, never / always)
- a number, quantity or date changed
- subject and object, or speaker and addressee, swapped (who did what to whom)
- a condition, comparison or exception turned around (if/unless, more/less, before/after, all/none)
Ignore style, word choice, notes and tags. Do not report omissions unless the omission reverses the sense. If the source itself is garbled at a place, do not guess.
Return ONLY a JSON array (possibly empty): [{"source":"≤ 12 words of the source","english":"≤ 15 words of the translation, verbatim","kind":"negation|number|role|condition","should_say":"what the source says, in English"}]

SOURCE:
${src}

ENGLISH TRANSLATION:
${en}`;
const FIX = (src, en, flags) => `Below are a source page, its English translation, and a checker's list of places where the translation may reverse the source's meaning (negation, number, roles, condition). For each flagged place, read the source: if the checker is right, correct that sentence in the translation; if the checker is wrong, leave it. Change NOTHING else — keep every other word, tag, note, heading and line break exactly as it is. Output the full corrected translation and nothing else.

FLAGGED PLACES:
${JSON.stringify(flags, null, 1)}

SOURCE:
${src}

TRANSLATION:
${en}`;

const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db(process.env.MONGODB_DB || 'bookstore');
const ctl = await db.collection('system_config').findOne({ _id: 'processing_control' });
const env = ctl?.allow_scopes?.[ENVELOPE];
if (!env?.created_at) throw new Error(`envelope ${ENVELOPE} missing — refusing to spend`);
const s0 = await getScopeSpendUsd(db, { ids: [ENVELOPE], since: new Date(env.created_at) });
if (s0.meterError) throw new Error(`envelope meter unreadable: ${s0.meterError}`);
let runUsd = 0; console.log(`envelope ${ENVELOPE}: measured $${s0.usd.toFixed(3)} / cap $${MAX_USD}`);
const call = (model, prompt, id, stage, maxOutputTokens) => callGemini({ model, prompt, endpoint: 'scripts/eval/xlref-t4/check-fix.mjs', thinkingBudget: 0, temperature: 0, maxOutputTokens, safetySettings: SAFETY_SETTINGS, type: 'eval', bookId: ENVELOPE, pageIds: [id], triggeredBy: `xlref-t4:${ARM}:${stage}` });

async function one(r) {
  const id = `${r.book_id}_${r.page_number}`; const outf = path.join(OUT, ARM, `${id}.json`);
  if (fs.existsSync(outf)) return;
  const bf = path.join(BASEDIR, BASE, `${id}.json`); if (!fs.existsSync(bf)) return;
  const base = JSON.parse(fs.readFileSync(bf, 'utf8')).text;
  if (s0.usd + runUsd > MAX_USD - 0.05) throw new Error('spend cap');
  const chk = await call(MODEL_LITE, CHECK(r.source_text, base), id, 'check', 2048);
  let cost = costOf(MODEL_LITE, chk.inputTokens, chk.outputTokens);
  let flags = []; let parseError = null;
  try { const m = chk.text.match(/\[[\s\S]*\]/); flags = m ? JSON.parse(m[0]) : []; } catch (e) { parseError = String(e.message).slice(0, 100); }
  let text = base; let fix = null;
  if (flags.length) {
    fix = await call(MODEL_FLASH, FIX(r.source_text, base, flags), id, 'fix', Math.min(32768, Math.ceil(base.length / 2) + 2000));
    cost += costOf(MODEL_FLASH, fix.inputTokens, fix.outputTokens);
    if (fix.text && fix.text.trim().length > base.length * 0.6) text = sanitizeTranslationTags(fix.text); // a truncated or refused fix never replaces the base
  }
  runUsd += cost;
  fs.mkdirSync(path.join(OUT, ARM), { recursive: true });
  fs.writeFileSync(outf, JSON.stringify({ id, arm: ARM, base: BASE, model: `${MODEL_LITE} check + ${MODEL_FLASH} fix`, text, flagged: flags.length > 0, n_flags: flags.length, flags, changed: text !== base, parseError,
    check: { inputTokens: chk.inputTokens, outputTokens: chk.outputTokens }, fix: fix ? { inputTokens: fix.inputTokens, outputTokens: fix.outputTokens, finishReason: fix.finishReason } : null, cost_usd: cost, generationConfig: { temperature: 0, thinkingConfig: { thinkingBudget: 0 } } }, null, 1));
}
try {
  const queue = readJsonl(INPUT);
  await Promise.all(Array.from({ length: CONC }, async () => { while (queue.length) { const r = queue.shift(); try { await one(r); } catch (e) { console.log(`${r.book_id}_${r.page_number} FAILED ${String(e.message).slice(0, 150)}`); if (/spend cap/.test(e.message)) throw e; } } }));
} finally { await c.close(); }
console.log(`${ARM}: spent (computed) $${runUsd.toFixed(4)}`);
