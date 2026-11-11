// PRIOR ART: scripts/lib/ocr-routing.mjs ocrRouteForBook — the same cell lookup, but that module imports translate-core.mjs,
// whose chain the Next build cannot bundle (seam-repair scripts), so a route.ts cannot import it; scripts/lib/router-binding.mjs
// — checks a running lane against the router table, not one book's paid read. This holds the cell lookup for both.
import { toLanguageCodes, codeFamily } from './language-normalize.mjs';

/** The one Gemini model that may run OCR on the paid API at all (ocr-routing.mjs OCR_MODEL_LITE; a test pins the two equal). */
export const LITE_MODEL = 'gemini-3.1-flash-lite';

/** The router cell of a book's first language with a fresh read to give (a book's unread pages have nothing stored to correct). */
export const FIRST_READ_CELL = Object.freeze({
  lat: 'latin-blank', deu: 'german-blank', fra: 'french-blank', eng: 'english-blank-pre1800', ita: 'italian-lite', spa: 'spanish-lite',
  grc: 'greek-lite', san: 'sanskrit-lite', ara: 'arabic-lite', zho: 'zh-lite', kor: 'korean-lite', rus: 'russian-lite',
  por: 'portuguese-lite', dan: 'danish-lite', hin: 'hindi-lite', enm: 'middle-english-lite', gmh: 'mhg-lite', fro: 'old-french-lite',
  ota: 'ottoman-lite', tam: 'tamil-lite', tur: 'turkish-lite',
});

/**
 * THE FLASH-LITE GATE (#8519): may the paid Flash-Lite Batch lane read this book's pages?
 *
 * In the 7 days to 2026-11-11 the Batch API wrote ~15.8K Flash-Lite OCR pages (Latin, French, Italian, Spanish books:
 * *Acta sanctorum*, *Zend-Avesta* III, Galileo *Opere*), 6.3K of them after the orchestrator closed on 2026-11-06,
 * through src/app/api/books/[id]/batch-ocr-async (called with model: gemini-3.1-flash-lite by the submit scripts). Each
 * landed in a cell the router reads fresh with agy (latin-blank/print → pero>agy, french-blank/print → agy@4), so
 * every page became re-read work for the agy pool (latin-lite 835K pages waiting, #8519).
 *
 * Yes only when the book's first-read cell (the same lookup as ocrRouteForBook: FIRST_READ_CELL, then the script)
 * binds the route `lite` itself, a keep the evidence decided for Flash-Lite. A cell that binds anything else (agy,
 * Opus, a GPU draft, or a lite DRAFT a corrector then rewrites) is refused, and so is a book with no cell: an untested
 * cell gets agy, never the incumbent (rules.json menu). The book is left for the cell's bound lane.
 * Returns { ok, cell, route, why }.
 */
export function liteReadAllowed(book, table) {
  if (!table?.router_cells) throw new Error('liteReadAllowed: pass the routing table (ocr-routing-table.json)');
  const first = toLanguageCodes(book?.language).codes[0];
  const base = first ? FIRST_READ_CELL[first] ?? FIRST_READ_CELL[codeFamily(first)] : null;
  if (!base) return { ok: false, cell: null, route: null, why: `no router cell for language "${book?.language ?? ''}": an untested cell gets agy (#8519)` };
  const scripts = book?.script_type === 'handwritten' ? ['manuscript'] : book?.script_type === 'printed' ? ['print'] : ['unknown', 'print'];
  for (const script of scripts) {
    const row = table.router_cells?.find((r) => r.cell === `${base}/${script}`);
    if (!row) continue;
    return row.route === 'lite'
      ? { ok: true, cell: row.cell, route: row.route, why: `router cell ${row.cell} binds lite (${row.decision})` }
      : { ok: false, cell: row.cell, route: row.route, why: `router cell ${row.cell} binds ${row.route}, not Flash-Lite: the book waits for that lane (#8519)` };
  }
  return { ok: false, cell: null, route: null, why: `no router cell ${base}/${scripts.join('|')}: an untested cell gets agy (#8519)` };
}

