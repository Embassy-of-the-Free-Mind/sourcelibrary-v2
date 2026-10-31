// PRIOR ART: scripts/eval/fraktur-paired-7835/lib.mjs and scripts/eval/correction-pass-7818/lib.mjs (OUT/J/W/jsonl,
// imageFor, judgeAbsolute = route-judge-6740 judgePrompt + opusCall + parseVerdict, paceCheck; imported, not copied),
// scripts/lib/router-binding.mjs loadCurrentTable (the live router table), scripts/batch/cli-ocr-lane.mjs (the lane
// stamps: LITE_MODELS, CORRECT_LANE, FIRST_READ_LANE ...), scripts/eval/lane-judge-sampler.mjs (FIRST_READ_CELLS,
// the routes a first-read page is credited to). None of them maps a STORED book to the router cell and route it was
// served by; routeOf() below does, by the same stamps the sampler reads. Searched scripts/eval/INDEX.md,
// `gh issue list --search "confidence score book"`: no book-level confidence score existed (#7866).
/**
 * Shared pieces of #7866 (scripts/eval/experiments/2026-10-31-confidence-validation-7866.md): the page → (cell, route)
 * map, the confidence score, the strata. Bulky output lives in OUT ($JOB_SCRATCH/confidence-7866, or --out).
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { loadCurrentTable } from '../../lib/router-binding.mjs';

export { mulberry32, shuffle, makeRng, sha, judgeAbsolute, paceCheck, imageFor, wrongText } from '../correction-pass-7818/lib.mjs';
export { words } from '../route-judge-6740/defect-rate.mjs';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '../../..');
export const RESULTS = path.join(HERE, 'results');
export const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
export const flag = (n) => process.argv.includes(`--${n}`);
export const OUT = path.resolve(arg('out') || path.join(process.env.JOB_SCRATCH || os.tmpdir(), 'confidence-7866'));
export const J = (f) => { const p = path.join(OUT, f); const b = fs.readFileSync(p); return JSON.parse(p.endsWith('.gz') ? zlib.gunzipSync(b).toString('utf8') : b.toString('utf8')); };
export const W = (f, x) => { const p = path.join(OUT, f); fs.mkdirSync(path.dirname(p), { recursive: true }); const s = JSON.stringify(x, null, 1); fs.writeFileSync(p, p.endsWith('.gz') ? zlib.gzipSync(s) : s); };
export const jsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

/** Seeds, fixed in the preregistration. */
export const SEED = Object.freeze({ draw: 78661, pages: 78662, queue: 78663, wrongPage: 78664, planted: 78665, bootstrap: 78666, revSample: 78667, geminiQueue: 78668 });
/** The frame: live books with OCR (the public API's live filter, plus at least one OCR'd page). */
export const FRAME = Object.freeze({ visible: true, pages_count: { $gt: 0 }, pages_ocr: { $gt: 0 } });

// ── page → (cell, route) ──
export const LITE_MODELS = ['gemini-3.1-flash-lite', 'gemini-3.1-flash-lite-preview'];
export const FLASH3_MODELS = ['gemini-3-flash-preview'];
/** Book language → the router's cell prefix (rules.json). Languages without a prefix have no cell. */
export function cellLang(lang) {
  const l = String(lang || '');
  const m = [[/^Latin/, 'latin'], [/^German/, 'german'], [/^French/, 'french'], [/^Italian/, 'italian'], [/^Spanish/, 'spanish'],
    [/^Greek|^Ancient Greek/, 'greek'], [/^Hebrew/, 'hebrew'], [/^Arabic/, 'arabic'], [/^Sanskrit/, 'sanskrit'], [/^Korean/, 'korean'],
    [/^Russian/, 'russian'], [/^Portuguese/, 'portuguese'], [/^Danish/, 'danish'], [/^Hindi/, 'hindi'], [/^Middle English/, 'middle-english'],
    [/^Middle High German/, 'mhg'], [/^Old French/, 'old-french'], [/^Ottoman/, 'ottoman'], [/^Tamil/, 'tamil'], [/^Turkish/, 'turkish'],
    [/^(Classical )?Chinese/, 'chinese'], [/^Tibetan/, 'tibetan'], [/^English/, 'english']];
  return m.find(([re]) => re.test(l))?.[1] ?? null;
}
export const scriptOf = (st) => ({ printed: 'print', handwritten: 'manuscript' }[st] ?? 'unknown');

