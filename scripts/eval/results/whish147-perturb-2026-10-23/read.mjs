// Whish 147 perturbation / preprocessing test (#7119): one sealed Opus read per leaf of one image variant.
// Read-only: writes reads/<variant>/<leaf>.txt (+ .meta.json) and nothing to the database.
//   JOB_SCRATCH=<dir with crops/<variant>/> node read.mjs --variant=clahe [--leaves=4-b,5-t] [--concurrency=3] [--max-calls=200]
// Variants are made by variants.py. Every column variant gets FRESH_PROMPT unchanged (same hash as the stability
// test's Opus reads, checked at start); the `rows` variant changes only the sentence that says what the files are.
// PRIOR ART: ../whish147-stability-recall-2026-10-23/run.mjs (PR #7203) — FRESH_PROMPT is copied verbatim from it
// (itself from ../whish147-best-attempt-2026-10-22/fresh.mjs); it cuts its own crops and has no variants.
import fs from 'node:fs';
import path from 'node:path';
import { SCRATCH, HERE, sealedCall, pool, hash16 } from './lib.mjs';
import { VERSE } from './pieces.mjs';

const args = process.argv.slice(2);
const arg = (n) => args.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const VARIANT = arg('variant'), CONC = Number(arg('concurrency') || 3), MAX = Number(arg('max-calls') || 200);
const LEAVES = arg('leaves') ? arg('leaves').split(',') : VERSE;

export const FRESH_PROMPT = (k) => `The files ${Array.from({ length: k }, (_, i) => `p${String(i + 1).padStart(2, '0')}.jpg`).join(', ')} are pieces of ONE palm leaf of a Kerala manuscript (Sanskrit in Malayalam script, Calicut 1822), cut left to right; neighbouring pieces overlap slightly. The leaf has two string holes; the pieces are cut at the holes (left column | middle column | right column; a wide column may come as two pieces). Open every file with the Read tool.

Transcribe the leaf in MALAYALAM SCRIPT exactly as written: keep the scribe's dot-reph ൎ, doubled consonants, visarga sandhi and chillu letters; no normalisation, and no spaces the scribe did not leave. Give numbered physical rows, top to bottom. The top one or two rows and the bottom one or two rows run the full width; every row reads straight across both holes, so row N = left row N + middle row N + right row N, joined with ‖ at each hole (do not repeat text that appears twice in an overlap). Write [illegible] where you cannot read. Do NOT supply text from memory of the Sāṅkhyakārikā or of any commentary: if you recognise the passage, still write only what the strokes show.

Answer only:
ROW 1 | <Malayalam text, with ‖ at each hole>
ROW 2 | ...
NOTE | <one line: e.g. how much of the leaf you could read>`;

/** The rows variant: only the description of the files differs from FRESH_PROMPT. */
const ROWS_PROMPT = (n, k) => FRESH_PROMPT(k).replace(
  /^The files .*? Open every file with the Read tool\./s,
  `The files p01.jpg … p${String(n * k).padStart(2, '0')}.jpg are pieces of ONE palm leaf of a Kerala manuscript (Sanskrit in Malayalam script, Calicut 1822), cut into its ${n} physical rows, and each row cut left to right into ${k} pieces at the leaf's two string holes (left column | middle column | right column; the wide middle column comes as two pieces); neighbouring pieces overlap slightly, and a strip may show the edge of the row above or below. The files go row by row: p01–p${String(k).padStart(2, '0')} are row 1 left to right, p${String(k + 1).padStart(2, '0')}–p${String(2 * k).padStart(2, '0')} row 2, and so on. Open every file with the Read tool.`);

if (hash16(FRESH_PROMPT(4)) !== 'ef836994a6f1e9ca') throw new Error('FRESH_PROMPT drifted from the stability test');

const callsSoFar = () => {
  const f = path.join(HERE, 'reads', 'calls.jsonl');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).length : 0;
};

async function main() {
  const dir = path.join(SCRATCH, 'crops', VARIANT);
  const info = JSON.parse(fs.readFileSync(path.join(HERE, 'variants.json'), 'utf8'));
  await pool(LEAVES, CONC, async (key) => {
    if (callsSoFar() >= MAX) { console.log(`${key}: call cap ${MAX} reached, skipped`); return; }
    const files = fs.readdirSync(dir).filter((f) => f.startsWith(`${key}-`) && f.endsWith('.jpg'))
      .sort((a, b) => Number(a.slice(key.length + 1, -4)) - Number(b.slice(key.length + 1, -4))).map((f) => path.join(dir, f));
    const prompt = VARIANT === 'rows' ? ROWS_PROMPT(info[key].rows.n, files.length / info[key].rows.n) : FRESH_PROMPT(files.length);
    const r = await sealedCall({ stage: VARIANT, id: key, model: 'opus', prompt, images: files });
    const rows = (r.text.match(/^ROW\s+\d+/gm) || []).length;
    console.log(`${VARIANT} ${key}: ${r.meta.ok ? 'ok' : r.meta.error_class} ${r.meta.model} ${files.length} files, ${rows} rows (${r.meta.secs}s${r.cached ? ', cached' : ''})`);
  });
}
await main();
