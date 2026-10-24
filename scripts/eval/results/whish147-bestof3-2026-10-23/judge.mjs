// Best-of-N judges for the Whish 147 fresh reads (#7119). Given N reads of one leaf, an Opus judge picks one; it never
// sees the edition.
//   J-text  : the candidates only, in IAST: which is the most plausible text a scribe wrote.
//   J-image : the leaf's column crops (fresh.mjs's leafPieces, byte-identical) + the candidates in Malayalam as written:
//             which matches the leaf, after checking 3 rows letter by letter.
//   J-rows  : J-image, but the judge picks the best candidate for each physical row (assembled into one text).
// Candidates go in shuffled order (seeded by leaf + judge + pool); the key is stored with each reply.
// Gate (no writes):  JOB_SCRATCH=<dir> STAB=<stability results dir> node judge.mjs --gate [--concurrency=3]
// PRIOR ART: ../whish147-stability-recall-2026-10-23/judge.mjs (branch eval/whish147-stability-recall) — a blind
// sensibility judge that RATED each model's most central read row by row (S/P/G); it never picked among a leaf's reads
// and never saw the image. Its prompt framing is the starting point of J-text. lib.mjs is that run's harness, unchanged.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { sealedCall, pool, UsageLimit } from './lib.mjs';
import { leafPieces } from '../whish147-best-attempt-2026-10-22/fresh.mjs';
import { weeklyPct } from '../../../batch/refused-pages.mjs';

export const HERE = path.dirname(new URL(import.meta.url).pathname);
const PY = process.env.VENV_PY || '/root/jobs/whish147-bestof3/venv/bin/python';
const L = 'ABCDEFGH';

export function candidates(files) {
  const j = JSON.parse(execFileSync(PY, [path.join(HERE, 'cands.py'), ...Object.values(files)], { maxBuffer: 1 << 26 }).toString());
  return Object.fromEntries(Object.entries(files).map(([k, f]) => [k, j[f]]));
}

function order(names, seed) {
  return [...names].map((n) => [createHash('sha256').update(seed + '|' + n).digest('hex'), n]).sort().map((x) => x[1]);
}

const CONTEXT = `The leaf is from a Kerala palm-leaf manuscript (Malayalam script, Calicut 1822) holding Sanskrit works: the Sāṅkhyakārikā with its commentaries, and Annambhaṭṭa's Tarkasaṃgraha with the Dīpikā; some commentary passages are in Malayalam. Each row is one physical row of the leaf; ‖ marks a string hole, and the row continues straight across it. The scribe leaves no spaces, and a row may begin or end mid-word. [illegible] marks where the transcriber could not read.`;

export const TEXT_PROMPT = (cs) => `Below are ${cs.length} machine transcriptions (${L.slice(0, cs.length).split('').join(', ')}) of the same palm leaf, converted from Malayalam script to IAST. ${CONTEXT}

You see no image and no edition. Which transcription is the most plausible text that a scribe actually wrote: continuous, grammatical Sanskrit (or Malayalam) that makes sense in context, rather than strings of syllables that only look like words? Rank a transcription that reads as real language in most rows above one that is fluent in a few rows and broken elsewhere. Do not prefer a transcription only because it is longer or has fewer [illegible] marks.

${cs.map(([lab, c]) => `TRANSCRIPTION ${lab}\n${c.iast.map((r, i) => `${i + 1}. ${r}`).join('\n')}`).join('\n\n')}

Answer only:
PICK | <one letter>
RANK | <all letters, best to worst>
WHY | <one sentence>`;

const IMG_HEAD = (k) => `The files ${Array.from({ length: k }, (_, i) => `p${String(i + 1).padStart(2, '0')}.jpg`).join(', ')} are pieces of ONE palm leaf, cut left to right at its two string holes (left column | middle column | right column; a wide column may come as two pieces; neighbouring pieces overlap slightly). Open every file with the Read tool and look at them at full size.`;

export const IMAGE_PROMPT = (k, cs) => `${IMG_HEAD(k)}

Below are ${cs.length} machine transcriptions (${L.slice(0, cs.length).split('').join(', ')}) of this leaf in Malayalam script, as the readers wrote them. ${CONTEXT}

Which transcription matches what is written on the leaf? Before choosing, check three rows (row 1, a middle row, and the last full row) letter by letter against the image, for every transcription. Judge by the strokes: a fluent text whose letters are not the ones on the leaf is wrong, and a transcription that marks a readable row [illegible] loses that row. Do not prefer a transcription only because it is longer.

${cs.map(([lab, c]) => `TRANSCRIPTION ${lab}\n${c.mal.map((r, i) => `${i + 1}. ${r}`).join('\n')}`).join('\n\n')}

Answer only:
CHECK | row <n>: <what the leaf shows at the start of that row, and which transcriptions match it>
CHECK | row <n>: ...
CHECK | row <n>: ...
PICK | <one letter>
RANK | <all letters, best to worst>
WHY | <one sentence>`;

