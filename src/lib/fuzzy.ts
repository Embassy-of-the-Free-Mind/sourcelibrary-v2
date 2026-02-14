/**
 * Levenshtein edit distance between two strings.
 * No external dependencies.
 */
export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;

  // Quick exits
  if (m === 0) return n;
  if (n === 0) return m;

  // Single-row DP
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);

  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,      // deletion
        curr[j - 1] + 1,  // insertion
        prev[j - 1] + cost // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }

  return prev[n];
}

interface SuggestionOptions {
  maxDistance?: number;
  maxResults?: number;
}

/**
 * Find closest matching terms from a vocabulary set.
 * Pre-filters by first character and length for performance.
 */
export function findSuggestions(
  query: string,
  vocabulary: string[],
  options: SuggestionOptions = {}
): string[] {
  const q = query.toLowerCase().trim();
  if (q.length < 2) return [];

  // Scale max distance with query length
  const maxDistance = options.maxDistance ?? (q.length <= 5 ? 1 : q.length <= 8 ? 2 : 3);
  const maxResults = options.maxResults ?? 5;

  const scored: { term: string; distance: number }[] = [];

  for (const term of vocabulary) {
    const t = term.toLowerCase();

    // Skip if lengths differ too much (can't be within maxDistance)
    if (Math.abs(t.length - q.length) > maxDistance) continue;

    // Skip exact matches
    if (t === q) continue;

    const distance = levenshtein(q, t);
    if (distance <= maxDistance) {
      scored.push({ term, distance });
    }
  }

  // Sort by distance, then alphabetically for ties
  scored.sort((a, b) => a.distance - b.distance || a.term.localeCompare(b.term));

  return scored.slice(0, maxResults).map(s => s.term);
}
