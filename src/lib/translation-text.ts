/**
 * The book's words of a page's translation, read through the one rule of the notes layer (#5942):
 * `translation.text` only when `translation.text_from.data_hash` is the hash of the current
 * `translation.data`; otherwise `data` parsed live. A writer that forgot the new fields can only
 * cost a parse, never serve stale words. Read through `getTranslationText`, never
 * `page.translation.text`.
 *
 * PRIOR ART: scripts/lib/translation-text.mjs is the twin the pipeline uses, and holds the layer
 * builders; they are re-exported here, not restated, so a TS writer stores exactly what a script
 * writer stores. src/lib/translation-layers.ts (#5958) is the reader's render-time split and stores
 * nothing. Parity pinned by tests/unit/translation-text.test.ts. Server-only (node:crypto).
 */
import { splitAnnotations } from '../../scripts/lib/annotation-layer.mjs';
import { contentHash } from './write-provenance';

export {
  PARSER_VERSION,
  ANNOTATIONS_COLLECTION,
  inlineSource,
  translationLayers,
  writePageAnnotations,
  annotationsDoc,
  parserAnnotation,
} from '../../scripts/lib/translation-text.mjs';

export interface TextFrom {
  source: 'parser' | 'model';
  parser_version?: string;
  data_hash: string;
  annotations?: number;
}

export interface TranslationWithText {
  data?: string | null;
  text?: string | null;
  text_from?: TextFrom | null;
}

/** True when the stored `translation.text` was made from the `translation.data` beside it. */
export function translationTextIsCurrent(translation: TranslationWithText | null | undefined): boolean {
  if (!translation || typeof translation.text !== 'string' || typeof translation.data !== 'string') return false;
  const h = translation.text_from?.data_hash;
  return typeof h === 'string' && h === contentHash(translation.data);
}

/**
 * Projection a caller needs: `translation.data`, `translation.text`, `translation.text_from`.
 * Returns '' when the page has no translation.
 */
export function getTranslationText(page: { translation?: TranslationWithText | null } | null | undefined): string {
  const t = page?.translation;
  if (!t || typeof t.data !== 'string' || !t.data) return '';
  if (translationTextIsCurrent(t)) return t.text as string;
  return splitAnnotations(t.data).text;
}
