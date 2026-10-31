// PRIOR ART: scripts/eval/fraktur-paired-7835/lib.mjs (agyFace, the image-once rule, ENV_FILE, AGY_CALL_USD, centuryOf;
// imported unchanged) and through it scripts/eval/correction-pass-7818/lib.mjs (judgeAbsolute = route-judge-6740
// judgePrompt unchanged, paceCheck, wrongText, sha, makeRng/shuffle). #7835's lib fixes OUT to its own scratch folder,
// so the few helpers that write under OUT (imageFor, J, W) are restated here over this study's OUT. What is new: the
// frame of #7853 is the whole #7558 correction queue weighted by pages owed (frame.mjs), and the four arms are the lanes'
// own paths (arms.mjs). Searched scripts/eval/INDEX.md (lib/ table) and scripts/eval/experiments/ for a queue-weighted
// draw: none (#7701, #7818 and #7835 drew books equally).
/**
 * Shared pieces of #7853 (scripts/eval/experiments/2026-10-31-queue-routes-7853.md). Bulky files live in OUT
 * ($JOB_SCRATCH/qr-7853, or --out); the committed summary is results/.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
export { agyFace, ENV_FILE, AGY_MODEL, AGY_CALL_USD, centuryOf, words7824 } from '../fraktur-paired-7835/lib.mjs';
export { sha, makeRng, shuffle, mulberry32, judgeAbsolute, paceCheck, wrongText, defectCounts } from '../correction-pass-7818/lib.mjs';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '../../..');
export const RESULTS = path.join(HERE, 'results');
export const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
export const flag = (n) => process.argv.includes(`--${n}`);
export const OUT = path.resolve(arg('out') || path.join(process.env.JOB_SCRATCH || os.tmpdir(), 'qr-7853'));
export const J = (f) => JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8'));
export const W = (f, x) => { fs.mkdirSync(path.dirname(path.join(OUT, f)), { recursive: true }); fs.writeFileSync(path.join(OUT, f), JSON.stringify(x, null, 1)); };
export const jsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

// ── the preregistered seeds (experiment file §Seeds) ──
export const SEED = Object.freeze({ draw: 78531, queue: 78532, wrongPage: 78533, planted: 78534, bootstrap: 7853 });
/** Arms (experiment file §Arms). `lite` is the stored text: the reference every refused arm falls back to. */
export const ARMS = Object.freeze(['lite', 'corr', 'gpu', 'read4', 'read1']);
export const ARM_NAMES = Object.freeze({ lite: 'stored Flash-Lite', corr: '1 lite>agy correction (#7558)', gpu: '2 GPU draft>agy correction (arm c)', read4: '3 fresh agy read, 4 a call', read1: '4 fresh agy read, 1 a call' });
/** Router route ids, as rules.json names them. */
export const ROUTES = Object.freeze({ lite: 'lite', corr: 'lite>agy-flash-low', gpu: 'gpu>agy-flash-low', read4: 'agy-flash-low@4-read', read1: 'agy-flash-low-read' });
/** Cheaper first: the tie order of the decision rule and of the write-back. */
export const COST_ORDER = Object.freeze(['read4', 'corr', 'read1', 'gpu']);
export const LANGS = Object.freeze({ de: /^German/, fr: /^French/ });
export const langOf = (language) => Object.entries(LANGS).find(([, re]) => re.test(String(language || '')))?.[0] ?? null;

/** Book year (as #7835 frame.mjs yearOf). */
export const yearOf = (b) => { const y = Number(b.year) || Number(/\b(1[4-9]\d\d)\b/.exec(String(b.published || ''))?.[1]); return Number.isFinite(y) && y > 1400 ? y : null; };
/** The century band of the strata (experiment file §Strata). */
export const centuryBand = (y) => (!y ? 'undated' : y <= 1600 ? '<=1600' : y <= 1700 ? '17th' : y <= 1800 ? '18th' : '19th+');
/** The scan band: a book is `good` when at least half its owed pages carry the stored read's <scan-quality>good. */
export const scanBand = (good, owed) => (owed && good / owed >= 0.5 ? 'good' : 'fair-poor');
/** GPU engine of arm 2 by the page's face tag (experiment file §Arms). */
export const gpuEngine = (face) => (face === 'antiqua' ? 'lightonocr' : 'pero');

/** Fetch an image once into OUT/img/<key>.jpg: the same bytes for the tagger, every arm and the judge. */
export async function imageFor(key, url) {
  const f = path.join(OUT, 'img', `${key}.jpg`);
  if (fs.existsSync(f)) return fs.readFileSync(f);
  let last = null;
  for (let a = 0; a < 2; a++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'SourceLibrary-eval/7853 (https://sourcelibrary.org)' } });
      if (!r.ok) { last = new Error(`image HTTP ${r.status} ${String(url).slice(0, 100)}`); continue; }
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length < 2000) { last = new Error(`image under 2 KB ${String(url).slice(0, 100)}`); continue; }
      fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, buf);
      return buf;
    } catch (e) { last = e; }
  }
  throw last;
}

/** Amendment 1 (Derek 2026-10-31): severity weights, MQM-style, of the judge's defect classes (#7824 measure). */
export const SEV = Object.freeze({ cosmetic: 1, misleads: 5, wrong_text: 25 });
function phi(z) { const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2); const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z / 2); return z >= 0 ? (1 + y) / 2 : (1 - y) / 2; }
/** Wilcoxon signed-rank, two-sided, zeros dropped, normal approximation (#7818 / #7835 analyze.mjs, unchanged). */
export function wilcoxon(d) {
  const nz = d.filter((x) => x !== 0), n = nz.length;
  if (n === 0) return { n: 0, w_plus: 0, z: 0, p: 1 };
  const abs = nz.map((x) => ({ a: Math.abs(x), s: Math.sign(x) })).sort((x, y) => x.a - y.a);
  let tie = 0;
  for (let i = 0; i < n;) { let j = i; while (j + 1 < n && abs[j + 1].a === abs[i].a) j++; const rk = (i + j + 2) / 2, t = j - i + 1; for (let k = i; k <= j; k++) abs[k].r = rk; tie += t ** 3 - t; i = j + 1; }
  const wp = abs.filter((x) => x.s > 0).reduce((a, x) => a + x.r, 0);
  const mu = n * (n + 1) / 4, v = n * (n + 1) * (2 * n + 1) / 24 - tie / 48;
  const z = v > 0 ? (wp - mu - 0.5 * Math.sign(wp - mu)) / Math.sqrt(v) : 0;
  return { n, w_plus: wp, z: +z.toFixed(3), p: +(2 * (1 - phi(Math.abs(z)))).toPrecision(3) };
}
