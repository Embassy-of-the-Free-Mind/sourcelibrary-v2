/**
 * Match-quality assessment for merged search results (#4281).
 *
 * Search lanes are combined by rank (RRF-style), which discards absolute
 * relevance — the API cannot tell a strong result set from scraped-together
 * token noise. This helper answers one narrow question honestly: does ANY
 * result contain ALL the query's tokens? If none does, the whole set is a
 * partial-word match and the UI should say so instead of presenting it as
 * an answer ("Rainer Maria Rilke" → a person named Rainer + Hölderlin essays).
 *
 * Verdicts:
 *   'strong'  — at least one result covers every query token
 *   'weak'    — results exist, none covers every token
 *   null      — abstained: the check cannot judge this query
 *
 * Abstentions (per non-latin-text-operations.md — an empty comparable set is
 * UNJUDGEABLE, never a negative): queries that fold to fewer than two tokens.
 * That covers single words (presence IS coverage), contiguous CJK runs (one
 * token regardless of word count), and anything the tokenizer erases. A null
 * verdict must render exactly like today's behavior.
 */

// Elide marks that sit INSIDE words (ayn, hamza, apostrophes) so `Saʻdī`
// reaches the tokenizer as `sadi`, not two fragments. Then NFD + strip
// combining marks so café/cafe and Rilke/Rílke compare equal. Applied
// identically to query and haystack — a fold must normalize BOTH sides.
function fold(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ʻʼ‘’']/g, '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

function tokenize(text: string): string[] {
  return fold(text).match(/[\p{L}\p{N}]+/gu) ?? [];
}

export type MatchQuality = 'strong' | 'weak' | null;

/**
 * @param query    the raw user query
 * @param haystacks one string per result — the concatenation of that result's
 *                  reader-visible text fields (title, author, snippet, …)
 */
export function assessMatchQuality(query: string, haystacks: string[]): MatchQuality {
  const tokens = [...new Set(tokenize(query))];
  if (tokens.length < 2) return null;
  if (haystacks.length === 0) return null; // zero results is the empty state, not a weak one

  for (const hay of haystacks) {
    if (!hay) continue;
    const folded = fold(hay);
    if (tokens.every(t => folded.includes(t))) return 'strong';
  }
  return 'weak';
}
