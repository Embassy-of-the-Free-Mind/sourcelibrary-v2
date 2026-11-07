// PRIOR ART: scripts/eval/zh-planted-8171/calls.mjs (ledger with hard caps, claudeCall on the subscription with a
// Read-only tool for a page image, poolOk floor), reused by import; scripts/lib/agy-cli.mjs gatedImageCall (one image
// in a gated workspace on agy -p). Neither reads the #8182 composed images, nor keeps #8182's caps (600 agy, 300 Claude).
/**
 * #8182 positive controls: gemini-3.8-flash-low (agy, image) and Opus (claude -p, the image as a file it may Read)
 * read the composed N / S / W images, as the preregistration says:
 *   F (Flash): N, S, W on the first 20 ok pages per group TK, TO, ZB, ZC, + N again (N_r2) on the first 10 = 280 calls.
 *   O (Opus):  N, S on the first 16 ok pages per Chinese group ZB, ZC = 64 calls. Changed from the prereg's 8 per
 *              group of four: on the test read Opus marked nearly every Tibetan glyph '?' (red Derge print, sliced), so it
 *              cannot be a Tibetan control; its calls go to Chinese.
 *   node scripts/eval/ocr-context-8182/controls.mjs --arm=F|O --build=$JOB_SCRATCH/build --out=$JOB_SCRATCH/reads
 *        [--home=/root/.agy-james] [--conc=3] [--extra=B] [--groups=TK,TO] (run only these groups: a group is
 *        run once every page of it is composed, so 'the first 20 ok' is taken from the whole group)   (extra: also read B on the Flash pages, the blur check)
 * The images are JPEGs made from the PNGs on gex45 (<build>/<stem>/<IMG>.jpg). Writes <out>/<arm>/<stem>__<IMG>.json
 * { id, arm, text, cls, seconds }. Reads stay in $JOB_SCRATCH (page text: never committed).
 */
import fs from 'fs'; import os from 'os'; import path from 'path';
import { claudeCall, setLedger, poolOk, used, CAPS } from '../zh-planted-8171/calls.mjs';
CAPS.agy = 600; CAPS.claude = 300;
const argOf = (n, d) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const ARM = argOf('arm'), BUILD = argOf('build'), OUTB = argOf('out'), CONC = +argOf('conc', 3);
const HOME = argOf('home', '/root/.agy-james'), EXTRA = (argOf('extra', '') || '').split(',').filter(Boolean);
setLedger(path.join(OUTB, 'calls.jsonl'));
if (ARM === 'F') { process.env.AGY_HOME = HOME; process.env.AGY_POOL_SHARED = '1'; }
const OUT = path.join(OUTB, ARM); fs.mkdirSync(OUT, { recursive: true });

export const PROMPT = {
  tib: 'Extract all Tibetan text. Preserve line breaks.',
  zh: 'Transcribe all Chinese characters in this image, column by column from right to left, one column per line. Output only the characters.',
};
const GROUPS = ['TK', 'TO', 'ZB', 'ZC'];
const todo = fs.readFileSync(path.join(BUILD, 'todo.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const okStems = (g) => todo.filter((r) => r.group === g).filter((r) => {
  try { return JSON.parse(fs.readFileSync(path.join(BUILD, r.stem, 'manifest.json'), 'utf8')).outcome === 'ok'; } catch { return false; }
});
const jobs = [];
const ONLY = (argOf('groups', '') || '').split(',').filter(Boolean);
for (const g of (ARM === 'O' ? ['ZB', 'ZC'] : GROUPS).filter((x) => !ONLY.length || ONLY.includes(x))) {
  const rows = okStems(g);
  rows.slice(0, ARM === 'F' ? 20 : 16).forEach((r, i) => {
    const imgs = ARM === 'F' ? ['N', 'S', 'W', ...EXTRA] : ['N', 'S'];
    for (const im of imgs) jobs.push({ r, im, file: im });
    if (ARM === 'F' && i < 10) jobs.push({ r, im: 'N__r2', file: 'N' });
  });
}
console.log(`${ARM}: ${jobs.length} reads planned; ledger ${JSON.stringify(used())}`);

