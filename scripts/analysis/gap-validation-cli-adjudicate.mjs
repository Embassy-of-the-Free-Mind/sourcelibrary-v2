#!/usr/bin/env node
/**
 * PRIOR ART: scripts/analysis/gap-validation-claude-workflow.mjs — the same adjudication as a
 * Workflow-DSL script (Sonnet-era general-purpose agents, Workflow tool only). This is the plain
 * `claude -p` version so it runs on a job box under the subscription, resumable, with Opus as the
 * instrument. The prompt text and verdict schema are kept identical so the verdicts compare.
 *
 * Replicates the #2684 translation-gap validation with a lean Sonnet call per work, the instrument of the first-translation search (#7598, #7691).
 * Input: scripts/analysis/eval-data/gap-validation-n250-blind.json (1000 works, seed 2684).
 * The frame's keys start with T/G and so name the stratum; each work is re-keyed with a seeded
 * random id (O0001…) and the prompt never sees either key. The map back is in the output rows.
 *
 * Output: scripts/analysis/eval-data/gap-validation-opus-verdicts.jsonl — one row per work, kept
 * as each call returns (resumable: keys already present are skipped). Each row carries the
 * verdict, queries, sources, the model's own reply, wall time and token usage.
 *
 * Usage:
 *   node scripts/analysis/gap-validation-cli-adjudicate.mjs --limit 30 --concurrency 3
 *   node scripts/analysis/gap-validation-cli-adjudicate.mjs --model sonnet  # all 1000
 * Flags: --limit N (first N in the shuffled order) · --concurrency N (default 3) ·
 *        --model opus|sonnet · --out FILE · --account EMAIL --week-cap PCT (stop at that weekly %)
 *
 * Per-language runs (#7751) — any blind file from scripts/analysis/translation-share-sample.mjs:
 *   --in FILE --lang german   the frame and the language named in the prompt; three rules are added (a substantial
 *                             translation counts; a summary or encyclopaedia entry does not; Source Library's own
 *                             translations never count) and the reply carries translator/publisher/year/quoted line.
 *                             Without --lang the prompt is the June one, byte for byte.
 *   --engine agy              Gemini 3.8 Flash (low) through `agy -p` with grounded search (search_web only; tool gate
 *                             task 'search'), on the account in AGY_HOME. Default engine: claude.
 *   --subset N                a seeded random N of the input (seed 7751), e.g. the Sonnet second opinion.
 *   --tiebreak A.jsonl,B.jsonl  third read of the works where A and B disagree: told both verdicts and evidence,
 *                             it must open the URLs (claude only).
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, execSync } from 'node:child_process';
import { agyCall, installToolGate, gateCalls, CLI_SAFE_ARGS } from '../lib/agy-cli.mjs';
import { fileURLToPath } from 'node:url';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const EVAL = path.join(__dir, 'eval-data');
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const LIMIT = Number(arg('limit', 1e9));
const CONC = Number(arg('concurrency', 3));
const MODEL = arg('model', 'sonnet');
const IN = arg('in', path.join(EVAL, 'gap-validation-n250-blind.json'));
const LANG = arg('lang', '');
const ENGINE = arg('engine', 'claude');
const AGY_MODEL = arg('agy-model', 'gemini-3.8-flash-low');
const SUBSET = Number(arg('subset', 0));
const TIEBREAK = arg('tiebreak', '');
const OUT = arg('out', path.join(EVAL, `gap-validation-${MODEL}-verdicts.jsonl`));
// Quota guard, as scripts/ft-search/meter-guard.sh: stop when the account's weekly meter passes
// --week-cap, or when it cannot be read three checks running (a blank reading must not mean "fine").
const ACCOUNT = arg('account', '');
const WEEK_CAP = Number(arg('week-cap', 0));
let blind = 0;
function weekly() {
  try {
    const d = JSON.parse(execSync('climits json', { encoding: 'utf8', timeout: 60000 })).find((a) => a.email === ACCOUNT && a.ok);
    return d.limits.find((x) => x.key === 'weekly_all:all').percent;
  } catch { return null; }
}

function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rnd = mulberry32(7691);
let works = JSON.parse(fs.readFileSync(IN, 'utf8')).works
  .map((w) => ({ w, r: rnd() })).sort((a, b) => a.r - b.r).map(({ w }, i) => ({ ...w, okey: `O${String(i + 1).padStart(4, '0')}` }));
if (SUBSET) { const r2 = mulberry32(7751); works = works.map((w) => ({ w, r: r2() })).sort((a, b) => a.r - b.r).slice(0, SUBSET).map(({ w }) => w); }
const readVerdicts = (f) => new Map(fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.translation_verdict !== 'FAIL').map((r) => [r.key, r]));
const binary = (v) => v.translation_verdict === 'translated' ? 'translated' : v.translation_verdict === 'untranslated' ? 'not_found' : 'unsure';
let disputes = null;
if (TIEBREAK) {
  const [A, B] = TIEBREAK.split(',').map(readVerdicts);
  disputes = new Map([...A].filter(([k, a]) => B.has(k) && binary(a) !== binary(B.get(k))).map(([k, a]) => [k, [a, B.get(k)]]));
  works = works.filter((w) => disputes.has(w.key));
}

const done = new Set();
if (fs.existsSync(OUT)) for (const l of fs.readFileSync(OUT, 'utf8').split('\n')) if (l.trim()) { try { const r = JSON.parse(l); if (r.translation_verdict !== 'FAIL') done.add(r.key); } catch {} }
const todo = works.slice(0, LIMIT).filter((w) => !done.has(w.key));
console.log(`${works.length} works; ${done.size} done; ${todo.length} to run; model ${MODEL}; concurrency ${CONC}`);

// Per-language prompt (#7751): the June text with the language and the edition titles swapped in, and three rules added.
const LANG_WORD = LANG ? LANG[0].toUpperCase() + LANG.slice(1) : 'Latin';
const workLines = (w) => `WORK: "${(w.titles && w.titles[0]) || w.title}"${w.titles && w.titles.length > 1 ? `\nOTHER EDITION TITLES OF THE SAME WORK: ${w.titles.slice(1).map((t) => `"${t}"`).join('; ')}` : ''}
AUTHOR: ${w.author || 'unknown (anonymous in the catalogue)'}
FIRST PRINTED: ${w.print_year}${w.n_editions > 1 ? ` (${w.n_editions} editions known)` : ' (one edition known)'}`;
const LANG_RULES = `
 - A SUBSTANTIAL English translation (most of the work, e.g. a continuous abridged version) counts as "translated" with relationship "same_work"; excerpts or an anthology selection are "partial".
 - An English summary, a description, a catalogue or encyclopaedia entry, or a study that only paraphrases does NOT count.
 - An English translation published by Source Library (sourcelibrary.org) NEVER counts: ignore it.
 - Many of these works are short pamphlets, ordinances, occasional verse or news sheets; if nothing turns up after a real search, the answer is "untranslated", not "uncertain". Use "uncertain" only when a search result suggests a translation you could not confirm.`;
const LANG_FIELDS = `, "translator": "<string>", "publisher": "<string>", "translation_year": "<string>", "quote": "<the line from the source that shows the English translation, verbatim>"`;
const langPrompt = (w) => `You are a bibliographic adjudicator for a translation-history study. Investigate ONE early-modern ${LANG_WORD}-language work using REAL web search. Search Google Books, archive.org, HathiTrust, WorldCat, scholarly bibliographies, and tradition-appropriate catalogues. Do NOT answer from memory alone — actually search.

${workLines(w)}

Answer TWO questions.

(1) COMPOSITION ERA — when was the TEXT composed (not printed)? An early-modern PRINT of an ancient or medieval text is "antiquity" or "medieval"; a work written by a contemporary 15th–17th-century author is "renaissance_early_modern". Give your best composition-year estimate.

(2) PRIOR ENGLISH TRANSLATION — has THIS specific work EVER been published in an English translation, by anyone, at any date? STRICT RULES:
 - A ${LANG_WORD} reprint, a modern critical edition WITHOUT a translation, or a facsimile does NOT count.
 - A translation of a DIFFERENT work by the same author does NOT count (relationship "different_source_language" only if it is the same work via another source language).
 - A partial / excerpt-only English rendering → relationship "partial" (still report it; verdict stays "untranslated" unless a complete or substantial one exists).
 - If this is a multi-work container / Opera / anthology where "a translation" is ill-defined → relationship "container".${LANG_RULES}
 - Be skeptical of your own knowledge: only assert a translation exists if a search result actually shows it. Never invent translators/years.

Keep reasoning to <=2 sentences, prior to <=1 sentence. Cap queries and sources to the 5 most informative each (full URLs for sources).

Reply with ONE JSON object and nothing else, with these fields:
{"composition_era": "antiquity|medieval|renaissance_early_modern|unknown", "composition_year_est": <integer>, "translation_verdict": "translated|untranslated|uncertain", "relationship": "same_work|different_source_language|partial|container|none", "prior": "<string>"${LANG_FIELDS}, "evidence_url": "<string>", "evidence_strength": "strong|moderate|weak", "queries": ["..."], "sources": ["..."], "reasoning": "<string>"}`;

// Third read (#7751, after gap-validation-tiebreak-workflow.mjs): both verdicts and their evidence, URLs to be opened.
const show = (v) => JSON.stringify({ verdict: v.translation_verdict, relationship: v.relationship, prior: v.prior, translator: v.translator, publisher: v.publisher, translation_year: v.translation_year, quote: v.quote, evidence_url: v.evidence_url, sources: v.sources, reasoning: v.reasoning });
const tiebreakPrompt = (w) => { const [a, b] = disputes.get(w.key); return `You are the deciding third adjudicator for a translation-history study; two prior adjudicators DISAGREED on this work. Settle it with REAL web search and by OPENING the URLs they cite (WebFetch): a claim whose URL does not show an English translation of THIS work does not stand.

${workLines(w)}

ADJUDICATOR A: ${show(a)}
ADJUDICATOR B: ${show(b)}

QUESTION: Has THIS specific work ever been published in English translation (complete or substantial), by anyone, at any date? Rules: a ${LANG_WORD} reprint, a facsimile, an English summary or encyclopaedia entry, or a translation of a different work does NOT count; excerpts are "partial" (verdict "untranslated"); a translation published by Source Library never counts. Only assert a translation that a page you opened actually shows.

Reply with ONE JSON object and nothing else, with these fields:
{"composition_era": "antiquity|medieval|renaissance_early_modern|unknown", "composition_year_est": <integer>, "translation_verdict": "translated|untranslated|uncertain", "relationship": "same_work|different_source_language|partial|container|none", "prior": "<string>"${LANG_FIELDS}, "evidence_url": "<string>", "evidence_strength": "strong|moderate|weak", "urls_opened": [{"url": "...", "shows": "<one line: what the page actually shows>"}], "queries": ["..."], "sources": ["..."], "reasoning": "<string>"}`; };

const junePrompt = (w) => `You are a bibliographic adjudicator for a translation-history study. Investigate ONE early-modern Latin work using REAL web search (WebSearch / WebFetch). Search Google Books, archive.org, HathiTrust, WorldCat, scholarly bibliographies, and tradition-appropriate catalogues. Do NOT answer from memory alone — actually search.

WORK: "${w.title}"
AUTHOR: ${w.author || 'unknown'}
PRINTED: ${w.print_year}${w.n_editions > 1 ? ` (${w.n_editions} editions known)` : ''}

Answer TWO questions.

(1) COMPOSITION ERA — when was the TEXT composed (not printed)? An early-modern PRINT of an ancient or medieval author (a 1540 Cicero, a 1566 Aquinas, a 1549 Galen) is "antiquity" or "medieval"; a work written by a contemporary 15th–17th-century author is "renaissance_early_modern". Give your best composition-year estimate.

(2) PRIOR ENGLISH TRANSLATION — has THIS specific work EVER been published in an English translation, by anyone, at any date? STRICT RULES:
 - A Latin reprint, a modern critical edition WITHOUT a translation, or a facsimile does NOT count.
 - A translation of a DIFFERENT work by the same author does NOT count (relationship "different_source_language" only if it is the same work via another source language).
 - A partial / excerpt-only English rendering → relationship "partial" (still report it; verdict stays "untranslated" unless a complete one exists).
 - If this is a multi-work container / Opera / anthology where "a translation" is ill-defined → relationship "container".
 - Be skeptical of your own knowledge: only assert a translation exists if a search result actually shows it. Never invent translators/years.

Return the structured verdict. Keep reasoning to <=2 sentences, prior to <=1 sentence. Cap queries and sources to the 5 most informative each (full URLs for sources).

Reply with ONE JSON object and nothing else, with these fields:
{"composition_era": "antiquity|medieval|renaissance_early_modern|unknown", "composition_year_est": <integer>, "translation_verdict": "translated|untranslated|uncertain", "relationship": "same_work|different_source_language|partial|container|none", "prior": "<string>", "evidence_url": "<string>", "evidence_strength": "strong|moderate|weak", "queries": ["..."], "sources": ["..."], "reasoning": "<string>"}`;

const prompt = (w) => disputes ? tiebreakPrompt(w) : LANG ? langPrompt(w) : junePrompt(w);

// --engine agy: one grounded Gemini call in a fresh workspace whose gate allows web search only (#7751).
async function runAgy(w) {
  const t0 = Date.now();
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-search-'));
  const log = installToolGate(ws, { task: 'search' });
  const r = await agyCall(['-p', prompt(w), '--model', AGY_MODEL, ...CLI_SAFE_ARGS], ws);
  const tools = gateCalls(log);
  fs.rmSync(ws, { recursive: true, force: true });
  const row = { key: w.key, okey: w.okey, model: `agy-${AGY_MODEL}`, date: new Date().toISOString(), wall_s: Math.round((Date.now() - t0) / 1000),
    usage: r.usage, tool_calls: tools, raw: r.text };
  if (r.cls) Object.assign(row, { translation_verdict: 'FAIL', fail: `${r.cls}: ${(r.err || r.text || '').slice(0, 300)}` });
  else Object.assign(row, parseVerdict(r.text) ?? { translation_verdict: 'FAIL', fail: 'no JSON in reply' });
  if (!row.fail && !tools.some((t) => t === 'search_web')) row.no_search = true; // answered from memory: flagged, kept
  fs.appendFileSync(OUT, JSON.stringify(row) + '\n');
  return row;
}

function runOne(w) {
  if (ENGINE === 'agy') return runAgy(w);
  return new Promise((resolve) => {
    const t0 = Date.now();
    // Lean call, same flags as the first-translation search (scripts/ft-search/search-one.sh).
    const p = spawn('claude', ['-p', prompt(w), '--model', MODEL, '--strict-mcp-config', '--setting-sources', 'local',
      '--disable-slash-commands', '--no-session-persistence', '--tools', 'WebSearch', 'WebFetch', '--allowedTools', 'WebSearch', 'WebFetch',
      '--system-prompt', 'You are a careful bibliographic researcher. Use the tools to search and verify, then answer exactly in the requested JSON.',
      '--output-format', 'json'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    const kill = setTimeout(() => p.kill('SIGTERM'), 15 * 60 * 1000);
    p.on('close', (code) => {
      clearTimeout(kill);
      const row = { key: w.key, okey: w.okey, model: `claude-${MODEL}`, date: new Date().toISOString(), wall_s: Math.round((Date.now() - t0) / 1000) };
      try {
        const env = JSON.parse(out);
        row.usage = env.usage; row.num_turns = env.num_turns; row.raw = env.result;
        Object.assign(row, parseVerdict(String(env.result || '')) ?? { translation_verdict: 'FAIL', fail: 'no JSON in reply' });
      } catch (e) {
        Object.assign(row, { translation_verdict: 'FAIL', fail: `exit ${code}: ${(err || out).slice(0, 300)}` });
      }
      fs.appendFileSync(OUT, JSON.stringify(row) + '\n');
      resolve(row);
    });
  });
}

// Sonnet's reply is JSON, but it often drops the closing quote of the last string
// ("...is weak.}"): 106 of 1,000 replies on 2026-10-29. Parse strictly, then close it.
function parseVerdict(text) {
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a < 0 || b < a) return null;
  for (const t of [text.slice(a, b + 1), text.slice(a, b) + '"}', text.slice(a, b) + '"]}']) {
    try { const o = JSON.parse(t); if (o.translation_verdict) return o; } catch { /* next */ }
  }
  return null;
}

