// PRIOR ART: scripts/eval/confidence-7866/lib.mjs (OUT/J/W helpers, routeOf, the 7866 frame) and regrade.mjs
// (gradeOf / bandOf / seriousSpans: imported, not copied). The book grade A-D and its unit count are #7952's
// confidence-7866/book-grades.mjs (open PR, not on main): restated below, unchanged, so the grade this model predicts is
// the one /quality would show. Searched scripts/eval/INDEX.md, EXPERIMENTS.md, `gh issue list --search "book grade
// prediction"` / "difficulty model": nothing predicts a book's judged grade from features.
/**
 * Shared pieces of #7263 book-grade-model (scripts/eval/experiments/2026-11-04-book-grade-model-prereg-7263.md).
 * Bulky output (texts, images, per-page features, predictions) lives in OUT = $JOB_SCRATCH/bgm and never in the repo
 * (Derek, 2026-11-04: per-page features and predictions stay on the box or in private R2).
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export { gradeOf as pageGradeOf, bandOf, seriousSpans } from '../confidence-7866/regrade.mjs';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '../../..');
export const RESULTS = path.join(HERE, 'results');
export const OUT = path.resolve(process.env.BGM_OUT || path.join(process.env.JOB_SCRATCH || os.tmpdir(), 'bgm'));
export const JOBS = '/mnt/HC_Volume_105839809/jobs';
export const SEVCAL = path.join(JOBS, 'severity-cal-7263/severity-cal-7263');
/** #7866's texts and images as judged, restored from R2 cold/l7a/leaf-screen-7866/confidence-7866-argon-inputs.tar.zst. */
export const C66 = path.join(OUT, '..', 'c66', 'confidence-7866');
export const EXPAND = path.join(JOBS, 'judged-expand-7263/judged-expand-7263');

export const J = (f) => { const p = path.isAbsolute(f) ? f : path.join(OUT, f); const b = fs.readFileSync(p); return JSON.parse(p.endsWith('.gz') ? zlib.gunzipSync(b).toString('utf8') : b.toString('utf8')); };
export const W = (f, x) => { const p = path.join(OUT, f); fs.mkdirSync(path.dirname(p), { recursive: true }); const s = JSON.stringify(x, null, 1); fs.writeFileSync(p, p.endsWith('.gz') ? zlib.gzipSync(s) : s); };
export const jsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
export const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
export const contentHash = (t) => sha256(t || '').slice(0, 16);

/** Seeds, fixed in the preregistration. */
export const SEED = Object.freeze({ lockbox: 'bgm-7263-lockbox-v1', folds: 72631, agy: 72632, bootstrap: 72633, bookSample: 72634 });

/** The lockbox: the 20% of label books with the lowest sha256(SEED.lockbox + book_id). Fixed before any feature work. */
export function lockboxOf(bookIds, share = 0.2) {
  const ranked = [...new Set(bookIds)].map((b) => [b, sha256(`${SEED.lockbox}:${b}`)]).sort((a, b) => (a[1] < b[1] ? -1 : 1));
  return new Set(ranked.slice(0, Math.round(ranked.length * share)).map(([b]) => b));
}

/* ── units and the book grade (#7952 book-grades.mjs, unchanged) ── */

const NONCONTENT = /<(meta|warning|vocab|image-desc|note|language|script|page-type|scan-quality|page-num|header)[^>]*>[\s\S]*?<\/\1>/g;
const CJK = /[\p{Script=Han}\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}]/gu;
/** Words on a page: whitespace tokens, except CJK (characters / 1.5) and Tibetan (one per tsheg or shad). */
export function words(text, lang) {
  const body = String(text || '').replace(NONCONTENT, ' ').replace(/<[^>]+>/g, ' ');
  if (/Chinese|Japanese|Korean/.test(lang)) return (body.match(CJK) || []).length / 1.5;
  if (/Tibetan/.test(lang)) return (body.match(/[་།]/g) || []).length;
  return body.split(/\s+/).filter(Boolean).length;
}
/** The unit a rate is counted in. Rates in different units never pool without this term in the model. */
export const unitOf = (lang) => (/Chinese|Japanese|Korean/.test(lang) ? 'cjk' : /Tibetan/.test(lang) ? 'tibetan' : 'alphabetic');
/** A at most 1 sense error per 1,000 words, B at most 5, C more; D any page fidelity <= 2. */
export function bookGradeOf(per1k, wrongPage) {
  if (wrongPage) return 'D';
  return per1k <= 1 ? 'A' : per1k <= 5 ? 'B' : 'C';
}
/** The primary binary book outcome: grade C or D. */
export const isBad = (g) => g === 'C' || g === 'D';
