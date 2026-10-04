#!/usr/bin/env node
// PRIOR ART: scripts/eval/xlref-t1/arms.mjs runs one-call arms; no script screens an existing translation for reversed sense and repairs only the flagged pages. scripts/maintenance/note-claims-verify.mjs checks NOTES against the web, not polarity against the source. The #5695 back-translation job (xlref-backtrans) builds reference-free detectors; this is the cheapest in-lane form of one (same model family, one extra call), measured as a lever.
/** Negation/role check lever for #5695 T1: lite screens the production translation against the Latin for reversed sense; flagged pages get one flash fix pass. Files only; metered on envelope xlref-t1. */
/**
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/xlref-t1/negfix.mjs \
 *        --input <records.jsonl> --base-dir <arms/prod-A> --out <arms/negfix> [--max-usd 8]
 * Output <out>/<book>_<page>.json {text, flagged, flags[], check/fix tokens, cost_usd}. Unflagged pages carry the base text unchanged.
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
const INPUT = opt('input'); const BASE = opt('base-dir'); const OUT = opt('out'); const MAX_USD = Number(opt('max-usd', 8));
const ENVELOPE = 'xlref-t1';
if (!INPUT || !BASE || !OUT) { console.error('--input --base-dir --out required'); process.exit(1); }

const CHECK = (src, en) => `You are checking an English translation of one page of a Latin book for REVERSED SENSE only. Compare every sentence of the translation with the Latin and list places where the English says the opposite of, or materially other than, the Latin because of:
- a negation dropped, added or mis-scoped (non, haud, nec, nemo non, nihil non, non nisi, ne … quidem, minime, vix, double negatives, litotes);
- subject and object, agent and patient, or speakers swapped (who does what to whom);
- a comparative or condition turned around (magis/minus, prius/posterius, si/nisi, quam);
- a number or quantity changed.
Ignore style, word choice, notes, summaries and omissions. Do not list a place unless you can quote the Latin words that prove it. If there are none, return [].
Return ONLY a JSON array: [{"latin":"≤ 15 words","english":"≤ 15 words","problem":"one line","correct":"what it should say"}].

LATIN PAGE:
${src}

ENGLISH TRANSLATION:
${en}`;
const FIX = (src, en, flags) => `Below are a Latin page, its English translation, and a list of places where a checker suspects the English reverses or changes the sense of the Latin. For each suspected place, re-read the Latin: if the checker is right, correct that sentence; if the checker is wrong, leave it. Change NOTHING else — keep every tag, note, heading, summary and all other wording exactly as they are. Output ONLY the full corrected translation.

SUSPECTED PLACES:
${JSON.stringify(flags, null, 1)}

LATIN PAGE:
${src}

ENGLISH TRANSLATION:
${en}`;

const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db(process.env.MONGODB_DB || 'bookstore');
const ctl = await db.collection('system_config').findOne({ _id: 'processing_control' });
const env = ctl?.allow_scopes?.[ENVELOPE];
if (!env?.created_at) throw new Error(`envelope ${ENVELOPE} missing — refusing to spend`);
const s0 = await getScopeSpendUsd(db, { ids: [ENVELOPE], since: new Date(env.created_at) });
if (s0.meterError) throw new Error(`envelope meter unreadable: ${s0.meterError}`);
let runUsd = 0; let flagged = 0; let changed = 0;
console.log(`envelope measured $${s0.usd.toFixed(3)} / cap $${MAX_USD}`);
const parse = (t) => { const a = t.indexOf('['); const b = t.lastIndexOf(']'); if (a < 0 || b < a) return null; try { return JSON.parse(t.slice(a, b + 1)); } catch { return null; } };
const call = async (model, prompt, id, step, maxOutputTokens) => {
  for (let attempt = 1; ; attempt++) {
    try { return await callGemini({ model, prompt, endpoint: 'scripts/eval/xlref-t1/negfix.mjs', thinkingBudget: 0, temperature: 0, maxOutputTokens, safetySettings: SAFETY_SETTINGS, type: 'eval', bookId: ENVELOPE, pageIds: [id], triggeredBy: `xlref-t1:negfix-${step}` }); }
    catch (err) { if (attempt >= 4) throw err; await new Promise((ok) => setTimeout(ok, 4000 * attempt)); }
  }
};
fs.mkdirSync(OUT, { recursive: true });
const queue = readJsonl(INPUT);
async function one(r) {
  const id = `${r.book_id}_${r.page_number}`; const outf = path.join(OUT, `${id}.json`);
  if (fs.existsSync(outf)) { const j = JSON.parse(fs.readFileSync(outf, 'utf8')); if (j.flagged) flagged++; if (j.changed) changed++; return; }
  if (s0.usd + runUsd > MAX_USD - 0.05) throw new Error('spend cap');
  const base = JSON.parse(fs.readFileSync(path.join(BASE, `${id}.json`), 'utf8'));
  const chk = await call(MODEL_LITE, CHECK(r.source_text, base.text), id, 'check', 2000);
  let cost = costOf(MODEL_LITE, chk.inputTokens, chk.outputTokens);
  const flags = parse(chk.text);
  let text = base.text; let fix = null;
  if (flags && flags.length) {
    fix = await call(MODEL_FLASH, FIX(r.source_text, base.text, flags), id, 'fix', Math.min(32768, Math.max(4096, base.text.length)));
    cost += costOf(MODEL_FLASH, fix.inputTokens, fix.outputTokens);
    const t = sanitizeTranslationTags(fix.text);
    if (t.length > 0.7 * base.text.length) text = t; // a truncated fix never replaces the page
    flagged++; if (text !== base.text) changed++;
  }
  runUsd += cost;
  fs.writeFileSync(outf, JSON.stringify({ id, arm: 'negfix', base_arm: path.basename(BASE), text, flagged: !!(flags && flags.length), changed: text !== base.text, flags: flags || [], check_parse_failed: flags == null, check: { model: MODEL_LITE, in: chk.inputTokens, out: chk.outputTokens }, fix: fix ? { model: MODEL_FLASH, in: fix.inputTokens, out: fix.outputTokens } : null, cost_usd: cost }, null, 1));
}
try { await Promise.all(Array.from({ length: 5 }, async () => { while (queue.length) await one(queue.shift()); })); } finally { await c.close(); }
console.log(`negfix: ${flagged} flagged, ${changed} changed; spent (computed) $${runUsd.toFixed(4)}`);
