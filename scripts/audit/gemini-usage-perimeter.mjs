#!/usr/bin/env node
/**
 * PRIOR ART: scripts/audit/spend-perimeter.mjs — asks whether every unattended spender
 * consults the DIAL. A path can ask the dial and still write no usage row, and a path
 * can log perfectly and never be gated: different property, different failure. Also
 * checked: scripts/audit/gemini-thinking-and-meter.mjs (does a call site set a thinking
 * budget, and does it add thoughtsTokenCount WHEN it meters — it never asks whether the
 * site meters at all, and scans four directories); scripts/audit/spend-reconcile.mjs
 * (needs a bill and a Google token, reports the gap as one number, cannot name the
 * file); scripts/audit/gemini-key-attribution.mjs (attributes to a KEY, not a call
 * site). Nothing existing answers "which file spends without recording it".
 *
 * gemini-usage-perimeter — every Gemini call site either records what it spent,
 * or says why it doesn't.
 *
 * THE MEASUREMENT BEHIND IT (August 2026, both usage stores + Cloud Monitoring):
 *
 *   successful GenerateContent calls at Google ....... 417,936
 *   calls that wrote a gemini_usage row .............. 300,846
 *   calls that wrote nothing ......................... 117,090   (28%)
 *
 * An unlogged call is not a small problem: it is spend that cannot be attributed to
 * any workstream, cannot be seen by the daily dial, and — the reason #4581 cost real
 * money for months — cannot be checked for a runaway thinking budget, because there
 * is no row to check.
 *
 * WHAT IT CHECKS
 *   A. src/ has ONE way to construct a Gemini client: `getGeminiClient()` in
 *      `src/lib/gemini-client.ts`, which meters every generateContent call it hands
 *      out. A direct `new GoogleGenerativeAI(...)` anywhere else is a call site that
 *      spends silently, and is a hard failure.
 *   B. Every file that calls Gemini reaches a usage logger, OR declares itself:
 *        // usage-ok: <reason>            deliberate exemption, at the call site
 *        { selfMetered: true, reason }    the same thing in the client's own type
 *      A file that does neither is a finding.
 *   C. Findings already known are carried in a BASELINE file, so this guard goes
 *      green today and fails on NEW drift. Removing a line as you fix it is the
 *      intended workflow; adding one is not (declare an exemption instead).
 *
 * WHAT IT DOES NOT CHECK. Whether the row is CORRECT — right token count, right
 * price, right endpoint label. `spend-reconcile.mjs` answers that against the vendor,
 * and `gemini-thinking-and-meter.mjs` guards the token definition. A perimeter check
 * can only tell you a row was written.
 *
 * Usage:
 *   node scripts/audit/gemini-usage-perimeter.mjs            # human report
 *   node scripts/audit/gemini-usage-perimeter.mjs --ci       # exit 1 on new findings
 *   node scripts/audit/gemini-usage-perimeter.mjs --update-baseline
 */

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, relative } from 'path';

const ROOT = process.cwd();
const CI = process.argv.includes('--ci');
const UPDATE = process.argv.includes('--update-baseline');
const SCAN_DIRS = ['src', 'scripts'];
const EXTS = ['.ts', '.tsx', '.mjs', '.js'];
const BASELINE_PATH = join(ROOT, 'scripts/audit/gemini-usage-perimeter.baseline.txt');

/** A file that calls Gemini's generation API. */
const CALLS_GEMINI = /generateContent|generateContentStream|embedContent|generativelanguage\.googleapis\.com/;
/**
 * A file that writes a usage row, in any spelling across the three stores.
 *
 * There are THREE, and knowing that is half the problem this audit exists for:
 *   - Supabase `gemini_usage`  — primary, everything unattended
 *   - Mongo `gemini_usage`     — fallback when the Supabase key is missing/errors
 *   - Mongo `ai_usage`         — request-path features via `logAiUsage()`
 *     (librarian, explain, ai_search_expand, voice). Per TURN, not per call:
 *     the librarian is agentic and makes several Gemini calls per row. August
 *     2026: 8,784 rows, $77.00. `spend-reconcile.mjs` reports it separately for
 *     exactly that reason — a turn count cannot be added to a call count.
 */
