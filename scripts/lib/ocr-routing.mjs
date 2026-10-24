/**
 * PRIOR ART: scripts/lib/translate-core.mjs — held the same policy for the
 * TRANSLATION phase (getTranslateModelForBook) until the two split in #4759, and
 * is documented as "the one door" for translation writes. It does not cover OCR, and the OCR side had
 * grown two private copies of the allowlist instead
 * (scripts/workers/pipeline-orchestrator.mjs, scripts/migration/backfill-ocr-near-complete.mjs),
 * neither importable by a test because the orchestrator runs `run()` on import.
 * This module is the importable OCR-side door those copies now share.
 *
 * ocr-routing — which Gemini model OCRs a given book.
 *
 * There were three live copies of this policy (TS for API routes/Lambda, the
 * orchestrator's private copy, a migration script's private copy) and the
 * parity test could only see two of them. The unwatched pair drifted: both
 * carried `malay`/`ms`/`msa`, which the canonical list excludes on purpose,
 * so Malay books were OCR'd on lite (wrong) and translated on flash (right).
 *
 * So this module does not keep an allowlist of its own: it imports the
 * canonical one from translate-core.mjs. OCR and translation are the same
 * question — "can flash-lite read this script?" — and a second list is a
 * second thing to forget. If OCR ever needs to diverge from translation,
 * that is a deliberate change and the parity test below must say so.
 *
 * Parity across every remaining implementation is pinned by
 * tests/unit/translate-core-parity.test.ts.
 */

import { createRequire } from 'node:module';
import { LATIN_SCRIPT_LANGUAGES, MODEL_FLASH, MODEL_LITE } from './translate-core.mjs';
import { toLanguageCodes, codeFamily } from './language-normalize.mjs';

// Re-exported under OCR-phase names so call sites read honestly. There is one
// pair of models, not two — these ARE translate-core's constants.
export const OCR_MODEL_FLASH = MODEL_FLASH;
export const OCR_MODEL_LITE = MODEL_LITE;

/**
 * OCR_LITE_ONLY — the deliberate divergence the header comment reserves.
 *
 * Derek, 2026-09-11: "OCR should only be flash-lite batch, in the meantime."
 * The August usage log showed the OCR lane dominated by gemini-3-flash-preview
 * rows (BPH, non-Latin/unknown language, and recitation tier 2 all route there)
 * at ~2x the input price, while the spend dial is $5/day. Until the dial is
 * raised, every batch OCR submission uses flash-lite, and the recitation ladder
 * skips its flash-preview tier (tier 3, MinerU, is not a Gemini model and is
 * unaffected). Translation routing is untouched — this is OCR only.
 *
 * Default ON. Set OCR_LITE_ONLY=0 in the orchestrator's environment (Hetzner
 * crontab / .env) to restore script-aware routing without a deploy.
 * tests/unit/translate-core-parity.test.ts pins both behaviours.
 */
export const OCR_LITE_ONLY = process.env.OCR_LITE_ONLY !== '0';

/**
 * The first exception to OCR_LITE_ONLY: Greek reads on flash (#5575). FLASH_OCR_FROM below
 * extends it to Persian, Sanskrit, Pali, Arabic and Ge'ez (2026-10-04).
 *
 * Derek, 2026-10-02, on the DECISIONS-PENDING row "Read Greek and Chinese OCR
 * with Flash again (Batch)": yes for new pages and for the visible and held
 * Greek backlog; NOT for the hidden Greek backlog (~1.8M pp), which waits for
 * #4884 because many books catalogued Greek are Latin on the page. Chinese was
 * taken out of scope the same day, pending PaddleOCR-VL vs Flash on non-Siku
 * Quanshu pages (#5574) — do not add it here without that comparison.
 * Evidence: Greek median CER 6.6% on flash vs 11% on lite, 176 referenced
 * books; cost basis on #5575 (~2x per page on Batch).
 *
 * The test reads only fields the router already reads or that every book row
 * carries — no new field:
 * - the FIRST language of `books.language` is in the Greek family, read through
 *   the pinned normaliser's closed vocabulary (toLanguageCodes / codeFamily,
 *   the code API `routing_lane` will use): "Greek", "grc", "Byzantine Greek",
 *   "Modern Greek" and "Greek, Latin" qualify; "Latin, Greek" (a Latin book
 *   with Greek in it) and "Judeo-Greek" (Hebrew script) do not;
 * - and the book is visible, or was created on or after the decision date
 *   ("new pages"). A HIDDEN book created before it is the unapproved backlog
 *   and stays on lite. Held books keep their hold (no worker selects them); a
 *   visible held book reads on flash when it is released.
 *
 * A caller that does not project `visible` and `created_at` falls back to lite:
 * the cheap direction. Every projection that feeds getOcrModelForBook carries
 * `language`, `image_source.provider`, `visible` and `created_at`.
 */
