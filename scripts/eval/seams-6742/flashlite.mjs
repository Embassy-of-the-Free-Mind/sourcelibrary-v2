#!/usr/bin/env node
// PRIOR ART: scripts/eval/seam-ab-5678.mjs and scripts/eval/translation-page-break-fix-ab.mjs RE-TRANSLATE the break
// (an arm is a translation prompt); scripts/eval/jev/seam-continuity-pilot.mjs scores English-only continuity (AUC
// 0.49 on mid-flow seams, #4681). None asks a cheap model to DETECT a defect in a stored join with both sources in
// view, or to repair only the boundary sentences. Calls go through scripts/lib/gemini-script-client.mjs (thinking
// off, usage logged); the model is fixed to gemini-3.1-flash-lite by the brief.
/**
 * flashlite — source-grounded seam DETECT and REPAIR arms on gemini-3.1-flash-lite, over the Opus reference items (#6742).
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/seams-6742/flashlite.mjs detect --out=DIR [--arms=D1,D2,D3]
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/seams-6742/flashlite.mjs repair --out=DIR [--arms=R1,R2,R3]
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/seams-6742/flashlite.mjs verify --out=DIR [--arms=R1,R3]
 *     (verify: D4 run again on each REPAIRED join — the gate a corpus apply would use; writes verify-<arm>.jsonl)
 *
 * DIR is the opus-reference directory (items.jsonl, labels.jsonl). Writes detect-<arm>.jsonl / repair-<arm>.jsonl,
 * resumable. Every call is priced at the list rate (model-pricing.mjs) into spend.jsonl; a step refuses to start when
 * its estimate exceeds what is left of the job cap ($8, --cap), and stops mid-step if the ledger reaches the cap.
 * REPAIR runs on every item Opus labelled not-ok (planted ones included), plus 30 Opus-ok items as a do-no-harm check.
 */
import fs from 'fs';
import path from 'path';
import { callGemini } from '../../lib/gemini-script-client.mjs';
import { costOf, BATCH_MULTIPLIER } from '../../lib/model-pricing.mjs';
import { extractJson, shuffle } from './lib.mjs';
import { validRepair } from './opus-reference.mjs';
import { applyRepair } from './judge-repairs.mjs';
import { makeRng } from '../lib/paired-stats.mjs';

export const MODEL = 'gemini-3.1-flash-lite';
const ENDPOINT = 'scripts/eval/seams-6742/flashlite.mjs';
const arg = (k, d) => process.argv.find(a => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=') ?? d;
const readJsonl = (f) => fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];

const EXCERPTS = (it) => `=== SOURCE N (end) ===
${it.srcTailA}

=== SOURCE N+1 (start) ===
${it.srcHeadB}

=== ENGLISH N (end) ===
${it.enTailA}

=== ENGLISH N+1 (start) ===
${it.enHeadB}`;

const COMMON = `You are checking ONE page turn in an English translation of a historical book: the end of page N and the start
of page N+1, source (OCR) and English for both. Excerpts may be cut at "…" on their far side; judge only the turn.
NOT defects: English ending mid-sentence where the source does; a hyphen-split word translated whole on page N; a
catchword left untranslated or rendered once; a full stop added with the meaning intact; running heads and page numbers.`;