const LOGS_USAGE = /logGeminiCall|logUsageAsync|logUsage\(|logAiUsage|completeBatchUsage|logEmbeddingUsage|collection\(['"]gemini_usage['"]\)\s*\.\s*insert|rest\/v1\/gemini_usage/;
/** The metered chokepoint in src/ — a client from here logs on the caller's behalf. */
const USES_METERED_CLIENT = /getGeminiClient\s*\(/;
/** Declared exemptions. Both spellings carry a reason; the declaration is the artifact. */
const WAIVER = /\/\/\s*usage-ok:|selfMetered:\s*true/;
/** Direct SDK construction — allowed only inside the chokepoint itself. */
const DIRECT_CONSTRUCTION = /new\s+GoogleGenerativeAI\s*\(/;
const CHOKEPOINT = 'src/lib/gemini-client.ts';

function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) {
      // `_archived` is dead code by convention and `node_modules` is not ours.
      if (e === 'node_modules' || e === '_archived' || e.startsWith('.')) continue;
      walk(p, out);
    } else if (EXTS.some((x) => e.endsWith(x))) {
      out.push(p);
    }
  }
  return out;
}

const files = SCAN_DIRS.flatMap((d) => walk(join(ROOT, d)));

const baseline = new Set(
  existsSync(BASELINE_PATH)
    ? readFileSync(BASELINE_PATH, 'utf8').split('\n').map((l) => l.replace(/#.*$/, '').trim()).filter(Boolean)
    : [],
);

const hard = [];      // check A — never baselined
const unlogged = [];  // check B
const exempt = [];
const logged = [];

for (const f of files) {
  const rel = relative(ROOT, f);
  const src = readFileSync(f, 'utf8');
  const constructsDirectly = rel !== CHOKEPOINT && rel.startsWith('src/') && DIRECT_CONSTRUCTION.test(src);
  if (constructsDirectly) { hard.push(rel); continue; }
  if (!CALLS_GEMINI.test(src)) continue;

  const inSrc = rel.startsWith('src/');
  if (LOGS_USAGE.test(src) || (inSrc && USES_METERED_CLIENT.test(src))) { logged.push(rel); continue; }
  if (WAIVER.test(src)) { exempt.push(rel); continue; }
  unlogged.push(rel);
}

if (UPDATE) {
  const header = [
    '# gemini-usage-perimeter baseline — Gemini call sites that write no usage row.',
    '#',
    '# These are the residual of #4599: one-shot maintenance, enrichment, eval and',
    '# analysis scripts, each run by hand. Their spend is real and lands on the bill',
    '# unattributed; it is recorded here rather than waved through, so the guard can',
    '# go green today and fail on anything NEW. A guard that has always been red',
    '# teaches nothing.',
    '#',
    '# Remove a line as you fix it. Do NOT add one: declare the exemption at the call',
    '# site with `// usage-ok: <reason>`, which says WHY where the next reader looks.',
    '',
  ].join('\n');
  writeFileSync(BASELINE_PATH, `${header}${unlogged.sort().join('\n')}\n`);
  console.log(`Baseline rewritten: ${unlogged.length} entries.`);
  process.exit(0);
}

const fresh = unlogged.filter((f) => !baseline.has(f));
const fixed = [...baseline].filter((f) => !unlogged.includes(f));

console.log('GEMINI USAGE PERIMETER\n');
console.log(`  Gemini call sites scanned .......... ${logged.length + exempt.length + unlogged.length + hard.length}`);
console.log(`  write a usage row .................. ${logged.length}`);
console.log(`  declared exempt (usage-ok/self) .... ${exempt.length}`);
console.log(`  write nothing ...................... ${unlogged.length}  (${baseline.size} baselined)`);

if (hard.length) {
  console.log('\n  FAIL — src/ constructs the Gemini SDK outside the metered chokepoint:');
  for (const f of hard) console.log(`    ${f}`);
  console.log(`  Use getGeminiClient({ endpoint }) from ${CHOKEPOINT}, or`);
  console.log('  getUnmeteredGeminiClient(key) when the key is not ours.');
}

if (fresh.length) {
  console.log('\n  NEW unlogged Gemini call sites:');
  for (const f of fresh) console.log(`    ${f}`);
  console.log('\n  Either log the call, or declare it: // usage-ok: <reason>');
}

if (fixed.length) {
  console.log(`\n  ${fixed.length} baselined site(s) now log — drop them from the baseline:`);
  for (const f of fixed.slice(0, 20)) console.log(`    ${f}`);
}

const failing = hard.length + fresh.length;
if (!failing) console.log('\n✔ No new findings.');
process.exit(CI && failing ? 1 : 0);
