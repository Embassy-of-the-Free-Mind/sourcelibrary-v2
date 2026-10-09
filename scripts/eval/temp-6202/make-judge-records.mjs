#!/usr/bin/env node
// PRIOR ART: scripts/eval/xlref-t1 — reused. translation-vs-reference/build-packet.mjs builds the blinded packets and takes one record per page with candidates[]; nothing merges byte-identical draws of one request first (temperature 0 repeats itself), which would spend a judge's read on a copy. This only writes that input.
/** Judge input for #6202: per model, one record per page with that model's draws as candidates, byte-identical draws merged (aliases kept apart). $0. */
//   node scripts/eval/temp-6202/make-judge-records.mjs [--work /data/scratch/sl/temp-6202] [--models lite,flash]
import fs from 'node:fs';
import path from 'node:path';
import { readJsonl, writeJsonl } from '../translation-vs-reference/common.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] != null ? args[i + 1] : d; };
const WORK = opt('work', '/data/scratch/sl/temp-6202');
const MODELS = opt('models', 'lite,flash').split(',');
export const ARMS = ['T1a', 'T1b', 'T1c', 'T02a', 'T02b', 'T0a', 'T0b'];
const recs = readJsonl(path.join(WORK, 'records.jsonl'));
for (const m of MODELS) {
  const out = []; const aliases = {}; const dropped = []; let merged = 0;
  for (const r of recs) {
    const id = `${r.book_id}_${r.page_number}`; const texts = {};
    for (const a of ARMS) { const f = path.join(WORK, 'arms', `${m}-${a}`, `${id}.json`); if (fs.existsSync(f)) texts[a] = JSON.parse(fs.readFileSync(f, 'utf8')).text.trim(); }
    // registered spend fallback (1): a T0b that was not run equals T0a
    if (!texts.T0b && texts.T0a && fs.existsSync(path.join(WORK, `t0b-equals-t0a.${m}`))) texts.T0b = texts.T0a;
    const missing = ARMS.filter((a) => !texts[a]);
    if (missing.length) { dropped.push({ id, set: r.set, missing }); continue; } // complete cases only
    const cands = []; const al = {};
    for (const a of ARMS) { const hit = cands.find((c) => c.text === texts[a]); if (hit) { al[a] = hit.arm; merged++; } else { cands.push({ arm: a, text: texts[a] }); al[a] = a; } }
    aliases[id] = al;
    const { set, context_mode, toh, folio, ...rest } = r;
    out.push({ ...rest, candidates: cands });
  }
  writeJsonl(path.join(WORK, `judge-${m}.jsonl`), out);
  fs.writeFileSync(path.join(WORK, `aliases-${m}.json`), JSON.stringify({ aliases, dropped }, null, 1));
  console.log(`${m}: ${out.length} items, ${out.reduce((s, r) => s + r.candidates.length, 0)} candidates (${merged} identical draws merged), dropped ${dropped.length} ${JSON.stringify(dropped.slice(0, 5))}`);
}
