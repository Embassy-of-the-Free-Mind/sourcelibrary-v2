/**
 * Dedup normalizers — the scripts-side twin of `src/lib/dedup.ts`'s
 * `normalizeTitle` / `normalizeAuthor` (#4444).
 *
 * These two functions compute the `normalized_title` / `normalized_author`
 * DEDUP KEYS. If an import script normalizes even slightly differently from
 * `src/lib/dedup.ts`, the same book gets two different keys and enters the
 * corpus twice — silently, with no error and no skip row. That is not
 * hypothetical: on 2026-08-31 there were 25 `normalizeTitle` and 25
 * `normalizeAuthor` definitions in this repo, and the author halves had
 * already drifted into three variants inside one family of import scripts.
 *
 * **Import from here in `scripts/`. Do not paste a copy.** Node scripts run
 * under plain node on Hetzner and cannot import TypeScript, which is why a
 * twin exists at all — the same reason as `r2-key.mjs`, `ngram-normalize.mjs`
 * and `cover-scoring.mjs`. The TS side stays canonical; this file is a port;
 * `tests/unit/dedup-normalizer-forks.test.ts` fails CI if the two ever
 * disagree, and also census-checks that no NEW fork has appeared.
 *
 * Change BOTH sides or neither.
 *
 * Deliberate warts, preserved on purpose (improving them is #4270, which must
 * not ride along with a consolidation or a regression there becomes
 * indistinguishable from a consolidation bug):
 *   - `[^\w\s]` is ASCII-only, so a wholly non-Latin title normalizes to ''.
 *     `edition_key` (Unicode-aware) is what carries those records; see
 *     `src/lib/edition-key.ts`.
 *   - the leading-article alternation lists `la` twice — a no-op, kept so the
 *     two sides stay literally comparable.
 *   - `normalizeAuthor` sorts the words, so "Last, First" and "First Last"
 *     collapse to the same key.
 *
 * Nullish input yields '' here (as in `src/lib/identity-fields.ts`, the
 * canonical writer) rather than throwing.
 */

export function normalizeTitle(title) {
  return String(title || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/^(the|a|an|der|die|das|de|le|la|les|il|lo|la|gli|i|el|los|las)\s+/i, '')
    .replace(/\s*[\(\[:]?\s*(vol\.?\s*\d+|tomus?\s*\d+|part\.?\s*\d+|band\s*\d+|tome?\s*\d+)[\)\]]?\s*$/i, '')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeAuthor(author) {
  const cleaned = String(author || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\b(dr|prof|rev|saint|st|sir|fr|bp)\b\.?\s*/g, '')
    .replace(/\s*\([\d\s\-–,?.]+\)\s*/g, '')
    .replace(/,\s*[\d\s\-–?.]+$/, '')
    .replace(/[\[\]]/g, '')
    .replace(/\b(born|died|fl\.?|circa|ca?\.?)\s*\d{3,4}\b/g, '')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.split(' ').filter((w) => w.length > 0).sort().join(' ');
}