let stop = null, n = 0;
async function one({ r, im, file }) {
  const id = `${r.stem}__${im}`, f = path.join(OUT, `${id}.json`);
  if (fs.existsSync(f) || stop) return;
  const jpg = path.join(BUILD, r.stem, `${file}.jpg`);
  if (!fs.existsSync(jpg)) { fs.writeFileSync(f, JSON.stringify({ id, arm: ARM, text: '', cls: 'no-image' })); return; }
  const prompt = PROMPT[r.script];
  let row;
  try {
    if (ARM === 'O') {
      // the image in ordered slices (tojpeg.py): Read downscales a whole strip until the letters are illegible
      const parts = [1, 2, 3].map((i) => path.join(BUILD, r.stem, `${file}.o${i}.jpg`)).filter((f) => fs.existsSync(f));
      const files = Object.fromEntries(parts.map((f, i) => [`part${i + 1}.jpg`, f]));
      const order = r.script === 'tib' ? 'left to right: part1 is the left end of every line' : 'right to left: part1 holds the rightmost columns';
      const res = await claudeCall(`${prompt}\n\nThe image is cut into ${parts.length} slices, files ${Object.keys(files).join(', ')} in the current directory, ${order}. Open each with the Read tool and transcribe all of them in order (${r.script === 'tib' ? 'all of part1, then part2, then part3' : 'part1 first, then part2'}). Read every glyph you can; mark an unreadable one with ?. Output only the transcription, nothing else.`, { what: id, files });
      row = { text: res.text, cls: res.cls, seconds: res.seconds, model: res.model };
    } else {
      if (n++ % 10 === 0) {
        const p = await poolOk(HOME);
        fs.appendFileSync(path.join(OUTB, 'quota.jsonl'), JSON.stringify({ at: new Date().toISOString(), arm: ARM, home: HOME, ...p }) + '\n');
        if (!p.ok) { stop = `pool under its floor ${JSON.stringify(p.reading)} line ${p.line}`; return; }
      }
      const { gatedImageCall, isQuotaError } = await import('../../lib/agy-cli.mjs');
      const t0 = Date.now();
      // one attempt only, booked in the ledger like every other call
      const led = path.join(OUTB, 'calls.jsonl');
      if (used().agy >= CAPS.agy) throw new Error(`CAP: agy calls would pass ${CAPS.agy}`);
      fs.appendFileSync(led, JSON.stringify({ kind: 'agy', what: id, at: new Date().toISOString() }) + '\n');
      const res = await gatedImageCall((name) => `${prompt}\n\n@./${name}`, fs.readFileSync(jpg), { model: 'gemini-3.8-flash-low', attempts: 1, tmp: os.tmpdir() });
      const quota = res.cls === 'quota' || isQuotaError({ out: res.out || '', err: res.err || '', text: res.text || '' });
      row = { text: res.text ?? '', cls: quota ? 'quota' : res.cls ?? null, seconds: (Date.now() - t0) / 1000 };
    }
  } catch (e) { stop = e.message; return; }
  if (row.cls === 'quota') { stop = `quota at ${id}`; return; }
  fs.writeFileSync(f, JSON.stringify({ id, arm: ARM, ...row }));
  console.log(`${id} ${row.text ? 'ok' : 'EMPTY ' + row.cls} ${row.seconds?.toFixed(0)}s`);
}
const q = [...jobs];
await Promise.all(Array.from({ length: CONC }, async () => { while (q.length && !stop) await one(q.shift()); }));
console.log(stop ? `STOPPED: ${stop}` : `done ${ARM} (${jobs.length}); calls used ${JSON.stringify(used())}`);
