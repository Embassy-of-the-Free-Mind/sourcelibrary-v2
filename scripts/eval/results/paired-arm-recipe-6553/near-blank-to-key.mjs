#!/usr/bin/env node
// PRIOR ART: scripts/maintenance/wrong-leaf-fix-5021.mjs `judge` (the gate this reads; its judge.jsonl holds both Englishes'
// verdicts per page, blind X/Y order). This only re-keys those verdicts into judge.mjs's key.json / verdicts-opus.jsonl so
// paired-arm.mjs can check and score the gate (#6553). No model calls, no database.
//   node scripts/eval/results/paired-arm-recipe-6553/near-blank-to-key.mjs   (repo root)
import fs from 'node:fs';
import crypto from 'node:crypto';
const SRC = 'scripts/eval/results/near-blank-fix-5274', OUT = 'scripts/eval/results/paired-arm-recipe-6553/near-blank-gate';
const rows = (f) => fs.readFileSync(`${SRC}/${f}`, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const gateOf = new Map(rows('gate-reads.jsonl').map((r) => [r.page_id, r.gate]));
const id = (s) => 'j' + crypto.createHash('sha256').update(s).digest('hex').slice(0, 10);
const key = [], verdicts = [];
for (const r of rows('judge.jsonl')) {
  for (const arm of ['new', 'stored']) {
    const v = r.verdict[arm], j = id(`${r.page_id}:${arm}`);
    // accept = "nothing not on the leaf" (the gate's clean); an addition is wrong text; a major omission or mistranslation misleads.
    const defects = [...(v.adds || []).map((a) => ({ class: 'T13', severity: 'wrong_text', quote: a.quote })),
      ...[...(v.omitted || []), ...(v.mistranslated || [])].filter((d) => d.severity === 'major').map((d) => ({ class: 'T8', severity: 'misleads', quote: d.quote }))];
    key.push({ id: `k${j.slice(1)}`, judged_as: j, cell: gateOf.get(r.page_id), route: arm, kind: 'item', page_id: r.page_id, book_id: r.book_id, neighbours: ['n-1', 'n+1'] });
    verdicts.push({ id: j, verdict: { accept: v.verdict === 'clean', fidelity: v.verdict === 'clean' ? 5 : 3, defects } });
  }
}
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(`${OUT}/key.json`, JSON.stringify(key, null, 1) + '\n');
fs.writeFileSync(`${OUT}/verdicts-opus.jsonl`, verdicts.map((x) => JSON.stringify(x)).join('\n') + '\n');
console.log(`${key.length} keyed outputs from ${SRC}/judge.jsonl → ${OUT}`);
