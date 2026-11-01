// PRIOR ART: scripts/eval/queue-routes-7853/lib.mjs (agyFace, judgeAbsolute = route-judge-6740 judgePrompt unchanged,
// paceCheck, wrongText, words7824, makeRng/shuffle/mulberry32, the severity weights SEV, wilcoxon, centuryBand/yearOf;
// imported unchanged). #7853's lib fixes OUT to its own scratch folder, so the helpers that write under OUT (imageFor,
// J, W) are restated here over this study's OUT. What is new: the frame is the latin-blank/print queue (the first-read
// lane's Latin frame, pages with no OCR), and the three arms are the Latin first-read routes (arms.mjs).
/**
 * Shared pieces of the Latin first-read paired test (scripts/eval/experiments/2026-11-01-latin-first-read-paired-6740.md).
 * Bulky files live in OUT ($JOB_SCRATCH/lp-6740, or --out); the committed summary is results/.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
export { agyFace, ENV_FILE, AGY_MODEL, AGY_CALL_USD, words7824, sha, makeRng, shuffle, mulberry32, judgeAbsolute, paceCheck, wrongText, SEV, wilcoxon, yearOf, centuryBand } from '../queue-routes-7853/lib.mjs';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '../../..');
export const RESULTS = path.join(HERE, 'results');
export const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
export const flag = (n) => process.argv.includes(`--${n}`);
export const OUT = path.resolve(arg('out') || path.join(process.env.JOB_SCRATCH || os.tmpdir(), 'lp-6740'));
export const J = (f) => JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8'));
export const W = (f, x) => { fs.mkdirSync(path.dirname(path.join(OUT, f)), { recursive: true }); fs.writeFileSync(path.join(OUT, f), JSON.stringify(x, null, 1)); };
export const jsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

// ── the preregistered seeds (experiment file §Seeds) ──
export const SEED = Object.freeze({ draw: 67401, queue: 67402, wrongPage: 67403, planted: 67404, bootstrap: 6740 });
/** Arms (experiment file §Arms). `live` is the route production runs on latin-blank/print today. */
export const ARMS = Object.freeze(['live', 'pero4', 'read4']);
export const ARM_NAMES = Object.freeze({ live: '1 PERO draft > agy, 1 a call (live)', pero4: '2 PERO draft > agy, 4 a call', read4: '3 agy fresh read, 4 a call' });
/** Router route ids, as rules.json names them in latin-blank. */
export const ROUTES = Object.freeze({ live: 'pero>agy-flash-low-written', pero4: 'pero>agy-flash-low@4-written', read4: 'agy-flash-low@4-written' });
/** The lane stamp (ocr.pipeline) each arm's write carries: the production lane's own where it runs the route. */
export const LANES = Object.freeze({ live: 'pero-agy-first-read-7701', pero4: 'pero-agy4-first-read-6740', read4: 'agy-first-read-7701' });
/** Cheaper first (agy calls a page, then GPU time): the write-back tie order. */
export const COST_ORDER = Object.freeze(['read4', 'pero4', 'live']);
/** Pages read a call by the block arms, and the block the page is drawn inside. */
export const BLOCK = 4;
/** PERO on gex45 (#7701 cheap routes' basis): GPU card time a page, at the box's share of $249 a month. */
export const GPU_SECS_PER_PAGE = 3, GPU_USD_PER_SEC = 249 / (30 * 86400);

/** Fetch an image once into OUT/img/<key>.jpg: the same bytes for the tagger, PERO, the correctors and the judge. */
export async function imageFor(key, url) {
  const f = path.join(OUT, 'img', `${key}.jpg`);
  if (fs.existsSync(f)) return fs.readFileSync(f);
  let last = null;
  for (let a = 0; a < 2; a++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'SourceLibrary-eval/6740 (https://sourcelibrary.org)' } });
      if (!r.ok) { last = new Error(`image HTTP ${r.status} ${String(url).slice(0, 100)}`); continue; }
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length < 2000) { last = new Error(`image under 2 KB ${String(url).slice(0, 100)}`); continue; }
      fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, buf);
      return buf;
    } catch (e) { last = e; }
  }
  throw last;
}