export const DETECT = {
  // D1: yes/no with a reason and a probability.
  D1: (it) => `${COMMON}

Question: is there a DEFECT at the turn — source words near the turn left out, translated twice, put on the wrong
page, or English that does not read correctly across the turn?

${EXCERPTS(it)}

Reply with one JSON object only: {"defect":"yes"|"no","p_defect":0-100,"reason":"<= 25 words"}`,
  // D2: a typed label with confidence.
  D2: (it) => `${COMMON}

Label the turn with ONE of:
- "ok": every source word near the turn is rendered once, on its own page, and the English reads across correctly;
- "omission": 2+ source words near the turn rendered on neither page;
- "duplication": source words near the turn rendered on both pages;
- "drift": ~6+ source words rendered on the wrong page, nothing lost;
- "broken_syntax": read across, the sentence does not parse or its meaning changes (words invented to close or bridge);
- "catchword": a catchword or split word rendered twice or mistranslated;
- "other": another defect at the turn.

${EXCERPTS(it)}

Reply with one JSON object only: {"label":"...","p_defect":0-100,"reason":"<= 25 words"}`,
  // D3: a checklist, answered from the source first.
  D3: (it) => `${COMMON}

Work in this order. (1) Find the last source sentence of page N and the first of page N+1, and say whether the
source sentence runs across the turn. (2) Find where each is rendered in the English. (3) Answer the checks.

${EXCERPTS(it)}

Reply with one JSON object only:
{"source_runs_across":true|false,"omitted":true|false,"duplicated":true|false,"moved_to_wrong_page":true|false,
 "reads_across":"ok"|"broken","p_defect":0-100,"note":"<= 25 words"}`,
};
// D4: D1 with flash-lite's own reasoning turned on (2,048-token budget; same model, billed as output).
// D5: D1 on the last / first 500 characters of each excerpt only — the turn, without the page around it.
const cut = (it, n) => ({ ...it, srcTailA: '…' + it.srcTailA.slice(-n), srcHeadB: it.srcHeadB.slice(0, n) + '…', enTailA: '…' + it.enTailA.slice(-n), enHeadB: it.enHeadB.slice(0, n) + '…' });
DETECT.D4 = DETECT.D1;
DETECT.D5 = (it) => DETECT.D1(cut(it, 500));
export const ARM_OPTS = { D4: { thinkingBudget: 2048 }, R3: { thinkingBudget: 2048 } };

const REPAIR_FORMAT = `Reply with one JSON object only:
{"defect":true|false,"repair":null | {"tail_old":"...","tail_new":"...","head_old":"...","head_new":"..."}}
tail_old must be copied VERBATIM from the END of ENGLISH N (exact substring) and head_old VERBATIM from the START of
ENGLISH N+1; use "" for a side you do not change. If the turn is already correct, {"defect":false,"repair":null}.`;

export const REPAIR = {
  // R1: minimal rewrite of the boundary sentences.
  R1: (it) => `${COMMON}

Task: if the turn is defective, rewrite ONLY the last sentence(s) of ENGLISH N and/or the first sentence(s) of
ENGLISH N+1 so that each page renders exactly its own source words and the two read across as one correct sentence.
Change as few words as possible and keep the translator's style and terms. Page N may end mid-sentence (no full
stop) when the source does; N+1 then continues in lowercase.

${EXCERPTS(it)}

${REPAIR_FORMAT}`,
  // R2: align first (source words at the turn → which page renders them), then repair.
  R2: (it) => `${COMMON}

Task, in two steps.
Step 1 — align: list the source words of the last line of page N and the first line of page N+1, and for each say
where the English renders it: "N", "N+1", "both" or "none".
Step 2 — repair: if any word is "both" or "none", or a word of N+1 is rendered on N (or the reverse), or the English
does not read across, rewrite ONLY the boundary sentence(s) so every source word is rendered once, on its own page,
and the turn reads as one correct sentence. Change as few words as possible; keep the translator's style.

${EXCERPTS(it)}

Reply with one JSON object only:
{"alignment":[["<source word>","N|N+1|both|none"],...],"defect":true|false,
 "repair":null | {"tail_old":"...","tail_new":"...","head_old":"...","head_new":"..."}}
tail_old must be copied VERBATIM from the END of ENGLISH N and head_old VERBATIM from the START of ENGLISH N+1; ""
for a side you do not change.`,
};
// R3: R1 with flash-lite's reasoning on (2,048 tokens), as D4 is to D1.
REPAIR.R3 = REPAIR.R1;

// ── spend ledger ─────────────────────────────────────────────────────────────
const ledgerFile = (out) => path.join(out, 'spend.jsonl');
export const spent = (out) => readJsonl(ledgerFile(out)).reduce((a, x) => a + x.usd, 0);
const priced = (inTok, outTok) => costOf(MODEL, inTok, outTok);
export const batchPriced = (inTok, outTok) => costOf(MODEL, inTok, outTok) * BATCH_MULTIPLIER;

