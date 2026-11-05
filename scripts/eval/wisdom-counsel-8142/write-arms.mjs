#!/usr/bin/env node
// The writer: gemini-3.8-flash-low through agy, one call at a time, for each arm (#8142).
// PRIOR ART: the agy call is lib.mjs agyCall (scripts/lib/agy-cli.mjs). Each reply is kept whole; the 250-word cut is applied on read.
//   node write-arms.mjs --set pilots|test --arms A,A2[,B,C,D,M]
import fs from 'node:fs';
import path from 'node:path';
import { agyCall, readJson, here, OUT, appendJsonl, readJsonl, capWords, wc, WRITER_MODEL, WRITER_HOMES, LimitHit } from './lib.mjs';

const TASK = 'A person has written asking for advice. Advise this person in at most 250 words, recommending a course of action. Do not quote or name any source, book or author. Write only the advice, addressed to them.';
const INSTRUCTION = "Before you answer, consider other people's perspectives, how things may change, and what is unknown.";

export function promptFor(arm, dilemma, passages) {
  let p = TASK;
  if (arm === 'M') p += `\n\n${INSTRUCTION}`;
  if (['B', 'C', 'D'].includes(arm)) {
    p += '\n\nBelow are five passages from old books in a library. You may draw on them or ignore them, as you see fit.\n\n';
    p += passages.map((x, i) => `Passage ${i + 1}:\n${x.text}`).join('\n\n');
  }
  return `${p}\n\nThe person writes:\n"""${dilemma.text}"""`;
}

const argOf = (k) => process.argv[process.argv.indexOf(k) + 1];
if (import.meta.url === `file://${process.argv[1]}`) {
  const set = argOf('--set'), arms = argOf('--arms').split(',');
  const d = readJson(here('dilemmas.json'));
  const dilemmas = set === 'pilots' ? d.pilots : [...d.dilemmas, ...readJson(here('known-selected.json')).selected];
  const passages = readJsonl(path.join(OUT, `passages-${set}.jsonl`));
  const file = path.join(OUT, `answers-${set}.jsonl`);
  const done = new Set(readJsonl(file).map((r) => `${r.dilemma}:${r.arm}`));
  let call = 0;
  for (const arm of arms) for (const dil of dilemmas) {
    if (done.has(`${dil.id}:${arm}`)) continue;
    const ps = passages.filter((p) => p.dilemma === dil.id && p.arm === arm);
    if (['B', 'C', 'D'].includes(arm) && ps.length !== 5) { console.error(`${dil.id}:${arm} has ${ps.length} passages; refusing`); process.exit(2); }
    const prompt = promptFor(arm, dil, ps);
    let r = null;
    for (let attempt = 0; attempt < 3 && !r; attempt++) {
      try {
        r = await agyCall(prompt, { model: WRITER_MODEL, agyHome: WRITER_HOMES[call % WRITER_HOMES.length], timeoutS: 240 });
      } catch (e) {
        if (e instanceof LimitHit) { console.error(e.message); process.exit(3); }
        console.error(dil.id, arm, 'attempt', attempt, e.message.slice(0, 200));
      }
    }
    call++;
    if (!r) { console.error(`${dil.id}:${arm} failed; re-run to resume`); continue; }
    appendJsonl(file, { dilemma: dil.id, arm, raw: r.text, text: capWords(r.text), words_raw: wc(r.text), usage: r.usage, model: r.model });
    console.log(dil.id, arm, wc(r.text));
  }
}
