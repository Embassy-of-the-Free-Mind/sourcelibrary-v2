/**
 * The romanized layer of a page (issue #3828).
 *
 * A Greek, Hebrew, Arabic or Sanskrit page is only half-readable to a scholar
 * who cannot sound out the script, so a quote of one wants three layers:
 * the original, its romanization, and the translation. The romanization
 * already exists in the data — `pages.transliteration.data`, written by the
 * transliteration machinery (#3125) — but until now only the alignment route
 * read it. This helper is the shared read path for every surface that serves
 * it as apparatus alongside a quote.
 *
 * PROVENANCE: the romanization is AI-derived layer-2 apparatus, NOT a
 * transcription. It is served under the field name `romanized` (never
 * `original_romanized`) precisely so no consumer can mistake it for the
 * verbatim original — see the tag-registry distinction in #3825.
 *
 * STALENESS: `transliteration.source_ocr_hash` pins the romanization to the
 * OCR text it was produced from. If the page has since been re-OCR'd or
 * hand-corrected, the stored romanization romanizes words that are no longer
 * on the page we are about to serve — apparatus that disagrees with the
 * original beside it is worse than no apparatus, so we omit it. Writers use
 * two different hash functions (djb2 in the transliterate routes,
 * `pipeline-orchestrator.mjs` and `batch-transliterate.mjs`; md5 in
 * `scripts/workers/transliterate-greek.mjs`), so the check dispatches on hash
 * shape and fails OPEN when the stored hash is absent or unrecognized — an
 * unverifiable romanization is still served, only a provably stale one is not.
 */

import { createHash } from 'crypto';
import { stripEditorialWrappers } from './strip-editorial-wrappers';
import type { Page } from './types';

/**
 * The non-cryptographic hash used by the transliterate API routes,
 * `scripts/workers/pipeline-orchestrator.mjs` and
 * `scripts/batch/batch-transliterate.mjs`. Kept byte-identical to those
 * copies — changing it here silently invalidates every stored hash.
 */
export function djb2Hash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return hash.toString(16);
}

/**
 * Does the stored romanization still describe this OCR text? True when the
 * hash is missing or in an unrecognized format (fail open — see module note).
 */
export function isRomanizationCurrent(
  storedHash: string | undefined | null,
  ocrText: string | undefined | null
): boolean {
  if (!storedHash || typeof storedHash !== 'string') return true;
  if (!ocrText) return true;
  // md5 (transliterate-greek.mjs) is 32 hex chars; djb2 is at most 8 plus a
  // possible leading '-'. Nothing else writes this field.
  if (/^[a-f0-9]{32}$/i.test(storedHash)) {
    return createHash('md5').update(ocrText).digest('hex') === storedHash;
  }
  if (/^-?[a-f0-9]{1,8}$/i.test(storedHash)) {
    return djb2Hash(ocrText) === storedHash;
  }
  return true;
}

type RomanizablePage = Pick<Page, 'ocr' | 'transliteration'>;

/**
 * The romanized text to serve alongside a quote, or `undefined` when there is
 * none worth serving (absent, blank, or stale against the current OCR).
 *
 * Stripped through the same editorial-wrapper pipeline as `original`: the
 * romanization is produced from raw `ocr.data`, wrapper blocks and all, so it
 * can carry romanized `<meta>`/`<scan-quality>` prose that is not source text
 * (the #2232 misquote family, one alphabet removed).
 */
export function romanizedForQuote(page: RomanizablePage | null | undefined): string | undefined {
  const data = page?.transliteration?.data;
  if (!data || typeof data !== 'string') return undefined;
  if (!isRomanizationCurrent(page?.transliteration?.source_ocr_hash, page?.ocr?.data)) {
    return undefined;
  }
  const stripped = stripEditorialWrappers(data).trim();
  return stripped ? stripped : undefined;
}