async function runArm(out, kind, arm, items, cap, conc = Number(arg('conc', 8))) {
  const file = path.join(out, `${kind}-${arm}.jsonl`);
  const done = new Set(readJsonl(file).filter(x => x.parsed).map(x => x.id));
  const todo = items.filter(x => !done.has(x.id));
  const build = kind === 'repair' ? REPAIR[arm] : DETECT[kind === 'verify' ? 'D4' : arm];
  const optArm = kind === 'verify' ? 'D4' : arm;
  // Estimate: prompt chars / 3.2 per token in, ~150 (detect) or ~450 (repair) out.
  const estIn = todo.reduce((a, it) => a + build(it).length / 3.2, 0), estOut = todo.length * ((kind === 'repair' ? 450 : 150) + (ARM_OPTS[optArm]?.thinkingBudget || 0));
  const est = priced(estIn, estOut);
  const left = cap - spent(out);
  console.log(`${kind} ${arm}: ${todo.length} calls, estimate $${est.toFixed(3)}, left $${left.toFixed(3)}`);
  if (est > left) { console.log(`REFUSED: estimate exceeds what is left of the cap`); return false; }
  let i = 0;
  async function worker() {
    while (i < todo.length) {
      if (spent(out) >= cap) { console.log('cap reached, stopping'); return; }
      const it = todo[i++];
      let r = null, err = null;
      for (let attempt = 0; attempt < 3 && !r; attempt++) {
        try { r = await callGemini({ model: MODEL, prompt: build(it), endpoint: ENDPOINT, temperature: 0, maxOutputTokens: (kind === 'repair' ? 2500 : 600) + (ARM_OPTS[optArm]?.thinkingBudget || 0), ...(ARM_OPTS[optArm] || {}), type: 'eval', promptVersion: `seams-6742-${arm}` }); }
        catch (e) { err = String(e.message || e).slice(0, 300); await new Promise(res => setTimeout(res, (/429/.test(err) ? 20000 : 3000) * (attempt + 1))); }
      }
      if (r) fs.appendFileSync(ledgerFile(out), JSON.stringify({ arm: kind === 'verify' ? `verify-${arm}` : arm, id: it.id, in: r.inputTokens, out: r.outputTokens, usd: priced(r.inputTokens, r.outputTokens) }) + '\n');
      const j = r ? extractJson(r.text) : null;
      const parsed = !!j && (kind === 'repair' || typeof j.p_defect === 'number');
      const row = { id: it.id, arm, parsed, ...(j || {}), finish: r?.finishReason, err: err || undefined, raw: parsed ? undefined : r?.text?.slice(0, 1500) };
      if (kind === 'repair' && j) row.repairCheck = validRepair(it, j.repair);
      fs.appendFileSync(file, JSON.stringify(row) + '\n');
    }
  }
  await Promise.all(Array.from({ length: conc }, worker));
  return true;
}

async function main() {
  const cmd = process.argv[2], out = arg('out'), cap = Number(arg('cap', 8));
  if (!out || !['detect', 'repair', 'verify'].includes(cmd)) { console.error('usage: detect|repair --out=DIR [--arms=..]'); process.exit(2); }
  const items = readJsonl(path.join(out, 'items.jsonl'));
  if (cmd === 'detect') {
    for (const arm of arg('arms', 'D1,D2,D3').split(',')) if (!(await runArm(out, 'detect', arm, items, cap))) break;
  } else if (cmd === 'verify') {
    for (const arm of arg('arms', 'R1,R3').split(',')) {
      const reps = new Map(readJsonl(path.join(out, `repair-${arm}.jsonl`)).filter(x => x.parsed && x.defect !== false).map(x => [x.id, x.repair]));
      const fixed = items.map(it => { const f = applyRepair(it, reps.get(it.id)); return f ? { ...it, ...f } : null; }).filter(Boolean);
      if (!(await runArm(out, 'verify', arm, fixed, cap))) break;
    }
  } else {
    const labels = new Map(readJsonl(path.join(out, 'labels.jsonl')).filter(x => x.parsed).map(x => [x.id, x]));
    const bad = items.filter(it => labels.get(it.id) && labels.get(it.id).label !== 'ok');
    const okItems = shuffle(items.filter(it => labels.get(it.id)?.label === 'ok'), makeRng(6742)).slice(0, 30);
    const set = [...bad, ...okItems];
    fs.writeFileSync(path.join(out, 'repair-set.json'), JSON.stringify({ bad: bad.map(x => x.id), ok: okItems.map(x => x.id) }) + '\n');
    for (const arm of arg('arms', 'R1,R2').split(',')) if (!(await runArm(out, 'repair', arm, set, cap))) break;
  }
  console.log(`ledger total $${spent(out).toFixed(4)}`);
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.error(e); process.exit(1); });