/**
 * The router cell and route a stored page was served by, from its own stamps (model, ocr.pipeline, source, call
 * pages). null cell = no router cell exists for this provenance (an IA/e-text import, an engine the router never
 * tested). The cell id gets the page's script suffix; if the table has no such row, the page is unmeasured.
 */
export function routeOf({ model, pipeline, source, at4 }, lang) {
  const L = cellLang(lang);
  if (['ia_djvu', 'corpus', 'wikisource', 'manual', 'volunteer-correction'].includes(source) || /^ia-ocr/.test(model || '')) return { base: null, route: `import:${source || model}` };
  if (pipeline === 'agy-correct-lite-7558') return { base: L && `${L === 'chinese' ? 'zh' : L}-lite`, route: 'lite>agy-flash-low' };
  if (pipeline === 'agy-opus-correct-lite-7545' || pipeline === 'fl-opus-correct-6865') return { base: L && `${L}-lite`, route: 'lite>opus' };
  if (pipeline === 'gpu-agy-correct-lite-7567') return { base: L && `${L}-lite`, route: L === 'italian' ? 'lighton>agy-flash-low' : 'pero>agy-flash-low' };
  if (pipeline === 'pero-agy-flash-low-7263') return { base: 'latin-gpu-7263', route: 'pero>agy-flash-low' };
  if (pipeline === 'pero-agy-first-read-7701') return { base: 'latin-blank', route: 'pero>agy-flash-low-written' };
  if (pipeline === 'agy-first-read-7701') return { base: L && `${L}-blank`, route: L === 'french' && !at4 ? 'agy-flash-low-written' : 'agy-flash-low@4-written' };
  if (pipeline === 'agy-first-read-correct-7701') return { base: L && `${L}-blank`, route: L === 'french' ? 'agy-flash-low>agy-flash-low-written' : 'agy-flash-low@4>agy-flash-low-written' };
  if (pipeline === 'reocr_bdrc_4523' && /yigdzin/.test(model || '')) return { base: 'tibetan-yigdzin', route: 'yigdzin' };
  if (pipeline === 'tib-correct-6560') return { base: 'tibetan-yigdzin', route: 'yigdzin>agy-flash-low' };
  if (pipeline === 'paddle-zh-guarded-2026-10' && /flash-low/.test(model || '')) return { base: 'zh-frame-6871', route: 'paddle>agy-flash-low' };
  if (/^paddle-zh/.test(pipeline || '')) return { base: 'zh-paddle-dice-lt090', route: 'paddle' };
  if (pipeline === 'paddle-print-2026-10') return { base: 'zh-6561-served', route: 'paddle' };
  if (pipeline === 'gpu-print-en-2026-10') return { base: 'english-blank-pre1800', route: 'lighton-written' };
  if (pipeline) return { base: null, route: `pipeline:${pipeline}` };
  if (LITE_MODELS.includes(model)) return { base: L && `${L === 'chinese' ? 'zh' : L}-lite`, route: 'lite' };
  if (FLASH3_MODELS.includes(model)) return { base: L && `${L}-flash3`, route: '3flash' };
  if (model === 'gemini-3.8-flash-low') return { base: L && `${L === 'chinese' ? 'zh' : L}-lite`, route: 'agy-flash-low-read' };
  return { base: null, route: `model:${model ?? 'none'}` };
}