export const ROWS_PROMPT = (k, cs, n) => `${IMG_HEAD(k)}

Below are ${cs.length} machine transcriptions (${L.slice(0, cs.length).split('').join(', ')}) of this leaf in Malayalam script, as the readers wrote them. ${CONTEXT} The transcriptions may number the rows differently (one may skip or merge a row), so match rows by their content and position on the leaf, not by number alone.

The leaf has ${n} physical rows by the first transcription's count. For EACH physical row of the leaf, top to bottom, choose the transcription row that best matches the strokes on the leaf, checking it letter by letter against the image. A fluent row whose letters are not the ones on the leaf is wrong. If no transcription has the row, say none.

${cs.map(([lab, c]) => `TRANSCRIPTION ${lab}\n${c.mal.map((r, i) => `${i + 1}. ${r}`).join('\n')}`).join('\n\n')}

Answer only, one line per physical row:
ROW 1 | <letter>.<row number in that transcription, e.g. B.1, or none>
ROW 2 | ...
WHY | <one sentence>`;

export function parsePick(text, labels) {
  const m = text.match(/^PICK\s*\|\s*([A-H])\b/m);
  return m && labels.includes(m[1]) ? m[1] : null;
}

export function parseRows(text) {
  return [...text.matchAll(/^ROW\s+(\d+)\s*\|\s*(?:([A-H])\.(\d+)|none)/gm)].map((m) => (m[2] ? { lab: m[2], row: Number(m[3]) } : null));
}

/** One judge call on one leaf. files: {candidateName: readPath}. Returns {pick: candidateName|null, key, text}. */
export async function judge({ stage, key, kind, files }) {
  const pct = weeklyPct();
  if (pct != null && pct >= 85) throw new UsageLimit(`weekly ${pct}% >= 85%`);
  const C = candidates(files);
  const names = order(Object.keys(C).filter((n) => C[n].mal.length), `${key}|${kind}|${Object.keys(files).join(',')}`);
  const cs = names.map((n, i) => [L[i], C[n]]);
  const keyMap = Object.fromEntries(names.map((n, i) => [L[i], n]));
  let prompt, images = [];
  if (kind === 'text') prompt = TEXT_PROMPT(cs);
  else {
    const [n, leaf] = key.split('-');
    images = (await leafPieces(Number(n), leaf)).files;
    prompt = kind === 'image' ? IMAGE_PROMPT(images.length, cs) : ROWS_PROMPT(images.length, cs, cs[0][1].mal.length);
  }
  const r = await sealedCall({ stage, id: key, model: 'opus', prompt, images });
  fs.writeFileSync(path.join(HERE, 'reads', stage, `${key}.key.json`), JSON.stringify(keyMap, null, 1));
  if (!r.meta.ok) return { pick: null, keyMap, text: r.text, error: r.meta.error_class };
  if (kind === 'rows') {
    const sel = parseRows(r.text);
    const rows = sel.map((s) => (s && keyMap[s.lab] ? C[keyMap[s.lab]].mal[s.row - 1] ?? null : null)).filter((x) => x != null);
    return { pick: 'rows', rows, sel, keyMap, text: r.text };
  }
  const lab = parsePick(r.text, Object.keys(keyMap));
  return { pick: lab ? keyMap[lab] : null, keyMap, text: r.text };
}

const VERSE = ['4-b', '5-t', '5-b', '6-t', '6-b', '7-t', '8-t', '8-b', '9-t'];

async function gate() {
  const STAB = process.env.STAB;
  const conc = Number(process.argv.find((a) => a.startsWith('--concurrency='))?.split('=')[1] || 3);
  const ALL = { opus3: ['opus-1', 'opus-2', 'opus-3'], all6: ['opus-1', 'opus-2', 'opus-3', 'fable-1', 'fable-2', 'fable-3'], opus3fable1: ['opus-1', 'opus-2', 'opus-3', 'fable-1'] };
  const want = (process.argv.find((a) => a.startsWith('--pools='))?.split('=')[1] || 'opus3,all6').split(',');
  const pools = Object.fromEntries(want.map((w) => [w, ALL[w]]));
  const kinds = (process.argv.find((a) => a.startsWith('--kinds='))?.split('=')[1] || 'text,image').split(',');
  const tasks = [];
  for (const kind of kinds) for (const [pn, stages] of Object.entries(pools)) for (const key of VERSE) tasks.push({ kind, pn, stages, key });
  const outF = path.join(HERE, 'gate-picks.json');
  const out = fs.existsSync(outF) ? JSON.parse(fs.readFileSync(outF, 'utf8')) : {};
  await pool(tasks, conc, async ({ kind, pn, stages, key }) => {
    const files = Object.fromEntries(stages.map((s) => [s, path.join(STAB, 'reads', s, `${key}.txt`)]));
    const r = await judge({ stage: `gate-${kind}-${pn}`, key, kind, files });
    out[`${kind}|${pn}|${key}`] = r.pick === 'rows' ? { pick: 'rows', rows: r.rows, sel: r.sel, keyMap: r.keyMap } : { pick: r.pick, keyMap: r.keyMap, error: r.error };
    fs.writeFileSync(outF, JSON.stringify(out, null, 1));
    console.log(`${kind} ${pn} ${key}: ${r.pick === 'rows' ? `${r.rows.length} rows` : r.pick}`);
  });
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}` && process.argv.includes('--gate')) await gate();
