// PRIOR ART: scripts/batch/claude-ocr.mjs — its claudeCall, callInstruction and live prompt are reused unchanged; this only adds the strip arm (many single-row images of one leaf per call). Run from scripts/ as a sibling of batch/ (it was run as scripts/_tmp-whish-lines.mjs).
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os'; import { createHash } from 'node:crypto';
import { claudeCall, callInstruction, splitPages, languageInstruction } from './batch/claude-ocr.mjs';
import { liveOcrPrompt } from './lib/live-ocr-prompt.mjs';
const S = process.argv[2], OUT = process.argv[3], ARMS = process.argv[4].split(','), LEAVES = process.argv[5].split(',');
fs.mkdirSync(OUT, { recursive: true });
const { MongoClient } = await import('mongodb');
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const { base, ref } = await liveOcrPrompt(c.db('bookstore'), languageInstruction('Sanskrit')); await c.close();
fs.writeFileSync(`${OUT}/prompt-base.txt`, base); fs.writeFileSync(`${OUT}/prompt-ref.json`, JSON.stringify(ref));
const strips = JSON.parse(fs.readFileSync(`${S}/strips/strips.json`, 'utf8'));
const stripInstr = (n) => `\n\n**This call: ${n} strip images of ONE palm leaf.** The files p01 … p${String(n).padStart(2, '0')} in this folder are strips cut at full resolution from a single leaf (the left half of the leaf), each holding ONE row of writing. The leaf has a string hole: each row is cut into the part left of the hole and the part right of it, and the strips are in reading order: row 1 left of the hole, row 1 right of it, row 2 left, row 2 right, and so on. A strip may show the edges of the rows above and below it; transcribe only the row through the middle of the strip. Open each with the Read tool. Transcribe each strip separately: never carry text over from a neighbouring strip, and never supply text from memory of the work.\nAnswer with, for each strip in order, a line \`===== PAGE pNN =====\` (the file name without .jpg) followed by that strip's transcription only, in the script as written; mark doubtful letters <unclear>…</unclear> and write [illegible] where nothing can be read. No other tags and no commentary.\n`;
const MODELS = { opus: 'claude-opus-5-5', fable: 'claude-fable-5-1' };
const jobs = [];
for (const arm of ARMS) for (const lf of LEAVES) jobs.push({ arm, lf });
async function run({ arm, lf }) {
  const [model, kind] = arm.split('-');      // e.g. opus-half, fable-strip
  const outf = `${OUT}/${arm}-${lf}.txt`; if (fs.existsSync(outf)) return;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-'));
  let n, prompt;
  if (kind === 'half') { fs.copyFileSync(`${S}/ml/L${lf}.jpg`, `${dir}/p01.jpg`); n = 1; prompt = base + callInstruction(1); }
  else { const fs2 = strips[lf]; n = fs2.length; fs2.forEach((r, i) => fs.copyFileSync(`${S}/strips/${r.file}`, `${dir}/p${String(i + 1).padStart(2, '0')}.jpg`)); prompt = base + stripInstr(n); }
  const r = await claudeCall(prompt, MODELS[model], dir);
  const pages = splitPages(r.text, n);
  fs.writeFileSync(outf, r.text);
  fs.writeFileSync(`${OUT}/${arm}-${lf}.meta.json`, JSON.stringify({ arm, leaf: lf, model_requested: MODELS[model], model: r.model, n_images: n, markers_ok: !!pages, cls: r.cls, secs: r.secs, usage: r.usage, prompt_sha256: createHash('sha256').update(prompt).digest('hex'), prompt_ref: ref }, null, 1));
  console.log(arm, lf, r.cls || 'ok', 'markers', !!pages, Math.round(r.secs) + 's');
  fs.rmSync(dir, { recursive: true, force: true });
  if (r.cls === 'usage_limit') { console.log('USAGE LIMIT — stopping'); process.exit(3); }
}
const q = [...jobs]; await Promise.all(Array.from({ length: 3 }, async () => { while (q.length) await run(q.shift()); }));
