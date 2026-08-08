/**
 * Identity fields — the one writer for a book's deterministic identity.
 *
 * Phase 0 of the pipeline. Every book carries four derived identity fields:
 *
 *   normalized_title    dedup semantics (ASCII — see note below)
 *   normalized_author   dedup semantics
 *   edition_key         one printing (src/lib/edition-key.ts)
 *   edition_key_quality full | no-year | no-author | title-only | null
 *
 * Before this existed, identity was written by three uncoordinated mechanisms
 * (the import route, hand-run sweeps, nothing at all — 47 direct-insert scripts
 * bypass the route entirely) and 8,769 books ended up with no normalized_title.
 * Now there are exactly two writers, both calling this function:
 *
 *   - `import-utils.ts` at import time (books that take the official route)
 *   - `scripts/workers/identity-worker.mjs` on a cron (everything else,
 *     within a couple of hours of insertion, however the book got in)
 *
 * The worker imports the .mjs twin `scripts/lib/identity-fields.mjs`;
 * `tests/unit/identity-fields-parity.test.ts` pins the two byte-identical
 * (repo twin convention — cf. r2-key, ngram-normalize, cover-scoring).
 *
 * CONVENTION: fields are always written, null meaning "computed, unkeyable."
 * Field ABSENT = never computed (the worker's queue). Field NULL = computed
 * and this book cannot carry an edition key (no usable title). Do not write
 * partial identity — a book with normalized_title but no edition_key reads as
 * drift to the integrity script.
 *
 * NOTE on normalized_title: it deliberately keeps dedup.ts's ASCII semantics
 * (non-Latin titles normalize to ''), because ~68K stored values and the
 * import dedup tier share them. The Unicode-aware normalization lives in
 * edition_key. Changing normalized_title's semantics is a corpus-wide
 * migration — see `.claude/docs/invariants/edition-identity.md`.
 */

import { normalizeTitle, normalizeAuthor } from './dedup';
import { buildEditionKey, type EditionKeyQuality } from './edition-key';

export interface IdentityFieldsInput {
  title?: string | null;
  display_title?: string | null;
  author?: string | null;
  year?: number | null;
  published?: string | null;
}

export interface IdentityFields {
  normalized_title: string;
  normalized_author: string;
  edition_key: string | null;
  edition_key_quality: EditionKeyQuality | null;
}

export function computeIdentityFields(book: IdentityFieldsInput): IdentityFields {
  const edition = buildEditionKey(book);
  return {
    normalized_title: normalizeTitle(String(book.title || '')),
    normalized_author: normalizeAuthor(String(book.author || '')),
    edition_key: edition.key,
    edition_key_quality: edition.quality,
  };
}