export const GREEK_FLASH_FROM = new Date('2026-10-02T00:00:00Z');

/**
 * The same exception, extended to the scripts where lite OCR is measured to hurt the
 * English (#5700 A5, job reocr-lift-5700, PR #5760; routing doc
 * .claude/docs/ocr-engine-routing.md). A flash re-read of a lite-read page lifted judged
 * translation fidelity by Persian +1.00, Sanskrit +0.75, Pali +0.58, Arabic +0.39 (1–5
 * scale, against published translations). Ge'ez failed the #4729 agreement bar
 * (0.47, 9/20 catastrophic). The scope is the same as Greek: visible books, and books
 * created on or after the decision. The hidden backlog of these scripts (~300K pages)
 * is a separate spend decision.
 *
 * Chinese (`zho`, which folds Classical Chinese) joined on 2026-10-21 (#7075): #6101 measured
 * Gemini 3 Flash best on Chinese print against CBETA, median CER 5.2% with 0 of 198 pages
 * catastrophic, against lite's 3 of 198 and PaddleOCR-VL failing about one woodblock spread in
 * seven; Derek routed the #7037 woodblock books to it on 2026-10-20. Chinese MANUSCRIPT stays
 * as the decision tree says: the Paddle cost lane is adopted but has no writer (#4743), so until
 * it does, flash; the books held for the Paddle lane keep their hold, and a hold wins over this
 * router. Same scope as the others: visible books and books created from the date.
 *
 * Deliberately NOT here: Tibetan
 * and Syriac (own lanes; Gemini is not their reader), Japanese (NDL lane for cursive;
 * typeset unmeasured), Hebrew and everything unmeasured. Add a family only with a
 * measured cell, and cite it.
 *
 * THE CHANNEL (#7075). Since 2026-10-08 the only Gemini model that runs on the paid API is
 * gemini-3.1-flash-lite (Derek; DECIDED 2026-10-10 "Only via the CLI lane, no API"). A book this
 * function picks therefore does NOT go to the Batch API: `ocrLaneForBook` below sends it to the
 * agy CLI lane, and when that lane has no quota the book waits.
 *
 * Keyed by language FAMILY (codeFamily of the first language), so "Judeo-Arabic"
 * (Hebrew script, family jrb) and "Latin, Arabic" do not qualify.
 *
 * READ FROM THE TABLE (#7170). The families and dates live in the `route` field of the rows of
 * ocr-routing-table.json (greek-print, persian-sanskrit-pali-arabic-print, chinese-print), so a
 * routing change proposed by the estimators (scripts/eval/estimator/routing/derive_routes.py) is a
 * reviewed edit of that one file. The constants below are the pinned FALLBACK, used only when the
 * table carries no family route at all; a malformed route throws at import, so a bad edit fails
 * the tests rather than quietly routing to lite.
 */
export const FLASH_OCR_FROM_FALLBACK = Object.freeze({
  grc: GREEK_FLASH_FROM,
  fas: new Date('2026-10-04T00:00:00Z'),
  san: new Date('2026-10-04T00:00:00Z'),
  pli: new Date('2026-10-04T00:00:00Z'),
  ara: new Date('2026-10-04T00:00:00Z'),
  gez: new Date('2026-10-04T00:00:00Z'),
  zho: new Date('2026-10-21T00:00:00Z'),
});

/**
 * Families whose HIDDEN backlog also reads on flash. Persian only (Derek 2026-10-04, after #5795):
 * labels held on 93% of hidden pages and flash read 9 of the 10 hardest pages to lite's 0, with
 * nothing invented. It missed the preregistered rule by one looping flash page in 30; a loop is
 * refused at write time by the collector's loop guard (ocr-loop-guard.mjs), so it is not served.
 * Sanskrit, Arabic and Pali failed on labels or legibility and wait for #4884 / better scans.
 * In the table: `hidden: true` on the family.
 */
export const FLASH_OCR_INCLUDES_HIDDEN_FALLBACK = Object.freeze(new Set(['fas']));

/**
 * The flash families a routing table declares: { from: {family: Date}, hidden: Set }, or the
 * fallback when no row of `table` has a family route. Only routes to OCR_MODEL_FLASH count: this
 * router has two models, and a row naming any other engine is a lane of its own (or a proposal
 * nobody has built), so it throws rather than being read as flash.
 */
