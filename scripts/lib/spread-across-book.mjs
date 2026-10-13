/**
 * PRIOR ART: scripts/lib/page-language.mjs (`spreadSample`) trims front and back matter first, which is
 * right for deciding a language and wrong here: a book's closing section is exactly what went missing.
 * scripts/lib/archive-confirm-gone.mjs (`pickSpread`) de-duplicates through a Set of URLs and lives in
 * the archive-fetch module. Neither fits "keep n of these, in order, from the whole book".
 *
 * Keep `n` items of a list that is in BOOK ORDER, spread from its first item to its last (#4387).
 *
 * Phase 6 extracts 3-5 quotes per batch and a book has one batch per chapter or per ~15K characters,
 * so `quotes.slice(0, 15)` is the first three to five batches: the opening of the book. Measured
 * 2026-08-30 over 9,982 live books of 100+ pages, 45% had every stored pull-quote in the first quarter.
 * The same slice fed the synthesis prompt its "notable quotes", and capped the stored themes.
 *
 * Order is preserved and both ends are always kept, so the result still reads front to back.
 *
 * @template T
 * @param {T[] | null | undefined} items  in book order
 * @param {number} n
 * @returns {T[]}
 */
export function spreadAcrossBook(items, n) {
  const arr = Array.isArray(items) ? items : [];
  if (n <= 0) return [];
  if (arr.length <= n) return arr.slice();
  if (n === 1) return [arr[0]];
  const step = (arr.length - 1) / (n - 1);
  return Array.from({ length: n }, (_, i) => arr[Math.round(i * step)]);
}
