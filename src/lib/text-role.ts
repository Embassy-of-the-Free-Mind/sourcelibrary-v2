/**
 * Ranking tier for the original-vs-translation distinction (issue #2395).
 *
 * `text_role` is written by scripts/maintenance/classify-text-role.mjs:
 *   original | period-translation | modern-translation
 *
 * Lower rank = closer to the source = ranks higher in search:
 *   0  original-language source (incl. genuine English-native works)
 *   1  period translation (pre-~1700 historical artifact) / unknown
 *   2  modern translation (~18th c.+ standing in for an original)
 *
 * When text_role is missing (pages, imports newer than the last classifier
 * run), fall back to the old language proxy: a non-English scan is an
 * original-language source; an unclassified English book sits between
 * originals and modern translations — matching the previous behavior where
 * "original language beats English translations".
 */
export function textRoleRank(textRole?: string | null, language?: string | null): number {
  if (textRole === 'original') return 0;
  if (textRole === 'period-translation') return 1;
  if (textRole === 'modern-translation') return 2;
  return language && language !== 'English' ? 0 : 1;
}