export function flashFamiliesFromTable(table, fallback = { from: FLASH_OCR_FROM_FALLBACK, hidden: FLASH_OCR_INCLUDES_HIDDEN_FALLBACK }) {
  const from = {};
  const hidden = new Set();
  for (const row of table?.rows ?? []) {
    const fams = row.route?.families;
    if (!fams) continue;
    if (row.route.engine !== OCR_MODEL_FLASH) {
      throw new Error(`ocr-routing-table: row ${row.id} routes families to ${row.route.engine}; getOcrModelForBook can only route them to ${OCR_MODEL_FLASH}`);
    }
    for (const [family, spec] of Object.entries(fams)) {
      const date = new Date(`${spec?.from}T00:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(spec?.from ?? '') || Number.isNaN(date.getTime())) throw new Error(`ocr-routing-table: row ${row.id} family ${family}: bad date ${spec?.from}`);
      if (from[family]) throw new Error(`ocr-routing-table: family ${family} is routed by two rows`);
      from[family] = date;
      if (spec.hidden === true) hidden.add(family);
    }
  }
  if (!Object.keys(from).length) return fallback;
  return { from: Object.freeze(from), hidden: Object.freeze(hidden) };
}

const TABLE_FLASH = flashFamiliesFromTable(createRequire(import.meta.url)('./ocr-routing-table.json'));
export const FLASH_OCR_FROM = TABLE_FLASH.from;
export const FLASH_OCR_INCLUDES_HIDDEN = TABLE_FLASH.hidden;

export function isFlashOcrBook(book) {
  const first = toLanguageCodes(book?.language).codes[0];
  const family = first ? codeFamily(first) : undefined;
  const from = family ? FLASH_OCR_FROM[family] : undefined;
  if (!from) return false;
  if (book?.visible === true || FLASH_OCR_INCLUDES_HIDDEN.has(family)) return true;
  const created = book?.created_at ? new Date(book.created_at) : null;
  return !!created && !Number.isNaN(created.getTime()) && created >= from;
}

/** Greek alone — kept for the #5575 call sites and tests. */
export function isGreekFlashOcrBook(book) {
  const first = toLanguageCodes(book?.language).codes[0];
  return !!first && codeFamily(first) === 'grc' && isFlashOcrBook(book);
}

/** Model for the recitation escalation tier that used to be flash-preview. */
export function ocrEscalationModel() {
  return OCR_LITE_ONLY ? OCR_MODEL_LITE : OCR_MODEL_FLASH;
}

/**
 * THE model routing for OCR. Mirrors getModelForBook in
 * src/lib/types/ai-models.ts — except under OCR_LITE_ONLY (above), when every
 * book routes to flash-lite except the measured scripts in FLASH_OCR_FROM (isFlashOcrBook).
 *
 * It does NOT mirror translation routing any more. Since #4759,
 * getTranslateModelForBook (translate-core.mjs) sends non-Latin scripts to
 * flash-lite too: the hallucination evidence behind the carve-out below is
 * about reading IMAGES (vision), and translation reads text. The two policies
 * diverge on purpose — do not re-sync them in either direction without new
 * evidence. tests/unit/translate-core-parity.test.ts pins the split.
 *
 * - BPH books: full flash (high-quality manuscripts)
 * - Non-Latin scripts: full flash (flash-lite hallucinates when visual decoding is hard, #1726)
 * - Latin-script European languages: flash-lite (50% cheaper)
 * - Unknown/null language: full flash (safer default)
 */
export function getOcrModelForBook(book, { liteOnly = OCR_LITE_ONLY } = {}) {
  if (liteOnly) return isFlashOcrBook(book) ? OCR_MODEL_FLASH : OCR_MODEL_LITE;
  if (book?.image_source?.provider === 'bph') return OCR_MODEL_FLASH;
  const lang = (book?.language || '').toLowerCase().trim();
  if (!lang || !LATIN_SCRIPT_LANGUAGES.has(lang)) return OCR_MODEL_FLASH;
  return OCR_MODEL_LITE;
}

/**
 * THE CHANNEL RULE (#7075): the model fixes the channel.
 *
 *   gemini-3.1-flash-lite   paid Gemini API (Batch by default)
 *   any other Gemini model  the agy CLI on the subscription (scripts/batch/cli-ocr.mjs), never the API
 *   Claude                  `claude -p` on the subscription, never via agy
 *
 * Derek, 2026-10-08: "the only Gemini model that may run on the paid API without asking is
 * gemini-3.1-flash-lite"; DECIDED 2026-10-10 for Flash OCR: "Only via the CLI lane, no API". Before
 * this, the orchestrator sent every book getOcrModelForBook answered flash for to the Batch API on
 * gemini-3-flash-preview: 502 jobs, 4,106 pages, $10.50 between 2026-10-08 and 2026-10-21 (#7075).
 *
 * When the CLI lane has no quota the book WAITS. Nothing here falls through to the API.
 */
export const API_OCR_MODELS = Object.freeze(new Set([OCR_MODEL_LITE]));

/** May this model be sent to the paid Gemini API (Batch or realtime) for OCR? */
export function isApiOcrModel(model) {
  return API_OCR_MODELS.has(model);
}

/**
 * Throw before any paid-API OCR submission whose model is not flash-lite. Every OCR submitter in
 * scripts/ calls it at the point of submission; tests/unit/ocr-api-channel-guard.test.ts checks
 * that they do.
 */
export function assertApiOcrModel(model, callSite = 'unknown') {
  if (!isApiOcrModel(model)) {
    throw new Error(`${callSite}: refusing to send ${model} to the paid Gemini API for OCR. Only ${[...API_OCR_MODELS].join(', ')} runs on the API (#7075); `
      + 'every other Gemini model reads through the agy CLI lane (scripts/batch/cli-ocr.mjs).');
  }
  return model;
}

/**
 * The pipeline hold that queues a book for the CLI Flash lane (#7075). It is the mechanism the
 * #7037 Chinese woodblock books used by hand (`zh-flash-agy-7037`): a held book is out of every
 * lane (scripts/lib/pipeline-hold.mjs), so it cannot fall back to an API read while it waits, and
 * the CLI run finds its books by this reason. The run reads the unread pages
 * (`cli-ocr.mjs read --page-ids-file=…` then `apply`), then releases the book to the status it was
 * held at; Phase 2 then finds nothing left to read and advances it.
 */
export const CLI_FLASH_OCR_HOLD = Object.freeze({
  reason: 'ocr-flash-cli-7075',
  issue: 7075,
  release: 'the agy CLI lane (scripts/batch/cli-ocr.mjs read + apply, Gemini 3 Flash on the subscription) has read the unread pages; release with scripts/maintenance/hold-pipeline-books.mjs --release-held --reason ocr-flash-cli-7075 --book <id> --apply',
});

/**
 * Which channel reads this book, and with which model.
 *   { channel: 'api', model: flash-lite }       the paid Batch API
 *   { channel: 'cli', model: <the routed one> } the agy CLI lane; the book waits for it
 * isFlashOcrBook (through getOcrModelForBook) stays the decision; this only names the channel.
 */
export function ocrLaneForBook(book, opts) {
  const model = getOcrModelForBook(book, opts);
  return { channel: isApiOcrModel(model) ? 'api' : 'cli', model };
}

/** The model to send to the paid API for this book, or null when the book belongs to the CLI lane. */
export function apiOcrModelForBook(book, opts) {
  const lane = ocrLaneForBook(book, opts);
  return lane.channel === 'api' ? lane.model : null;
}

/**
 * The routing table by PAGE KIND (#6688): which reader reads which kind of page, why, and the
 * experiment behind it. One lookup for a session about to OCR a book, and the source of the
 * "Who reads which page" section on /quality. The rows live in ocr-routing-table.json beside this
 * file and nowhere else: the table in scripts/eval/ocr-routing/README.md is generated from it
 * (scripts/eval/build-routing-table.mjs) and tests/unit/ocr-routing-table.test.ts checks each row's
 * `code` claim against getOcrModelForBook above or the lane file it names.
 *
 * Its prose RECORDS what the evidence settled. Since #7170 its `route` fields are also READ: the
 * flash families above, and the refusal lane's next reader per script. getOcrModelForBook stays
 * the only Gemini router, and the specialist lanes select their own books. A row with
 * `routed: 'no'` is evidence production has not acted on, which is a decision for Derek, not a bug
 * to fix here.
 */
export const OCR_ROUTING_TABLE = Object.freeze(createRequire(import.meta.url)('./ocr-routing-table.json'));

/** The row for a page kind (`latin-script-print`, `manuscripts`, `tibetan` …). Throws on an unknown id. */
export function ocrRouteForKind(id) {
  const row = OCR_ROUTING_TABLE.rows.find((r) => r.id === id);
  if (!row) throw new Error(`ocr-routing: no page kind "${id}" (known: ${OCR_ROUTING_TABLE.rows.map((r) => r.id).join(', ')})`);
  return row;
}

/**
 * The next reader for a page Gemini refused (RECITATION), by estimator chart (`latin`, `greek`, `chinese-print` …),
 * from the `refused-pages` row's route (#7170): { engine, lane, chart }. A chart the table does not list gets the
 * row's `otherwise` reader. Never a Gemini model: the refusal is Gemini's.
 */
export function ocrRefusalFallback(chart, table = OCR_ROUTING_TABLE) {
  const route = table.rows.find((r) => r.id === 'refused-pages')?.route;
  if (!route?.fallback) throw new Error('ocr-routing: the refused-pages row has no route.fallback');
  const hit = route.fallback.find((f) => f.chart === chart);
  return hit ?? { chart, engine: route.otherwise, lane: 'scripts/batch/claude-ocr.mjs' };
}
