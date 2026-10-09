#!/usr/bin/env node
// PRIOR ART: scripts/eval/xlref-t1 — reused (negfix.mjs there has a Flash pass that reads source + one translation and proposes edits). No script picks among several draws of the same request; this is that picker, blind to the reference and to how the draws were made.
/** Best-of-3 picker for #6202: Gemini Flash reads the source and the three temperature-1 draws (shuffled) and names the most faithful. No reference is shown. */
/**
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/temp-6202/pick.mjs [--work /data/scratch/sl/temp-6202] [--models lite,flash] [--cap-usd 9.6] [--conc 6]
 * Output <work>/picks/<model>/<book>_<page>.json {order, pick_label, pick_arm, differences}. Resumable; shares <work>/ledger.jsonl with run-arms.mjs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { callGemini } from '../../lib/gemini-script-client.mjs';
import { MODEL_FLASH, SAFETY_SETTINGS } from '../../lib/translate-core.mjs';
import { costOf } from '../../lib/model-pricing.mjs';
import { makeRng } from '../lib/paired-stats.mjs';
import { readJsonl } from '../translation-vs-reference/common.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] != null ? args[i + 1] : d; };
const WORK = opt('work', '/data/scratch/sl/temp-6202');
const MODELS = opt('models', 'lite,flash').split(',');
const CAP = Number(opt('cap-usd', 9.6));
const CONC = Number(opt('conc', 6));
const DRAWS = ['T1a', 'T1b', 'T1c'];
const LEDGER = path.join(WORK, 'ledger.jsonl');
let spent = fs.existsSync(LEDGER) ? readJsonl(LEDGER).reduce((s, r) => s + r.usd, 0) : 0;
const hash = (s) => [...s].reduce((a, ch) => (Math.imul(a, 31) + ch.charCodeAt(0)) >>> 0, 7);

export const PICK_PROMPT = (lang, source, cands) => `You are checking three English translations (A, B, C) of the same page of a historical ${lang} text. Decide which ONE is the most faithful to the source.

Judge only fidelity of meaning against the SOURCE below:
- statements whose sense is reversed (a negation dropped or added, who does what to whom, the speaker, a condition);
- sentences, clauses, list items, names or numbers left out;
- content that is not in the source, or fluent English where the source is garbled;
- wrong numbers, names or technical terms.
Style, fluency, layout and the house tags (<note>, <term>, <summary>, <meta> …) are not criteria. Do not prefer a translation for being longer or for having more notes.

SOURCE (an OCR transcription; it may carry errors):
<<<
${source}
>>>

${cands.map((c, i) => `TRANSLATION ${'ABC'[i]}:\n<<<\n${c}\n>>>`).join('\n\n')}

Answer with ONE JSON object and nothing else:
{"differences": ["up to 4 short lines, each naming one place where the translations differ in MEANING and which is right by the source"], "pick": "A" | "B" | "C"}
If you cannot separate them on meaning, pick the one with the fewest omissions; if still tied, pick "A".`;

const recs = readJsonl(path.join(WORK, 'records.jsonl'));
async function one(m, r) {
  const id = `${r.book_id}_${r.page_number}`; const outf = path.join(WORK, 'picks', m, `${id}.json`);
  if (fs.existsSync(outf)) return;
  const texts = {};
  for (const a of DRAWS) { const f = path.join(WORK, 'arms', `${m}-${a}`, `${id}.json`); if (!fs.existsSync(f)) return; texts[a] = JSON.parse(fs.readFileSync(f, 'utf8')).text; }
  const rng = makeRng((6202 ^ hash(`${m}:${id}`)) >>> 0);
  const order = [...DRAWS]; for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  fs.mkdirSync(path.dirname(outf), { recursive: true });
  if (new Set(Object.values(texts)).size === 1) { fs.writeFileSync(outf, JSON.stringify({ id, model_key: m, order, pick_label: 'A', pick_arm: order[0], differences: [], identical: true, cost_usd: 0 })); return; }
  const prompt = PICK_PROMPT(r.lang, r.source_text, order.map((a) => texts[a]));
  if (spent + 0.01 > CAP) throw new Error(`CAP: spent $${spent.toFixed(3)} of $${CAP}`);
  let parsed = null; let raw = ''; let usd = 0;
  for (let attempt = 1; attempt <= 4 && !parsed; attempt++) {
    try {
      const res = await callGemini({ model: MODEL_FLASH, prompt, endpoint: 'scripts/eval/temp-6202/pick.mjs', thinkingBudget: 0, temperature: 0, maxOutputTokens: 700, safetySettings: SAFETY_SETTINGS, type: 'eval', bookId: 'temp-6202', pageIds: [id], triggeredBy: `temp-6202:pick-${m}` });
      const c = costOf(MODEL_FLASH, res.inputTokens, res.outputTokens); usd += c; spent += c;
      fs.appendFileSync(LEDGER, JSON.stringify({ kind: 'pick', model: m, arm: 'BO3-pick', id, in: res.inputTokens, out: res.outputTokens, thinking: res.thinkingTokens || 0, usd: c, finish: res.finishReason, at: new Date().toISOString() }) + '\n');
      raw = res.text || ''; const mm = raw.match(/\{[\s\S]*\}/);
      try { const j = JSON.parse(mm ? mm[0] : raw); if (['A', 'B', 'C'].includes(j.pick)) parsed = j; } catch { const p = raw.match(/"pick"\s*:\s*"([ABC])"/); if (p) parsed = { pick: p[1], differences: [] }; }
    } catch (err) { await new Promise((ok) => setTimeout(ok, 4000 * attempt)); }
  }
  // Registered fallback: a picker that returns nothing usable picks the first shuffled draw (a random draw), flagged.
  const label = parsed?.pick || 'A';
  fs.writeFileSync(outf, JSON.stringify({ id, model_key: m, order, pick_label: label, pick_arm: order['ABC'.indexOf(label)], differences: parsed?.differences || [], fallback: !parsed, cost_usd: usd }));
}
for (const m of MODELS) {
  const queue = [...recs];
  await Promise.all(Array.from({ length: CONC }, async () => { while (queue.length) await one(m, queue.shift()); }));
  const d = path.join(WORK, 'picks', m); const fl = fs.existsSync(d) ? fs.readdirSync(d).map((f) => JSON.parse(fs.readFileSync(path.join(d, f), 'utf8'))) : [];
  const by = {}; for (const p of fl) by[p.pick_arm] = (by[p.pick_arm] || 0) + 1;
  console.log(`${m}: ${fl.length} picks ${JSON.stringify(by)}; label ${JSON.stringify(fl.reduce((a, p) => { a[p.pick_label] = (a[p.pick_label] || 0) + 1; return a; }, {}))}; fallback ${fl.filter((p) => p.fallback).length}; ledger $${spent.toFixed(3)}`);
}