let i = 0, n = 0;
async function worker() {
  while (i < todo.length) {
    const w = todo[i++];
    const r = await runOne(w);
    n++;
    console.log(`${new Date().toISOString().slice(11, 19)} ${n}/${todo.length} ${r.okey} ${r.translation_verdict} ${r.composition_era ?? ''} ${r.wall_s}s${r.fail ? ' ' + r.fail.slice(0, 120) : ''}`);
    if (WEEK_CAP && n % 20 === 0) {
      const wk = weekly();
      if (wk == null) { // the meter 429s in bursts: wait it out, stop only after ~30 min unreadable
        if (++blind >= 10) { console.log('meter unreadable ten times running; stopping'); process.exit(4); }
        console.log(`meter unreadable (${blind}); waiting 3 min`); await new Promise(r => setTimeout(r, 180_000)); }
      else { blind = 0; console.log(`meter ${ACCOUNT} weekly ${wk}%`); if (wk >= WEEK_CAP) { console.log(`weekly ${wk}% >= cap ${WEEK_CAP}; stopping`); process.exit(3); } }
    }
    if (r.fail && /limit|quota|rate|hit your/i.test(r.fail)) { console.log('usage limit reached; stopping (resume later, done rows are kept)'); process.exit(3); }
  }
}
await Promise.all(Array.from({ length: CONC }, worker));
