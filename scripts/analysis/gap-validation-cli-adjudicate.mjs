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
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const EVAL = path.join(__dir, 'eval-data');
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const LIMIT = Number(arg('limit', 1e9));
const CONC = Number(arg('concurrency', 3));
const MODEL = arg('model', 'sonnet');
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
const works = JSON.parse(fs.readFileSync(path.join(EVAL, 'gap-validation-n250-blind.json'), 'utf8')).works
  .map((w) => ({ w, r: rnd() })).sort((a, b) => a.r - b.r).map(({ w }, i) => ({ ...w, okey: `O${String(i + 1).padStart(4, '0')}` }));

const done = new Set();
if (fs.existsSync(OUT)) for (const l of fs.readFileSync(OUT, 'utf8').split('\n')) if (l.trim()) { try { const r = JSON.parse(l); if (r.translation_verdict !== 'FAIL') done.add(r.key); } catch {} }
const todo = works.slice(0, LIMIT).filter((w) => !done.has(w.key));
console.log(`${works.length} works; ${done.size} done; ${todo.length} to run; model ${MODEL}; concurrency ${CONC}`);

const prompt = (w) => `You are a bibliographic adjudicator for a translation-history study. Investigate ONE early-modern Latin work using REAL web search (WebSearch / WebFetch). Search Google Books, archive.org, HathiTrust, WorldCat, scholarly bibliographies, and tradition-appropriate catalogues. Do NOT answer from memory alone — actually search.

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

function runOne(w) {
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
        const m = String(env.result || '').match(/\{[\s\S]*\}/);
        Object.assign(row, m ? JSON.parse(m[0]) : { translation_verdict: 'FAIL', fail: 'no JSON in reply' });
      } catch (e) {
        Object.assign(row, { translation_verdict: 'FAIL', fail: `exit ${code}: ${(err || out).slice(0, 300)}` });
      }
      fs.appendFileSync(OUT, JSON.stringify(row) + '\n');
      resolve(row);
    });
  });
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
