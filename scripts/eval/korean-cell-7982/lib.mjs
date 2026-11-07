// PRIOR ART: scripts/eval/confidence-7866/lib.mjs (OUT/J/W, seeds, judgeAbsolute re-export; this file imports it and
// adds only what is Korean: the script-mix and form strata). scripts/lib/script-detect* was searched: it names a
// page's dominant script, not the hangul share of a CJK text, which is what separates hanja-only from mixed books.
/** Shared pieces of #7982 (scripts/eval/experiments/2026-11-03-korean-ocr-cell-7982.md). */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const RESULTS = path.join(HERE, 'results');
export const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
export const OUT = path.resolve(arg('out') || path.join(process.env.JOB_SCRATCH || os.tmpdir(), 'kc-7982'));
export const J = (f) => { const p = path.join(OUT, f); const b = fs.readFileSync(p); return JSON.parse(p.endsWith('.gz') ? zlib.gunzipSync(b).toString('utf8') : b.toString('utf8')); };
export const W = (f, x) => { const p = path.join(OUT, f); fs.mkdirSync(path.dirname(p), { recursive: true }); const s = JSON.stringify(x, null, 1); fs.writeFileSync(p, p.endsWith('.gz') ? zlib.gzipSync(s) : s); };
export const jsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

/** Seeds, fixed in the preregistration. */
export const SEED = Object.freeze({ draw: 79821, page: 79822, queue: 79823, wrongPage: 79824, planted: 79825, bootstrap: 79826 });

/** Hangul syllables + jamo, and CJK ideographs (unified + ext A + compatibility). */
const HANG = /[ᄀ-ᇿ㄰-㆏가-힯]/gu;
const HAN = /[㐀-䶿一-鿿豈-﫿]/gu;
export const scriptCounts = (t) => ({ hang: (t.match(HANG) || []).length, han: (t.match(HAN) || []).length });
/** Script mix of a book from its stored reads: hangul share of hangul + hanja characters (prereg §Strata). */
export function mixOf({ hang, han }) {
  const n = hang + han;
  if (n < 50) return 'unknown';
  const s = hang / n;
  return s < 0.05 ? 'hanja' : s > 0.5 ? 'hangul' : 'mixed';
}
/** Form from the stored reads' own <script> tag (script_type): manuscript when handwritten is the majority. */
export function formOf(st) {
  const hw = (st.handwritten ?? 0) + (st.mixed ?? 0), pr = st.printed ?? 0;
  if (hw + pr === 0) return 'unknown';
  return hw > pr ? 'manuscript' : 'print';
}
export const stratumOf = (r) => `${r.mix}/${r.form}`;

/** n and the allocation over strata (prereg §Draw; set from the census before any read). */
export const N_PAGES = 30;
// 2026-11-03 census: hanja 237 books / 50,948 eligible pages, hangul 19 / 1,851, mixed 6 / 180 (manuscript only). PPS alone
// would give hangul and mixed one page between them, so they are floored at 2-4 and the hanja strata take the rest;
// every rate over the cell is Horvitz-Thompson weighted back to eligible pages (w in draw.json).
export const ALLOC = Object.freeze({ 'hanja/print': 11, 'hanja/manuscript': 11, 'hangul/manuscript': 4, 'hangul/print': 2, 'mixed/manuscript': 2 });
