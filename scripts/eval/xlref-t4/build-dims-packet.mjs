#!/usr/bin/env node
// PRIOR ART: scripts/eval/translation-vs-reference/build-packet.mjs builds the blinded FIDELITY packet (reference shown as a guide, candidates as T1..Tn); #5695 addendum B wants a separate, non-blind profile pass of two texts (served English and the published reference) on five more dimensions. This writes that packet for DIMENSIONS-PROMPT.md.
/** Dimension-pass packet (#5695 addendum B): per page, the served English and the published reference as A/B (order seeded), for one Opus reader. */
//   node scripts/eval/xlref-t4/build-dims-packet.mjs --input records.jsonl --out <dir outside git if any reference is private> [--arm served] [--chunk 4] [--seed 5695]
import fs from 'node:fs';
import path from 'node:path';
import { resetSeed, seededRand } from '../lib/paired-stats.mjs';
import { readJsonl, writeJsonl, itemId, insideGitTree } from '../translation-vs-reference/common.mjs';
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const OUT = opt('out'); const ARM = opt('arm', 'served'); const CHUNK = Number(opt('chunk', 4));
const recs = readJsonl(opt('input'));
if (recs.some((r) => r.reference_meta.private) && insideGitTree(OUT)) { console.error('private references: --out must be outside a git tree'); process.exit(1); }
resetSeed(Number(opt('seed', 5695)));
const key = {}; const items = [];
for (const r of recs) {
  const ours = r.candidates.find((c) => c.arm === ARM)?.text; if (!ours) continue;
  const refText = r.reference_text.split('\n').filter((l) => !l.startsWith('[context]')).join('\n');
  const oursIsA = seededRand() < 0.5; const id = itemId(r);
  key[id] = { A: oursIsA ? ARM : 'reference', B: oursIsA ? 'reference' : ARM };
  items.push({ id, lang: r.lang, genre: r.genre ?? null, reference_year: r.reference_meta.year ?? null, reference_style: r.reference_meta.style, source: r.source_text,
    a_kind: oursIsA ? 'machine' : 'published', b_kind: oursIsA ? 'published' : 'machine', A: oursIsA ? ours : refText, B: oursIsA ? refText : ours });
}
fs.mkdirSync(path.join(OUT, 'verdicts'), { recursive: true });
const lines = [];
for (let c = 0; c * CHUNK < items.length; c++) {
  const name = `dims-${String(c + 1).padStart(2, '0')}.jsonl`;
  writeJsonl(path.join(OUT, 'packets', name), items.slice(c * CHUNK, (c + 1) * CHUNK));
  lines.push(`- [j1] Read ${path.resolve(path.dirname(new URL(import.meta.url).pathname), 'DIMENSIONS-PROMPT.md')} and follow it exactly. INPUT_FILE=${path.resolve(OUT, 'packets', name)} OUTPUT_FILE=${path.resolve(OUT, 'verdicts', name)}`);
}
fs.writeFileSync(path.join(OUT, 'key.json'), JSON.stringify(key, null, 1));
fs.writeFileSync(path.join(OUT, 'DISPATCH.md'), lines.join('\n') + '\n');
console.log(`${items.length} items → ${lines.length} chunks in ${OUT}`);
