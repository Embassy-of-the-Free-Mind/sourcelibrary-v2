import { browseBooks, type CatalogBook } from '@/lib/books-catalog';

/**
 * "Related books" — a weighted, multi-signal recommender (replaces the old
 * collection→category→language fallback, where a shared collection dominated).
 *
 * We gather candidate pools from the strongest independent signals (same author,
 * same subject/category, same era, same place-ish, same collection, same
 * language), merge them, then score each candidate by how much it shares with
 * the seed book. Weights lean on author + subject + LOCATION × TIME-PERIOD, and
 * treat a shared collection as only a minor nudge.
 */

export interface RelatedSeed {
  id: string;
  author?: string | null;
  categories?: string[] | null;
  collections?: string[] | null;
  language?: string | null;
  year?: number | null;
  place?: string | null;
}

const GENERIC_AUTHOR = /^(unknown|anonymous|anon\.?|unidentified|various|no author|n\/a)\b/i;

/** Normalise a place-of-publication to a matchable city token.
 *  "Amsterdam: Johannes Janssonius, 1660" → "amsterdam". */
function placeKey(p?: string | null): string | null {
  if (!p) return null;
  const first = p.split(/[:,;(\/]/)[0]
    .normalize('NFKD').replace(/[̀-ͯ]/g, '') // strip accents
    .replace(/[^a-z\s-]/gi, ' ')
    .trim().toLowerCase();
  return first.length >= 3 ? first : null;
}

const norm = (s: string) => s.trim().toLowerCase();

export async function getRelatedBooks(
  seed: RelatedSeed,
  renderable: (thumb?: string | null) => boolean,
  limit = 12,
): Promise<CatalogBook[]> {
  const author = seed.author?.trim();
  const knownAuthor = !!author && !GENERIC_AUTHOR.test(author);
  const cats = (seed.categories || []).filter(Boolean);
  const cols = (seed.collections || []).filter(Boolean);
  const lang = seed.language?.trim() || undefined;
  const year = typeof seed.year === 'number' && seed.year > 0 ? seed.year : null;
  const placeK = placeKey(seed.place);

  const pool = async (p: Promise<{ books: CatalogBook[] }>): Promise<CatalogBook[]> => {
    try { return (await p).books; } catch { return []; }
  };

  // Candidate pools — each keyed off one signal so the merged set is diverse.
  const [byAuthor, byCategory, byEra, byCollection, byLanguage] = await Promise.all([
    knownAuthor ? pool(browseBooks({ authorPrefix: author, limit: 24 })) : Promise.resolve([]),
    cats[0] ? pool(browseBooks({ category: cats[0], sort: 'popular', limit: 40 })) : Promise.resolve([]),
    year != null ? pool(browseBooks({ yearMin: year - 60, yearMax: year + 60, language: lang, sort: 'popular', limit: 40 })) : Promise.resolve([]),
    cols[0] ? pool(browseBooks({ collection: cols[0], sort: 'popular', limit: 20 })) : Promise.resolve([]),
    lang ? pool(browseBooks({ language: lang, sort: 'popular', limit: 20 })) : Promise.resolve([]),
  ]);

  const merged = new Map<string, CatalogBook>();
  for (const b of [...byAuthor, ...byCategory, ...byEra, ...byCollection, ...byLanguage]) {
    if (!b || b.id === seed.id || merged.has(b.id)) continue;
    if (!renderable(b.thumbnail)) continue;
    merged.set(b.id, b);
  }

  const catSet = new Set(cats.map(norm));
  const colSet = new Set(cols.map(norm));

  const scored = [...merged.values()].map((b) => {
    let s = 0;
    const reasons: string[] = [];

    // Author — the strongest signal.
    if (knownAuthor && b.author && norm(b.author) === norm(author!)) { s += 6; reasons.push('author'); }

    // Subject / category overlap — the topical signal.
    const catOverlap = (b.categories || []).map(norm).filter((c) => catSet.has(c)).length;
    if (catOverlap) { s += Math.min(catOverlap, 3) * 3; reasons.push('subject'); }

    // Time period.
    let eraMatch = false;
    if (year != null && b.year != null && b.year > 0) {
      const d = Math.abs(b.year - year);
      if (d <= 25) { s += 4; eraMatch = true; }
      else if (d <= 60) { s += 2; eraMatch = true; }
      else if (d <= 120) { s += 1; }
      if (eraMatch) reasons.push('era');
    }

    // Location (place of publication).
    let placeMatch = false;
    const bpk = placeKey(b.place_published);
    if (placeK && bpk && bpk === placeK) { s += 3; placeMatch = true; reasons.push('place'); }

    // Location × time-period — a book from the same place AND era is especially kin.
    if (placeMatch && eraMatch) s += 2;

    // Shared collection — only a minor nudge (used to dominate).
    const colOverlap = (b.collections || []).map(norm).filter((c) => colSet.has(c)).length;
    if (colOverlap) s += Math.min(colOverlap, 2);

    // Same language — weak.
    if (lang && b.language && norm(b.language) === norm(lang)) s += 1;

    return { b, s, reasons };
  });

  scored.sort((a, z) => z.s - a.s || (z.b.read_count || 0) - (a.b.read_count || 0));
  // Prefer genuinely-related books — a real signal (same author, shared
  // subject, or same era/place), score >= 3 — over weak filler that merely
  // shares a language (1) or a loose century (1). Only relax if too few clear
  // matches exist, so the rail is never empty.
  const strong = scored.filter((x) => x.s >= 3);
  const chosen = strong.length >= 6 ? strong : scored.filter((x) => x.s >= 1);
  return chosen.slice(0, limit).map((x) => x.b);
}
