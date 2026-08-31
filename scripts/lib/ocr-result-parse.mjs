/**
 * JS twin of the OCR-result parsers in `src/lib/types/prompts/defaults.ts` (#4443).
 *
 * Why a separate copy: pipeline scripts run as plain `.mjs` and cannot import the
 * `@/`-aliased TS module. Same reason as `scripts/lib/page-image-url.mjs`, and the
 * same guarantee — `tests/unit/ocr-result-parse.test.ts` runs both implementations
 * over one fixture corpus and fails if they disagree, so an edit to either side
 * breaks CI instead of drifting.
 *
 * Before this file existed, six scripts each carried a private copy that imported
 * nothing:
 *
 *   scripts/batch/collect-batch-results.mjs     scripts/split-book.mjs
 *   scripts/batch/collect-multipage-ocr.mjs     scripts/workers/batch-collector.mjs
 *   scripts/batch/realtime-ocr.mjs              scripts/batch/realtime-reocr-efm.mjs
 *
 * They had drifted into five mutually incompatible behaviours — two screened the
 * model's page type against separately-stale vocabularies, four screened it not at
 * all, and one had lost the `i` flag. Because the failure mode is *missing
 * metadata* rather than an error, nothing ever went red. These are the collectors
 * that read batch output we have already spent money to generate.
 *
 * KEEP IN LOCKSTEP WITH `src/lib/types/prompts/defaults.ts`.
 */

/**
 * Bump in `defaults.ts`; this mirrors it. Pinned by the parity test.
 *
 * NOTE for collectors: this is the version of the prompt *this checkout* would
 * send, not the version any given batch job was submitted with. To stamp
 * `ocr.prompt_version` on a collected page, read it off the job record — a job
 * submitted months ago did not use this prompt, and stamping it with today's
 * value fabricates provenance.
 */
export const PROMPT_VERSION = 'v6.1.2026-05';

/** Page-type vocabulary accepted from the model. Mirrors VALID_PAGE_TYPES in defaults.ts. */
export const VALID_PAGE_TYPES = new Set([
  'title-page', 'frontispiece', 'dedication', 'preface', 'toc', 'index',
  'errata', 'colophon', 'appendix', 'blank', 'illustration', 'diagram', 'map', 'text',
  'digitizer-insert', 'exlibris', 'bookplate',
]);

/**
 * Extract <page-type> from OCR text. Returns undefined if not found or invalid.
 *
 * `validate: false` returns whatever the model emitted (trimmed, lower-cased)
 * without screening it against VALID_PAGE_TYPES. That is not a preference — it is
 * what four batch collectors have always done, and the two vocabularies genuinely
 * disagree: the OCR prompt offers `musical-score`, `table` and `cover`, none of
 * which VALID_PAGE_TYPES lists. Flipping those callers to validating would
 * silently stop three prompt-sanctioned types from being recorded, so the
 * divergence is a parameter rather than a fork. See #4455 for the gap itself.
 *
 * Unlike the TS canonical this tolerates a non-string argument, because
 * `split-book.mjs` passes `page.ocr`, which is null on an un-OCR'd page.
 */
export function extractPageType(ocrText, { validate = true } = {}) {
  const match = ocrText?.match(/<page-type>([\s\S]*?)<\/page-type>/i);
  if (!match) return undefined;
  const type = match[1].trim().toLowerCase();
  if (!validate) return type || undefined;
  return VALID_PAGE_TYPES.has(type) ? type : undefined;
}

/** Extract <columns>N</columns> from OCR text. Returns undefined if not found or 1. */
export function extractColumns(ocrText) {
  const match = ocrText?.match(/<columns>\s*(\d+)\s*<\/columns>/i);
  if (!match) return undefined;
  const n = parseInt(match[1], 10);
  return n > 1 ? n : undefined;
}

/** Extract <script>printed|handwritten|mixed</script> from OCR text. */
export function extractScriptType(ocrText) {
  const match = ocrText?.match(/<script>([\s\S]*?)<\/script>/i);
  if (!match) return undefined;
  const type = match[1].trim().toLowerCase();
  if (type === 'handwritten' || type === 'mixed' || type === 'printed') return type;
  return undefined;
}

/**
 * Parse a multi-page OCR response into a Map of pageId → OCR text.
 *
 * `lenient: true` is the batch-collector dialect, and it differs in four ways that
 * all exist for one reason — a truncated Gemini batch response drops the final
 * `</page>`, and the strict parser silently discards that page's text even though
 * we already paid to generate it:
 *   1. accepts any whitespace in `<page   id="…">`, not one literal space;
 *   2. does not require `</page>` — a block runs to the next `<page id=` or EOF;
 *   3. strips a trailing `</page>` left over from (2);
 *   4. omits pages whose content is empty after trimming.
 * Callers on the request path keep the strict default.
 */
export function parseMultiPageOcr(text, { lenient = false } = {}) {
  const results = new Map();
  if (lenient) {
    const regex = /<page\s+id="([^"]+)">([\s\S]*?)(?=<page\s+id="|$)/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
      const content = match[2].trim().replace(/<\/page>\s*$/, '').trim();
      if (content) results.set(match[1], content);
    }
    return results;
  }
  const regex = /<page id="([^"]+)">([\s\S]*?)<\/page>/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    results.set(match[1], match[2].trim());
  }
  return results;
}
