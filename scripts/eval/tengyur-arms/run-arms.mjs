#!/usr/bin/env node
// PRIOR ART: scripts/eval/tengyur-ref/run-arms.mjs (PR #5704) — arms A/B through the Batch API, whose
// B request (buildTranslationPrompt + PAGE_BREAK_SCOPED, no context) is the BASE here and is rebuilt
// byte for byte from the same imports and the same pinned v13 prompt document (state.json). It has no
// lever hooks and its rounds take hours; these arms are ≤ 113 pages each, so they go realtime through
// gemini-script-client (thinking OFF unless an arm sets a budget, every call metered).
/**
 * run-arms.mjs — the quality arms of the Tengyur 84000-reference test (#5497). Eval only: outputs go to
 * <out>/arms/<ARM>.jsonl, NEVER to pages.translation.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/tengyur-arms/run-arms.mjs \
 *        --arm B2|C|D|X2|E|COMBO [--levers C,D,X2,E] [--pages sample|all] [--cap-usd 13.5] [--conc 6]
 *
 *   B2     the base (B) again: same prompt, same model — the noise floor (X1).
 *   C      B + the page's aligned Sanskrit (build-parallel.py), REFERENCE-ONLY, pages with a parallel.
 *   D      B + the page's Mahāvyutpatti term list (build-glossary.py).
 *   X2     B with a fixed thinking budget (THINK_BUDGET), everything else equal.
 *   E      B's own English, second pass on pages negcheck.py flags: gemini-3.1-pro-preview returns
 *          minimal find/replace edits fixing reversed or role-swapped statements only.
 *   COMBO  the levers in --levers applied together (prompt levers into one request; E after).
 * Spend: --cap-usd is checked against this run's ledger (all arms, <out>/ledger.jsonl) before every call.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { PAGE_BREAK_SCOPED, buildTranslationPrompt, sanitizeTranslationTags, SAFETY_SETTINGS } from '../../lib/translate-core.mjs';
import { maxOutputTokensFor } from '../../lib/translate-batch-seam.mjs';
import { costOf, BATCH_MULTIPLIER } from '../../lib/model-pricing.mjs';
import { callGemini } from '../../lib/gemini-script-client.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] != null ? args[i + 1] : d; };
const TREF = opt('tref', '/root/tref');
const OUT = opt('out', '/root/tarms');
const ARM = opt('arm');
const CAP = Number(opt('cap-usd', 13.5));
const CONC = Number(opt('conc', 6));
const MODEL = 'gemini-3-flash-preview';
const FIX_MODEL = 'gemini-3.1-pro-preview';
const THINK_BUDGET = Number(opt('think', 2048));
const FIX_THINK = 1024;
const ENDPOINT = 'eval/tengyur-arms-5497';
const SAMPLE = 'scripts/eval/results/tengyur-ref-2026-10/judge/sample.json';
fs.mkdirSync(path.join(OUT, 'arms'), { recursive: true });

const readJsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const LEDGER = path.join(OUT, 'ledger.jsonl');
let spent = readJsonl(LEDGER).reduce((n, r) => n + r.usd, 0);

const state = JSON.parse(fs.readFileSync(path.join(TREF, 'arms', 'state.json'), 'utf8'));
if (Number(state.prompt_ref.version) !== 13) throw new Error('base prompt is not v13');
const books = JSON.parse(fs.readFileSync(path.join(TREF, 'pages', 'books.json'), 'utf8'));
const ref = new Map(readJsonl(path.join(TREF, 'ref', 'reference.jsonl')).map((r) => [r.page_id, r]));
const gloss = new Map(readJsonl(path.join(OUT, 'levers', 'gloss.jsonl')).map((g) => [g.page_id, g.terms]));
const skt = new Map(readJsonl(path.join(OUT, 'levers', 'skt.jsonl')).map((s) => [s.page_id, s]));
const sampleIds = JSON.parse(fs.readFileSync(SAMPLE, 'utf8')).map((s) => s.page_id);
const pageIds = opt('pages', 'sample') === 'all' ? [...ref.keys()] : sampleIds;

export const GLOSSARY_HEAD = '**Glossary for this page (Tibetan → Sanskrit, from the Mahāvyutpatti; an identification aid only — a Tibetan term can have other senses, so follow the context; choose the English yourself, and do not add the Sanskrit to the translation beyond what you would otherwise give):**';
export const SANSKRIT_HEAD = "**Sanskrit parallel (the Indic original of the verses on this page, with up to one verse either side; reference only — translate the TIBETAN above, not this; where the two differ, follow the Tibetan; do not quote or translate the Sanskrit, and do not mention it):**";

function basePrompt(r) {
  return buildTranslationPrompt({ prompts: state.prompts, book: books[r.vol], ocrText: r.src, pageBreak: PAGE_BREAK_SCOPED }).prompt;
}
function leverPrompt(r, levers) {
  let p = basePrompt(r);
  if (levers.includes('D')) {
    const t = gloss.get(r.page_id) || [];
    if (t.length) p += `\n\n${GLOSSARY_HEAD}\n${t.map(([tib, s]) => `- ${tib} — ${s}`).join('\n')}`;
  }
  if (levers.includes('C')) {
    const s = skt.get(r.page_id);
    if (s) p += `\n\n${SANSKRIT_HEAD}\n${s.sanskrit}`;
  }
  return p;
}

function fixPrompt(r, draft, flagged) {
  return `You are checking a draft English translation of ONE page of a Tibetan Buddhist treatise (Derge Tengyur) against the Tibetan of that page.

Fix ONLY statements whose meaning is REVERSED against the Tibetan:
- a negation added or lost (affirmed ↔ negated, "is" ↔ "is not", possible ↔ impossible, exists ↔ does not exist);
- agent and patient, or speaker and addressee, swapped (for example a vocative "O Lord" turned into the Lord speaking, or the one addressed made the one who speaks);
- a refuted opponent's view given as the author's own, or the reverse.
Do NOT change anything else: not terminology, not style, not a weaker or vaguer rendering, not the tags (<term>, <gloss>, <note>, <meta>, <summary>, <keywords>). Most pages need no edit at all; an empty list is the normal answer.

A script flagged these English sentences as places where the negations or the speaker may not match the Tibetan. The script is often wrong; check them, and anything else you see that is reversed:
${flagged.map((s) => `- ${s}`).join('\n') || '- (no sentence named; the page-level negation count differs)'}

TIBETAN (the page):
${r.src}

DRAFT ENGLISH:
${draft}

Answer with JSON only, no prose: {"edits": [{"old": "an exact, unique substring of the draft (a clause, not a whole paragraph)", "new": "its replacement", "why": "which Tibetan words show the reversal"}]}`;
}

function applyEdits(draft, edits) {
  let out = draft, applied = 0, rejected = [];
  for (const e of edits || []) {
    if (!e?.old || typeof e.new !== 'string') { rejected.push({ ...e, reason: 'shape' }); continue; }
    const n = out.split(e.old).length - 1;
    if (n !== 1) { rejected.push({ old: e.old, reason: n ? 'not unique' : 'not found' }); continue; }
    if (e.old.length > 600) { rejected.push({ old: e.old.slice(0, 80), reason: 'too long (not minimal)' }); continue; }
    out = out.replace(e.old, e.new); applied++;
  }
  return { text: out, applied, rejected };
}

function flagsFor(pid, en) {
  const r = ref.get(pid);
  const tmp = `/tmp/negcheck-${process.pid}`;
  fs.writeFileSync(`${tmp}.src`, r.src); fs.writeFileSync(`${tmp}.en`, en);
  return JSON.parse(execFileSync('python3', ['scripts/eval/tengyur-arms/negcheck.py', '--src', `${tmp}.src`, '--en', `${tmp}.en`], { encoding: 'utf8' }));
}

async function call({ model, prompt, thinkingBudget, maxOutputTokens, r, arm }) {
  const estIn = prompt.length / 3, estOut = maxOutputTokens * 0.5;
  const est = costOf(model, estIn, estOut);
  if (spent + est > CAP) throw new Error(`CAP: spent $${spent.toFixed(3)} + est $${est.toFixed(3)} > $${CAP}`);
  let last;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await callGemini({
        model, prompt, endpoint: ENDPOINT, type: 'eval', bookId: r.book_id, pageIds: [r.page_id], promptVersion: 'v13',
        triggeredBy: 'tengyur-arms-5497', safetySettings: SAFETY_SETTINGS, maxOutputTokens,
        // B ran in the Batch API at the model's default temperature (1.0 for Gemini 3); keep it.
        temperature: 1.0,
        ...(typeof thinkingBudget === 'number' ? { thinkingBudget } : {}),
      });
      const usd = costOf(model, res.inputTokens, res.outputTokens);
      spent += usd;
      fs.appendFileSync(LEDGER, JSON.stringify({ arm, page_id: r.page_id, model, in: res.inputTokens, out: res.outputTokens, thinking: res.thinkingTokens, usd, at: new Date().toISOString() }) + '\n');
      return { ...res, usd, batch_usd: usd * BATCH_MULTIPLIER };
    } catch (e) {
      last = e;
      if (String(e.message).startsWith('CAP')) throw e;
      await new Promise((s) => setTimeout(s, 3000 * (attempt + 1)));
    }
  }
  throw last;
}

async function pool(items, fn) {
  const q = [...items]; const errs = [];
  await Promise.all(Array.from({ length: CONC }, async () => {
    for (let it = q.shift(); it; it = q.shift()) {
      try { await fn(it); } catch (e) { errs.push(String(e.message)); if (String(e.message).startsWith('CAP')) { q.length = 0; } }
    }
  }));
  return errs;
}

async function main() {
  if (!ARM) { console.error('--arm B2|C|D|X2|E|COMBO'); process.exit(1); }
  const levers = ARM === 'COMBO' ? String(opt('levers', '')).split(',').filter(Boolean) : [ARM];
  const name = ARM === 'COMBO' ? `COMBO-${levers.join('+')}` : ARM;
  const file = path.join(OUT, 'arms', `${name}.jsonl`);
  const done = new Set(readJsonl(file).map((x) => x.page_id));
  const promptLevers = levers.filter((l) => l === 'C' || l === 'D');
  const think = levers.includes('X2') ? THINK_BUDGET : undefined;
  const fix = levers.includes('E');
  let targets = pageIds.filter((id) => !done.has(id));
  if (levers.includes('C') && ARM === 'C') targets = targets.filter((id) => skt.has(id));
  console.log(`${name}: ${targets.length} pages to do (${done.size} done); spent so far $${spent.toFixed(3)} of $${CAP}`);
  const errs = await pool(targets, async (pid) => {
    const r = ref.get(pid);
    let draft, gen = null;
    if (ARM === 'E') {
      draft = state.b[pid].text; // E is B plus the second pass: the first pass is B's own English
    } else {
      const prompt = leverPrompt(r, promptLevers);
      const maxOutputTokens = maxOutputTokensFor([{ ocr: { data: r.src } }]) + (think || 0);
      const res = await call({ model: MODEL, prompt, thinkingBudget: think ?? 0, maxOutputTokens, r, arm: name });
      if (!res.text) throw new Error(`empty ${pid}`);
      draft = sanitizeTranslationTags(res.text.trim());
      gen = { in: res.inputTokens, out: res.outputTokens, thinking: res.thinkingTokens, usd: res.usd, batch_usd: res.batch_usd, finish: res.finishReason, thinkingConfig: { thinkingBudget: think ?? 0 }, prompt_chars: prompt.length };
    }
    let fixInfo = null, text = draft;
    if (fix) {
      const f = flagsFor(pid, draft);
      fixInfo = { flag: f.flag, negation: f.negation, role: f.role, sentences: f.sentences };
      if (f.flag) {
        const res = await call({ model: FIX_MODEL, prompt: fixPrompt(r, draft, f.sentences), thinkingBudget: FIX_THINK, maxOutputTokens: 4096 + FIX_THINK, r, arm: name });
        let edits = [];
        try { edits = JSON.parse((res.text.match(/\{[\s\S]*\}/) || ['{}'])[0]).edits || []; } catch { fixInfo.parse_error = res.text.slice(0, 200); }
        const ap = applyEdits(draft, edits);
        text = ap.text;
        Object.assign(fixInfo, { edits, applied: ap.applied, rejected: ap.rejected, in: res.inputTokens, out: res.outputTokens, thinking: res.thinkingTokens, usd: res.usd, batch_usd: res.batch_usd, thinkingConfig: { thinkingBudget: FIX_THINK }, model: FIX_MODEL });
      }
    }
    fs.appendFileSync(file, JSON.stringify({ page_id: pid, arm: name, text, gen, fix: fixInfo, ...(fix ? { draft } : {}) }) + '\n');
  });
  const rows = readJsonl(file);
  console.log(`${name}: ${rows.length} pages; errors ${errs.length}${errs.length ? ` (${[...new Set(errs)].slice(0, 3).join(' | ')})` : ''}; spent total $${spent.toFixed(3)}`);
}
await main();
