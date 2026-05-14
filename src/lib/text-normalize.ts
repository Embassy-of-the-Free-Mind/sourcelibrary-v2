/**
 * Diacritic + German digraph normalisation for BPH catalogue search.
 *
 * MUST match the Postgres `public.normalize_bph_text()` function (see
 * `scripts/migration/add-bph-diacritic-normalization.sql`) byte-for-byte.
 * If they diverge, query-side and stored-side disagree and search appears
 * to silently miss results.
 *
 * Pipeline:
 *   1. Lowercase
 *   2. NFD-decompose + strip combining diacritics (Böhme → bohme)
 *   3. Explicit ß → ss (NFD doesn't decompose ß; Postgres `unaccent`
 *      handles it via its rules file, so the JS side must too)
 *   4. Collapse German digraphs: oe→o, ue→u, ae→a, ss→s
 *
 * Examples:
 *   "Böhme"    → "bohme"
 *   "Boehme"   → "bohme"   (matches Böhme — symmetric)
 *   "Müller"   → "muller"
 *   "Mueller"  → "muller"  (matches Müller)
 *   "Goerlitz" → "gorlitz" (matches "Görlitz" → "gorlitz")
 *   "Straße"   → "strase"  (matches "Strasse" → "strase")
 *
 * Issue: #1680.
 */
export function normalizeBphSearchText(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/oe/g, 'o')
    .replace(/ue/g, 'u')
    .replace(/ae/g, 'a')
    .replace(/ss/g, 's');
}
