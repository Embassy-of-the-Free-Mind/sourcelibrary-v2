#!/usr/bin/env node
// PRIOR ART: scripts/eval/results/seam-ab-5678/JUDGE-PROMPT.md (the source-grounded page-turn judge: its
// definitions of duplication, forced closure, edge omission and words moved are reused here, in the taxonomy's
// T-codes) and scripts/eval/seam-ab-5678.mjs (junction draw for an A/B of ARMS, several versions per break). This
// labels ONE stored join per call, adds a minimal repair, and plants controls; no prior script does either.
/**
 * opus-reference — Opus (Claude CLI, subscription) labels ~300 stored page joins from the census draw and writes a
 * minimal corrected English for the two sides of each broken one (#6742).
 *
 *   node scripts/eval/seams-6742/opus-reference.mjs build --census=DIR/census.jsonl --out=DIR [--seed=6742]
 *   node scripts/eval/seams-6742/opus-reference.mjs run   --out=DIR [--conc=6]
 *
 * build writes items.jsonl (what Opus sees: four edge texts, nothing else) and key.jsonl (stratum, plant, census
 * signals). Strata: random (120, uniform over the census's prose breaks), flagged (120, census `strong`, not in
 * random), good (30 presumed-good joins: cased source closes at the break, English closes and reopens, no signal),
 * plant (30 more presumed-good joins, broken on purpose: 15 drop the last English sentence of page N, 15 copy it to
 * the head of page N+1). run is resumable: an item with a parsed label in labels.jsonl is not called again.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { claudeCall, extractJson, pool, shuffle, sentences } from './lib.mjs';
import { makeRng } from '../lib/paired-stats.mjs';

const arg = (k, d) => process.argv.find(a => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=') ?? d;
const readJsonl = (f) => fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
export const LABELS = ['ok', 'omission', 'duplication', 'drift', 'broken_syntax', 'catchword', 'other'];

export const PROMPT = `You are checking ONE page turn in an AI English translation of a historical book. A reader pages from
page N to page N+1 and reads the English straight across. Your job: does the English at the turn faithfully and
readably continue what the SOURCE continues?

You get four excerpts (each may be cut at "…" on its far side — judge only the turn, not the cut ends):
- SOURCE N (end of page N, OCR text) and SOURCE N+1 (start of page N+1);
- ENGLISH N (end of page N's translation) and ENGLISH N+1 (start of page N+1's translation).

Allowed, NOT defects: page N's English ending mid-sentence where the source does; a word split by a hyphen at the
turn translated whole on page N; a catchword (next page's first word printed at the foot of page N) left
untranslated or rendered once; a full stop added at the turn when the meaning is intact; running heads, page
numbers, signatures; translation-style choices away from the turn.

Labels (taxonomy codes from page-error-taxonomy.md):
- "ok": every source word near the turn is rendered once, on its own page, and the English reads across correctly.
- "omission" (T9/T1): 2+ source words in the last ~3 lines of N or first ~3 lines of N+1 are rendered on NEITHER side.
- "duplication" (T5): source words near the turn are rendered on BOTH sides (2+ words).
- "drift" (T4): ~6+ source words are rendered on the WRONG side of the turn (N+1's words in N's English or the
  reverse), not counting a split word or catchword, with nothing lost.
- "broken_syntax" (T6 forced closure / fabricated bridge): read across, the sentence does not parse or changes
  meaning — the translator closed a sentence the source leaves open by supplying words not on page N, inserted a
  bracketed or invented bridge, or restarted N+1 so the carried clause is mistranslated.
- "catchword" (T6): a catchword or split word mishandled — rendered twice, or the word half mistranslated as its own word.
- "other": a different defect AT the turn (e.g. one side's English is not a translation of its source, left untranslated).

If more than one applies, give the main one as "label" and all in "labels".

Then, ONLY if the label is not "ok", write a MINIMAL repair: replace the last sentence(s) of ENGLISH N and/or the
first sentence(s) of ENGLISH N+1 so that each page renders exactly its own source words and the two read across as
one correct sentence. Copy the text you replace VERBATIM from the excerpt (exact substring, including punctuation)
as tail_old (must be the END of ENGLISH N) and head_old (must be the START of ENGLISH N+1); use "" for a side you do
not change. Change as few words as possible; keep the translator's style and terms. Page N may end mid-sentence
(no full stop) when the source does, and N+1 then continues in lowercase.

Reply with ONE JSON object and nothing else:
{"label":"ok|omission|duplication|drift|broken_syntax|catchword|other","labels":["..."],"severity":"none|minor|major",
 "confidence":0.0-1.0,"evidence":"<= 40 words, quoting the words concerned",
 "repair":null | {"tail_old":"...","tail_new":"...","head_old":"...","head_new":"..."}}
severity: "major" if a reader loses or is misled about content, "minor" if it reads awkwardly but the content is all there.`;

export function itemPrompt(it) {
  return `${PROMPT}

=== SOURCE N (end) ===
${it.srcTailA}

=== SOURCE N+1 (start) ===
${it.srcHeadB}

=== ENGLISH N (end) ===
${it.enTailA}

=== ENGLISH N+1 (start) ===
${it.enHeadB}
`;
}

const presumedGood = (r) => !r.skipped && !r.nonProse && !r.any && r.srcEndOpen === false && !r.srcNextCont && !r.enEndOpen && !r.enNextCont
  && ['latin', 'greek', 'cyrillic'].includes(r.script);

function build(censusFile, out, seed) {
  const rows = readJsonl(censusFile).filter(r => !r.skipped);
  const rand = makeRng(seed);
  const prose = rows.filter(r => !r.nonProse);
  const random = shuffle(prose, rand).slice(0, 120);
  const used = new Set(random.map(r => r.book));
  const flagged = shuffle(prose.filter(r => r.strong && !used.has(r.book)), rand).slice(0, 120);
  flagged.forEach(r => used.add(r.book));
  const goods = shuffle(prose.filter(r => presumedGood(r) && !used.has(r.book)), rand);
  const good = goods.slice(0, 30);
  const plantPool = goods.slice(30).filter(r => { const ss = sentences(r.enTailA.replace(/^…/, '')); return ss.length >= 3 && ss[ss.length - 1].split(/\s+/).length >= 6; });
  const plants = plantPool.slice(0, 30).map((r, k) => {
    const ss = sentences(r.enTailA);
    const last = ss[ss.length - 1];
    const kind = k % 2 === 0 ? 'drop' : 'dup';
    const enTailA = kind === 'drop' ? r.enTailA.slice(0, r.enTailA.lastIndexOf(last)).trimEnd() : r.enTailA;
    const enHeadB = kind === 'dup' ? `${last} ${r.enHeadB}` : r.enHeadB;
    return { ...r, enTailA, enHeadB, plant: kind, plantedSentence: last };
  });
  const all = [
    ...random.map(r => ({ r, stratum: 'random' })), ...flagged.map(r => ({ r, stratum: 'flagged' })),
    ...good.map(r => ({ r, stratum: 'good' })), ...plants.map(r => ({ r, stratum: 'plant' })),
  ];
  const items = [], key = [];
  for (const { r, stratum } of shuffle(all, rand)) {
    const id = crypto.createHash('sha1').update(`${seed}:${r.book}:${r.p}:${stratum}:${r.plant || ''}`).digest('hex').slice(0, 12);
    items.push({ id, srcTailA: r.srcTailA, srcHeadB: r.srcHeadB, enTailA: r.enTailA, enHeadB: r.enHeadB });
    const { srcTailA, srcHeadB, enTailA, enHeadB, ...sig } = r;
    key.push({ id, stratum, plant: r.plant || null, plantedSentence: r.plantedSentence || null, ...sig });
  }
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'items.jsonl'), items.map(x => JSON.stringify(x)).join('\n') + '\n');
  fs.writeFileSync(path.join(out, 'key.jsonl'), key.map(x => JSON.stringify(x)).join('\n') + '\n');
  fs.writeFileSync(path.join(out, 'PROMPT.md'), '# Opus reference prompt (#6742)\n\n```\n' + PROMPT + '\n```\n');
  console.log(JSON.stringify({ random: random.length, flagged: flagged.length, good: good.length, plant: plants.length, presumedGoodPool: goods.length }));
}

export function validRepair(it, rep) {
  if (!rep) return null;
  const tOld = rep.tail_old || '', hOld = rep.head_old || '';
  const tailOk = !tOld || it.enTailA.trimEnd().endsWith(tOld.trimEnd());
  const headOk = !hOld || it.enHeadB.trimStart().startsWith(hOld.trimStart());
  return { tailOk, headOk, ok: tailOk && headOk };
}

async function run(out, conc) {
  const items = readJsonl(path.join(out, 'items.jsonl'));
  const file = path.join(out, 'labels.jsonl');
  const done = new Set(readJsonl(file).filter(x => x.parsed).map(x => x.id));
  const todo = items.filter(x => !done.has(x.id));
  console.log(`${items.length} items, ${todo.length} to label`);
  const res = await pool(todo, conc, async (it) => {
    const r = await claudeCall(itemPrompt(it), 'opus');
    if (r.cls === 'usage_limit') return { cls: r.cls };
    const j = r.cls ? null : extractJson(r.text);
    const parsed = j && LABELS.includes(j.label) ? j : null;
    fs.appendFileSync(file, JSON.stringify({ id: it.id, parsed: !!parsed, ...(parsed || {}), repairCheck: parsed ? validRepair(it, parsed.repair) : null,
      model: r.model, cls: r.cls, secs: Math.round(r.secs), usage: r.usage, raw: parsed ? undefined : r.text.slice(0, 2000), err: r.err || undefined }) + '\n');
    return { ok: !!parsed, cls: r.cls };
  });
  console.log(JSON.stringify(res));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cmd = process.argv[2], out = arg('out');
  if (cmd === 'build') build(arg('census'), out, Number(arg('seed', 6742)));
  else if (cmd === 'run') run(out, Number(arg('conc', 6))).catch(e => { console.error(e); process.exit(1); });
  else console.error('usage: build --census=F --out=DIR | run --out=DIR');
}
