/**
 * Shared author name-keying rules — extracted from build-authors-collection.mjs
 * (#2202) so its consumers can never drift apart. Three scripts previously
 * carried verbatim copies: the builder, additive-mint-authors-3780.mjs, and
 * the USTC coverage metric that motivated the extraction.
 *
 * canonicalKey: cluster key — folded Latin stems of the name tokens, sorted,
 * so "Böhmer, Justus Henning", "Justus Henning Boehmer" and "Iustus Henningius
 * Boehmerus" collapse together. Non-Latin names fall back to the
 * diacritic-folded raw string so CJK/Cyrillic/Greek authors still cluster.
 * The stemming is deliberately aggressive (Latin case endings) — right for
 * clustering and for coverage estimates, too loose for anything destructive.
 *
 * authorSlug: URL slug — must match src/lib/slugify.ts authorSlug() exactly.
 */
export const PARTICLES = new Set(['de','del','della','di','da','la','le','van','von','der','den','du','des','el','al','ibn','ben','a','ab','zu','of','the','don','fr','st','saint','y','e','pseudo']);

export const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function canonicalKey(author) {
  const s = norm(author).replace(/\([^)]*\)/g, '').replace(/,?\s*\d{3,4}\b.*$/, '').replace(/[^a-z\s,]/g, ' ');
  const toks = s.split(/[\s,]+/).filter(t => t.length >= 3 && !PARTICLES.has(t));
  const stems = toks.map(t => t
    .replace(/^j/, 'i').replace(/^gi/, 'i').replace(/v/g, 'u')
    .replace(/(issimus|us|um|orum|arum|ibus|onis|ius|is|ae|i|o|a|e)$/, ''))
    .filter(t => t.length >= 3).sort();
  if (!stems.length) {
    return (author || '').normalize('NFKD').replace(/[̀-ͯ]/g, '')
      .replace(/\([^)]*\)/g, '').replace(/[\d,.;]/g, '').replace(/\s+/g, '').toLowerCase();
  }
  return stems.join(' ');
}

export const authorSlug = (a) => (a || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/-{2,}/g, '-');