/**
 * The lane and pipeline stamps for a page a Batch OCR job writes (#8519): `ocr.lane` is the channel (the paid Gemini
 * Batch API), `ocr.pipeline` the submitter that chose the pages, read off the job. Before this the Batch writes carried
 * neither, so a reader of `ocr.pipeline` (cli-ocr-lane.mjs: "not already re-read") could not tell them apart, and a
 * Batch write over a page an agy lane had stamped kept the agy lane's label on Flash-Lite text.
 */
export const BATCH_OCR_LANE = 'gemini-batch-api';
const BATCH_SUBMITTERS = Object.freeze({
  'scripts/workers/pipeline-orchestrator.mjs': 'orchestrator-ocr',
  'src/app/api/books/[id]/batch-ocr-async/route.ts': 'api-batch-ocr-async',
  'src/app/api/[tenant]/books/[id]/batch-ocr-async/route.ts': 'api-tenant-batch-ocr-async',
});
export function batchOcrStamps(job) {
  const by = job?.submitted_by || job?.provenance?.call_site || '';
  const pipeline = job?.ocr_source === 'pipeline_preview' ? 'orchestrator-preview-ocr'
    : BATCH_SUBMITTERS[by] || (by ? by.split('/').pop().replace(/\.(m?js|ts)$/, '') : 'batch-unknown-submitter');
  return { 'ocr.lane': BATCH_OCR_LANE, 'ocr.pipeline': pipeline };
}


/**
 * For scripts that POST to the batch routes (src/app/api/books/[id]/batch-{ocr,translate}-async). The routes
 * refuse every model but LITE_MODEL (#8525, #8548), but a script that sends no model, or a hardcoded Flash, used to
 * get the route's own default: on 2026-11-06 that put 1,879 pages on gemini-3-flash-preview on the paid API. A
 * submitter names its model and fails here first, before any request.
 */
export function assertBatchRouteModel(model, callSite = 'unknown') {
  if (model !== LITE_MODEL) {
    throw new Error(`${callSite}: refusing to submit ${model ?? '(no model)'} to a paid batch route. Only ${LITE_MODEL} runs on the paid Gemini API; `
      + 'every other model goes through the agy CLI lane.');
  }
  return model;
}

/**
 * Who is calling, for the route to record on the batch job (`requested_by.caller`): script, the claude-job name
 * when there is one, and the OS user. (No node:os here: this module must stay bundleable by the Next routes.) Without it a job reads only "submitted by the route" (2026-11-11).
 */
export function batchRouteCallerHeaders(callSite) {
  return { 'x-caller': [callSite, process.env.JOB_NAME || '', process.env.USER || ''].join(' ').trim().slice(0, 200) };
}
/**
 * THE PAID-API MODEL GATE for TRANSLATION (#7075, Derek 2026-10-08): the only Gemini model that may run on the paid
 * Gemini API is `gemini-3.1-flash-lite`; every other model reads through the agy CLI on the subscriptions. OCR enforces
 * it since #8525 (batch-ocr-async: ocr_model_not_on_api). Translation did not: three `channel: batch` rows of
 * translation-routing-table.json name gemini-3-flash-preview (bph, tibetan, flash-measured), and pages were written
 * with it on the paid API on 2026-11-06, 11-07 and 11-10. Every paid translation door asks this before it spends.
 * A `cli` channel (subscription reader) is never the paid API, so it always passes. The routing-table rows are NOT
 * changed here (that needs routing evidence, #8283): the guard makes those books wait for the CLI lane
 * (scripts/batch/cli-translate-lane.mjs). A refused door never falls back to another paid model.
 */
export const TRANSLATE_NOT_ON_API = 'translate_model_not_on_api';
export function paidApiModelAllowed(model, channel = 'api') {
  return channel === 'cli' || model === LITE_MODEL;
}
/** null when the model may run on the paid API, else { error, message } for a 4xx body or a recorded skip reason. */
export function translateModelRefusal(model, channel = 'api') {
  if (paidApiModelAllowed(model, channel)) return null;
  return {
    error: TRANSLATE_NOT_ON_API,
    message: `Only ${LITE_MODEL} may run translation on the paid Gemini API (#7075); ${model} translates through the agy CLI lane (scripts/batch/cli-translate-lane.mjs), so this book waits for it.`,
  };
}

