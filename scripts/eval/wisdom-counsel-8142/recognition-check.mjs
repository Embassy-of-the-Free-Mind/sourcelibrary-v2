#!/usr/bin/env node
// Ask Flash to identify each disguised known-outcome case; a case it recognises is replaced (preregistration, "Dilemmas").
// PRIOR ART: none for this check — no other eval disguises a case. The call is lib.mjs agyCall.
// Replies land in $JOB_SCRATCH/out/recognition.jsonl, resumable; recognition is then read by eye, in known-selected.json.
import path from 'node:path';
import { agyCall, readJson, here, OUT, appendJsonl, readJsonl, WRITER_MODEL, WRITER_HOMES, parseJsonReply, LimitHit } from './lib.mjs';

const file = path.join(OUT, 'recognition.jsonl');
const done = new Set(readJsonl(file).map((r) => r.id));
for (const c of readJson(here('known-candidates.json')).candidates) {
  if (done.has(c.id)) continue;
  const prompt = `The following request for advice is a disguised account of a real, recorded historical decision: names, dates and places have been removed. Identify the historical decision if you can. Give your three best guesses, most likely first, and your confidence in the first from 0 to 1. If you truly cannot place it, still give your three best guesses.\n\nRequest:\n"""${c.text}"""\n\nReply with JSON only: {"guesses": ["...", "...", "..."], "confidence": 0.0}`;
  try {
    const r = await agyCall(prompt, { model: WRITER_MODEL, agyHome: WRITER_HOMES[0], timeoutS: 200 });
    let parsed = null; try { parsed = parseJsonReply(r.text); } catch { /* the raw reply is kept */ }
    appendJsonl(file, { id: c.id, case: c.case, guesses: parsed?.guesses ?? null, confidence: parsed?.confidence ?? null, raw: r.text });
    console.log(c.id, c.case, '→', JSON.stringify(parsed?.guesses), parsed?.confidence);
  } catch (e) {
    if (e instanceof LimitHit) { console.error(e.message); process.exit(3); }
    console.error(c.id, e.message);
  }
}
