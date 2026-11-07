// Blind sensibility judge for the Whish 147 reads (#7119): Opus sees three reads of one leaf in IAST (one per model,
// the read most like that model's other two reads), labelled A/B/C in shuffled order, with no image and no edition,
// and says row by row whether each is grammatical Sanskrit that makes sense as Sāṅkhya or Nyāya text.
//   JOB_SCRATCH=<dir> node judge.mjs --leaves=5-b,7-t,20-b,129-b
// PRIOR ART: ./lib.mjs sealedCall (the job's harness); no earlier judge here read a transcription for sense rather
// than against a reference.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { sealedCall } from './lib.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const leaves = process.argv.find((a) => a.startsWith('--leaves=')).split('=')[1].split(',');
const MODELS = { opus: ['opus-1', 'opus-2', 'opus-3'], sonnet: ['sonnet-1', 'sonnet-2', 'sonnet-3'], fable: ['fable-1', 'fable-2', 'fable-3'] };
const PY = process.env.VENV_PY;

// Pick each model's most central read and render it in IAST (rows kept, ‖ kept), via score_lib in Python.
const pick = JSON.parse(execFileSync(PY, ['-c', `
import json, sys, os, re, itertools, statistics as st
sys.path.insert(0, ${JSON.stringify(HERE)})
from score_lib import mal2iast, read_rows
from rapidfuzz.distance import Levenshtein
M = ${JSON.stringify(MODELS)}
out = {}
for leaf in ${JSON.stringify(leaves)}:
    out[leaf] = {}
    for m, stages in M.items():
        texts = {sg: ''.join(read_rows(sg, leaf) or []) for sg in stages}
        texts = {k: v for k, v in texts.items() if v}
        if not texts: continue
        cen = max(texts, key=lambda a: st.mean([1 - Levenshtein.distance(texts[a], texts[b]) / max(len(texts[a]), len(texts[b]), 1) for b in texts if b != a] or [0]))
        d = os.path.join(${JSON.stringify(HERE)}, 'reads', cen)
        f = os.path.join(d, leaf + '.final.txt') if os.path.exists(os.path.join(d, leaf + '.final.txt')) else os.path.join(d, leaf + '.txt')
        rows = [mm.group(1) for mm in re.finditer(r'^ROW\\s+(?:\\d+)\\s*\\|\\s*(.*)$', open(f).read(), re.M)]
        iast = [' ‖ '.join(mal2iast(seg).strip() for seg in r.split('‖')) for r in rows]
        out[leaf][m] = dict(stage=cen, rows=iast)
print(json.dumps(out, ensure_ascii=False))
`]).toString());

const PROMPT = (reads) => `Below are three machine transcriptions (A, B, C) of the same palm leaf of a Sanskrit manuscript, converted to IAST. The leaf is from a Kerala manuscript holding the Sāṅkhyakārikā with commentaries (Jayamaṅgalā, Tattvakaumudī) and Annambhaṭṭa's Tarkasaṃgraha with Dīpikā. Each row is one physical row of the leaf; ‖ marks a string hole, and a row continues straight across it. Words often run together (the scribe leaves no spaces), and a row may begin or end mid-word.

You see no image and no edition. Judge only the language: for each row of each transcription, is it grammatical Sanskrit that makes sense in context as Sāṅkhya or Nyāya text? Use: S = sensible (readable Sanskrit, plausible in this text), P = partly (some real words or phrases, but broken), G = gibberish (syllables that do not form Sanskrit). Do not reward a row for being a passage you recognise; judge whether it reads as Sanskrit.

${reads.map(([lab, rows]) => `TRANSCRIPTION ${lab}\n${rows.map((r, i) => `${i + 1}. ${r}`).join('\n')}`).join('\n\n')}

Answer only, one line per transcription, then one line of comment:
A | <S/P/G per row, comma-separated> | overall: <S/P/G>
B | ...
C | ...
COMMENT | <one sentence>`;

for (const leaf of leaves) {
  const ms = Object.keys(pick[leaf]);
  const order = [...ms].sort(() => Math.random() - 0.5);
  const labels = ['A', 'B', 'C'];
  const key = Object.fromEntries(order.map((m, i) => [labels[i], { model: m, stage: pick[leaf][m].stage }]));
  const r = await sealedCall({ stage: 'judge', id: leaf, model: 'opus', prompt: PROMPT(order.map((m, i) => [labels[i], pick[leaf][m].rows])), images: [] });
  fs.writeFileSync(path.join(HERE, 'reads', 'judge', `${leaf}.key.json`), JSON.stringify(key, null, 1));
  console.log(leaf, JSON.stringify(key), '\n', r.text);
}