/** The live router table (current.json's pointer), and a lookup: (cell id, route) → measured posterior or null. */
export function routerLookup() {
  const t = loadCurrentTable();
  const tableScript = (base, script) => t.rows.get(`${base}/${script}`) ?? (script === 'unknown' ? null : null);
  return {
    name: t.name,
    get(base, script, route) {
      if (!base) return { cell: null, measured: false, why: 'no cell for this provenance' };
      // The Tibetan unknown/print split: the table's Yigdzin rows are print / manuscript / unknown like the others.
      const row = tableScript(base, script);
      if (!row) return { cell: `${base}/${script}`, measured: false, why: 'cell not in the table' };
      const r = row.routes.find((x) => x.id === route);
      const decision = String(row.decision || '');
      if (!r || !(r.n >= MIN_ROUTE_N)) return { cell: row.id, decision, measured: false, why: r ? `route n=${r.n ?? 0} < ${MIN_ROUTE_N}` : 'route not in the cell', k: r?.k ?? null, n: r?.n ?? null };
      return { cell: row.id, decision, measured: true, k: r.k, n: r.n, mean: r.mean, wrate: r.wrate ?? null, decided: row.route, served_is_decided: row.route === route,
        wrong_text_per_1k: r.defects?.wrong_text_per_1k ?? null, misleads_per_1k: r.defects?.misleads_per_1k ?? null, cosmetic_per_1k: r.defects?.cosmetic_per_1k ?? null };
    },
  };
}
/** A route counts as measured in its cell from this many judged pages (the table's own HOLD floor is 10 a route). */
export const MIN_ROUTE_N = 10;

// ── the confidence score (preregistered) ──
/** Page flags that enter the score: each is a stored signal that the page's text is suspect. */
export const SCORE_FLAGS = ['warn', 'sq_poor', 'chatter', 'near_empty', 'withheld', 'needs_reocr', 'unreadable', 'verdict_bad'];
/**
 * confidence = p_route × (1 − flag_share), over the book's OCR'd pages:
 *  p_route    the page-weighted mean, over the routes that served the book, of the router posterior acceptance (`mean`);
 *             only pages on a measured route enter it;
 *  flag_share the share of the book's OCR'd pages carrying any SCORE_FLAG.
 * A book is UNMEASURED when fewer than half of its OCR'd pages sit on a measured route; it gets no score.
 */
export function confidence(b) {
  const measuredPages = b.routes.filter((r) => r.measured).reduce((s, r) => s + r.n_pages, 0);
  const share = b.n_ocr ? measuredPages / b.n_ocr : 0;
  if (share < 0.5) return { measured: false, measured_share: +share.toFixed(3), p_route: null, flag_share: +(b.n_flagged / Math.max(1, b.n_ocr)).toFixed(4), score: null };
  const p = b.routes.filter((r) => r.measured).reduce((s, r) => s + r.mean * r.n_pages, 0) / measuredPages;
  const f = b.n_flagged / Math.max(1, b.n_ocr);
  return { measured: true, measured_share: +share.toFixed(3), p_route: +p.toFixed(4), flag_share: +f.toFixed(4), score: +(p * (1 - f)).toFixed(4) };
}
/** Strata: unmeasured, else by the cut points (fixed in the preregistration from the frame's measured books' terciles). */
export const stratumOf = (c, cuts) => (!c.measured ? 'unmeasured' : c.score >= cuts.high ? 'high' : c.score < cuts.low ? 'low' : 'middle');
export const ALLOC = Object.freeze({ high: 30, middle: 30, low: 50, unmeasured: 50 });

// ── the page draw ──
/** Page types that are blanks, plates or front matter (skipped by the draw). */
export const SKIP_TYPES = ['blank', 'illustration', 'frontispiece', 'map', 'diagram', 'plate', 'title-page', 'toc', 'dedication', 'preface', 'digitizer-insert', 'archived-spread', 'colophon', 'cover'];
const TAG_TYPE = /<page-type>\s*([a-z-]+)\s*<\/page-type>/i;
export function eligiblePage(p) {
  if (!p.ocr || typeof p.ocr.data !== 'string') return false;
  if (SKIP_TYPES.includes(p.page_type)) return false;
  const tag = p.ocr.data.match(TAG_TYPE)?.[1]?.toLowerCase();
  if (tag && SKIP_TYPES.includes(tag)) return false;
  if (p.hidden || p.split_into) return false;
  return Boolean(p.archived_photo || p.display_photo || p.photo);
}
export const imageUrl = (p) => p.archived_photo || p.display_photo || p.photo;
