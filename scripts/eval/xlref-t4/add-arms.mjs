#!/usr/bin/env node
// PRIOR ART: scripts/eval/translation-vs-reference/from-ab-sample.mjs converts a #5606 sample dir into records with arms; fetch-served.mjs adds only the served arm. This attaches arms.mjs output dirs (<arm>/<book>_<page>.json) and the Opus ceiling texts (<arm>/<id>.txt) to existing records as candidates.
/** Attach lever-arm outputs to translation-vs-reference records (#5695 T4). */
//   node scripts/eval/xlref-t4/add-arms.mjs --input records.jsonl --arms-dir <dir> --arms prod-A,prod-B,opus --out records-arms.jsonl [--only-ids a,b]
import fs from 'node:fs';
import path from 'node:path';
import { readJsonl, writeJsonl } from '../translation-vs-reference/common.mjs';
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const DIR = opt('arms-dir'); const ARMS = opt('arms').split(','); const ONLY = opt('only-ids') ? new Set(opt('only-ids').split(',')) : null;
const KEEP = opt('keep', 'served').split(','); // which existing candidates to keep
const counts = {};
const out = readJsonl(opt('input')).filter((r) => !ONLY || ONLY.has(`${r.book_id}_${r.page_number}`)).map((r) => {
  const id = `${r.book_id}_${r.page_number}`;
  const cands = r.candidates.filter((c) => KEEP.includes(c.arm));
  for (const arm of ARMS) {
    const j = path.join(DIR, arm, `${id}.json`), t = path.join(DIR, arm, `${id}.txt`);
    if (fs.existsSync(j)) { const o = JSON.parse(fs.readFileSync(j, 'utf8')); cands.push({ arm, text: o.text, model: o.model, generationConfig: o.generationConfig, inputTokens: o.inputTokens, outputTokens: o.outputTokens, thinkingTokens: o.thinkingTokens, cost_usd: o.cost_usd, prompt_ref: o.prompt_ref, context: o.context }); }
    else if (fs.existsSync(t)) cands.push({ arm, text: fs.readFileSync(t, 'utf8').trim(), model: 'claude-opus (subscription, claude -p)' });
    else continue;
    counts[arm] = (counts[arm] || 0) + 1;
  }
  return { ...r, candidates: cands };
});
writeJsonl(opt('out'), out);
console.log(`${out.length} records; arms attached ${JSON.stringify(counts)}`);
