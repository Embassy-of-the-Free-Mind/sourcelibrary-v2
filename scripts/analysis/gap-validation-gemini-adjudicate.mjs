#!/usr/bin/env node
/**
 * Gemini grounded-search 2nd-model adjudicator for the n≈250 translation-gap
 * validation (issue #2684). The independent instrument for the dual-adjudicator
 * Rogan–Gladen step (the Claude subagent workflow is the primary instrument).
 *
 * For each BLIND work (label stripped) it does grounded web search and returns,
 * in one call: (a) composition era — to split the print-year vs composition-year
 * denominator the pilot proved is the dominant confound — and (b) whether ANY
 * published English translation of THIS work exists.
 *
 * Grounding note (FT paper §8): do NOT set thinkingConfig — thinkingBudget:-1
 * silently SUPPRESSES Google-Search grounding and the model answers "no prior"
 * from memory, over-claiming firsts. We mirror the working ft-verify-gate config:
 * tools:[{googleSearch:{}}], low temperature, no thinkingConfig.
 *
 * Usage: set -a; source .env.production.local; set +a
 *        node scripts/analysis/gap-validation-gemini-adjudicate.mjs [--concurrency 6]
 * Resumable: re-run skips keys already in the out file.
 */
import { GoogleGenAI } from '@google/genai';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const EVAL = path.join(__dir, 'eval-data');
const IN = path.join(EVAL, 'gap-validation-n250-blind.json');
const OUT = path.join(EVAL, 'gap-validation-gemini-verdicts.jsonl');

const args = process.argv.slice(2);
const getArg = (k, d) => { const i = args.indexOf(k); return i > -1 ? args[i + 1] : d; };
const CONC = parseInt(getArg('--concurrency', '6'), 10);
const LIMIT = parseInt(getArg('--limit', '0'), 10); // 0 = all
const MODEL = getArg('--model', 'gemini-3-flash-preview');
const RUN_DATE = new Date().toISOString();

// Key pool — GEMINI_API_KEY / _TIER3 are quota-throttled on v3 grounding; _2/_3 work.
// Rotate per call and fail over on 429 to spread load.
const KEY_NAMES = (getArg('--keys', 'GEMINI_API_KEY_2,GEMINI_API_KEY_3')).split(',');
const KEYS = KEY_NAMES.map((n) => process.env[n]).filter(Boolean);
if (!KEYS.length) { console.error('no Gemini keys in pool'); process.exit(1); }
const clients = KEYS.map((k) => new GoogleGenAI({ apiKey: k }));
let rr = 0;

const works = JSON.parse(fs.readFileSync(IN, 'utf8')).works;
const done = new Set();
if (fs.existsSync(OUT))
  for (const l of fs.readFileSync(OUT, 'utf8').split('\n').filter(Boolean)) { try { done.add(JSON.parse(l).key); } catch {} }
let todo = works.filter((w) => !done.has(w.key));
if (LIMIT > 0) todo = todo.slice(0, LIMIT);
console.error(`Gemini adjudicate: ${works.length} works, ${todo.length} to do → ${OUT}`);

const prompt = (w) => `You are a bibliographic adjudicator for a translation-history study. Investigate ONE early-modern Latin work with REAL web search (Google Books, archive.org, HathiTrust, WorldCat, scholarly bibliographies, tradition catalogues).

WORK: "${w.title}"
AUTHOR: ${w.author || 'unknown'}
PRINTED: ${w.print_year}${w.n_editions > 1 ? ` (${w.n_editions} editions known)` : ''}

Answer TWO questions:

(1) COMPOSITION ERA — when was the TEXT composed (not printed)? An early-modern PRINT of an ancient/medieval author (e.g. a 1540 printing of Cicero, Galen, Aquinas) is "antiquity" or "medieval"; a work written by a contemporary 15th–17th c. author is "renaissance_early_modern". Give your best composition-year estimate.

(2) PRIOR ENGLISH TRANSLATION — has THIS specific work EVER been published in an English translation, by anyone? STRICT RULES:
 - A Latin reprint, a modern critical edition WITHOUT translation, or a facsimile does NOT count.
 - A translation of a DIFFERENT work by the same author does NOT count.
 - A partial/excerpt-only English rendering → relationship "partial" (still report it).
 - If this is a multi-work container / Opera / anthology where "a translation" is ill-defined, set relationship "container".
 - Be skeptical of your own memory: only claim a translation exists if grounded search surfaces it. Do NOT invent translators/years.

Return ONLY JSON:
{"composition_era":"antiquity|medieval|renaissance_early_modern|unknown","composition_year_est":<int|null>,"translation_verdict":"translated|untranslated|uncertain","relationship":"same_work|different_source_language|partial|container|none","prior":"<translator, year, title — or empty>","evidence_url":"<real url or empty>","evidence_strength":"strong|moderate|weak","reasoning":"<=3 sentences"}`;

async function one(w) {
  for (let a = 0; a < 5; a++) {
    const ai = clients[(rr++) % clients.length];
    try {
      const r = await ai.models.generateContent({
        model: MODEL,
        contents: prompt(w),
        config: { tools: [{ googleSearch: {} }], temperature: 0.1 },
      });
      const gm = r.candidates?.[0]?.groundingMetadata || {};
      const queries = gm.webSearchQueries || [];
      const sources = [...new Set((gm.groundingChunks || []).map((c) => c?.web?.uri || c?.web?.title).filter(Boolean))];
      const m = (r.text || '').match(/\{[\s\S]*\}/);
      if (!m) throw new Error('no json');
      const j = JSON.parse(m[0]);
      return { ...j, queries, sources, _grounded: queries.length > 0 };
    } catch (e) {
      if (a === 4) return { translation_verdict: 'FAIL', error: String(e.message || e).slice(0, 120), queries: [], sources: [] };
      await new Promise((r) => setTimeout(r, 1500 * (a + 1)));
    }
  }
}

let i = 0;
async function worker() {
  while (i < todo.length) {
    const w = todo[i++];
    const v = await one(w);
    fs.appendFileSync(OUT, JSON.stringify({ key: w.key, model: MODEL, date: RUN_DATE, ...v }) + '\n');
    if ((i % 25) === 0) console.error(`  ${i}/${todo.length}`);
  }
}
await Promise.all(Array.from({ length: Math.min(CONC, todo.length || 1) }, worker));

const all = fs.readFileSync(OUT, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
const tally = {}; let ungrounded = 0;
for (const x of all) { tally[x.translation_verdict] = (tally[x.translation_verdict] || 0) + 1; if (!x._grounded) ungrounded++; }
console.error(`\nverdict tally: ${JSON.stringify(tally)} · ungrounded(no queries): ${ungrounded}/${all.length}`);
