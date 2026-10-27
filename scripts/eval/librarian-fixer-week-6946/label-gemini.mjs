// PRIOR ART: scripts/lib/agy-cli.mjs gatedTextCall (the one gated `agy -p` text call, reused unchanged);
// scripts/eval/librarian-fixer-6946/label-packets.ts (Opus labels per link over a whole answer's page set, not one
// claim against one page, and through claude -p, not Gemini).
/**
 * Gemini cross-label for the one-week citation-fixer review (#6946). For each sampled link (build-sample.ts), Gemini
 * reads the claim in context and the WHOLE linked page (and, for a move, the whole target page) and labels each page
 * supported / partly / not. It is not told what the fixer decided.
 *
 * Subscription only: `agy -p` (gemini-4-argon-medium by default; agy has no model named "Pro", Argon is its top
 * Gemini tier). Never a Gemini API key, never Claude through agy (assertGeminiModel refuses it).
 *
 * Usage: node scripts/eval/librarian-fixer-week-6946/label-gemini.mjs --in=$JOB_SCRATCH/sample.jsonl \
 *          --out=$JOB_SCRATCH/gemini.jsonl [--model=gemini-4-argon-medium] [--conc=3]
 * Resumable: keys already in --out are skipped.
 */
import fs from 'node:fs';
import { gatedTextCall } from '../../lib/agy-cli.mjs';

const arg = (n, d) => process.argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const IN = arg('in'), OUT = arg('out');
const MODEL = arg('model', 'gemini-4-argon-medium');
const CONC = Number(arg('conc', '3'));
process.env.AGY_JOB ||= 'fixer-week-review-6946';

const pageBlock = (name, p) => !p ? `### Page ${name}\n\n(not available)` :
  `### Page ${name}: ${p.title}, p.${p.ref.slice(p.ref.lastIndexOf(':') + 1)}\n\n**English translation:**\n\n${p.parts?.[0] || '(none)'}${p.parts?.[1] ? `\n\n**Original transcription:**\n\n${p.parts[1]}` : ''}`;

export function prompt(item) {
  const two = item.stratum === 'move';
  return `You are checking one page link in an answer written by a research librarian for a digital library of historical
primary sources. Below is the passage of the answer that holds the link; the link is marked ⟦THIS LINK⟧. First decide
the CLAIM that link is cited for: the quotation, sentence or list item it is attached to (a link under a blockquote is
cited for the blockquote; when it carries several claims, take its main one).

Then read ${two ? 'each page below in full (Page A and Page B)' : 'the page below in full'} and say whether it states the claim:
- "supported": the page says what the claim says (a quotation is on the page; small translation drift is fine; a
  quotation that starts on this page and runs onto the next counts; a link pointing to a plate, title page or passage
  is supported when the page shows or contains it).
- "partly": the page states part of the claim, or only something close to it.
- "not": the page does not state it (being about the same topic is not enough).

Quote the single sentence of the page that decides it (verbatim, from the English translation or the original), or
"" when nothing on the page comes close.

Do not use any tools: everything is below. Write ONE JSON object on a single line between two marker lines, <<<BEGIN>>>
and <<<END>>>, and nothing outside the markers:
${two
    ? '{"claim":"<the claim in a few words>","A":"supported|partly|not","A_quote":"...","B":"supported|partly|not","B_quote":"..."}'
    : '{"claim":"<the claim in a few words>","A":"supported|partly|not","A_quote":"..."}'}

## Passage of the answer

${item.context}

## Pages

${pageBlock('A', item.linked)}${two ? `\n\n---\n\n${pageBlock('B', item.target)}` : ''}
`;
}

async function main() {
  // Without it agy-guard refuses with "quota reached", and agy-cli records that as a one-hour lock of the model for
  // every caller on the box (it did, on this review's first smoke call).
  if (/argon|-pro/i.test(MODEL) && !process.env.AGY_ALLOW_HEAVY) throw new Error(`${MODEL} is a heavy model: set AGY_ALLOW_HEAVY=<issue> (agy-guard)`);
  const items = fs.readFileSync(IN, 'utf8').trim().split('\n').map(l => JSON.parse(l));
  const done = new Set(fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l).key) : []);
  const todo = items.filter(i => !done.has(i.key) && i.linked);
  let stop = false, n = 0;
  async function worker() {
    while (todo.length && !stop) {
      const item = todo.shift();
      const r = await gatedTextCall(prompt(item), { model: MODEL, task: 'translate', attempts: 2 });
      if (r.cls === 'quota') { stop = true; console.error('quota:', r.err); return; }
      let label = null;
      try { label = JSON.parse(r.answer.trim().replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch { /* recorded unparsed */ }
      fs.appendFileSync(OUT, `${JSON.stringify({ key: item.key, stratum: item.stratum, model: MODEL, label, raw: label ? undefined : r.text.slice(0, 2000), problem: r.problem, cls: r.cls, calls: r.calls, secs: r.secs, usage: r.usage })}\n`);
      console.log(`${++n} ${item.key} ${item.stratum} ${label ? `A=${label.A}${label.B ? ` B=${label.B}` : ''}` : `unparsed ${r.cls ?? ''} ${r.problem ?? ''}`} ${r.secs.toFixed(0)}s`);
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker));
}

main().catch(e => { console.error(e); process.exit(1); });
