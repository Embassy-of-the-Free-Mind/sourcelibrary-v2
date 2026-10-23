#!/usr/bin/env node
// PRIOR ART: scripts/eval/lib/edition-window.mjs `stripTags` (used unchanged). Prereg PREREGISTRATION-longs-prompt-5924.md,
// "Output prep": the live prompt answers in tagged Markdown; metadata blocks go with their content, other tags are
// unwrapped, before score.mjs (unchanged) reads the rows. L0 goes into score.mjs's baseline slot as L.jsonl.
//   node prep-longs-prompt.mjs <raw dir> <scored dir>
import fs from 'node:fs';
import path from 'node:path';
import { stripTags } from '../lib/edition-window.mjs';
const [raw, out] = process.argv.slice(2);
for (const f of fs.readdirSync(raw).filter((x) => /^L\w*\.jsonl$/.test(x))) {
  const arm = f.split('.')[0];
  const rows = fs.readFileSync(path.join(raw, f), 'utf8').split('\n').filter(Boolean).map(JSON.parse)
    .map((r) => ({ ...r, raw_tagged: r.text, text: r.text == null ? r.text : stripTags(r.text) }));
  fs.writeFileSync(path.join(out, `${arm === 'L0' ? 'L' : arm}.jsonl`), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
}
